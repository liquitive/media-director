/**
 * Assistants API One-Shot Generator - Single API call for all segments
 * Uses OpenAI Assistants API with file attachments for unlimited context
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SegmentPrompt, SegmentPair } from '../types/asset.types';
import { Segment } from '../models/story';
import { ExplicitErrorLogger } from '../utils/explicitErrorLogger';
import { buildContinuityMap, loadCharacterProfiles, ContinuityState } from './continuityCalculator';
import { ContinuityLinter } from './continuityLinter';
import { isTooSimilar, findSimilarSegment } from '../utils/ngramUtils';

export class AssistantsAPIOneShotGenerator {
  private openai: OpenAI;
  private assistantId?: string;
  private context: vscode.ExtensionContext;
  private errorLogger: ExplicitErrorLogger;
  
  // ========================================
  // Multi-Assistant Pool Strategy
  // ========================================
  private static readonly ASSISTANT_POOL_SIZE = 4;
  private static readonly POST_SUBMIT_TIMEOUT_MS = 30000; // 30 seconds after submitToolOutputs
  private assistantPool: string[] = []; // Pool of assistant IDs
  private currentAssistantIndex: number = 0;
  
  // ========================================
  // Phase 2: Assistant Management
  // ========================================
  
  /**
   * Policy version for Assistant instructions
   * Increment when making breaking changes to instructions or tool schemas
   */
  private static readonly POLICY_VERSION = '2025-10-25';
  
  /**
   * Stable policy baked into Assistant (created once, reused)
   * These instructions never change per-story/batch
   */
  private static readonly ASSISTANT_CORE_INSTRUCTIONS = `You are generating STRUCTURED FIELDS for video generation. Do NOT write final prose.

CRITICAL: Output structured fields ONLY. Host will compose the final prompt.

CONTINUITY CONTRACT (BINDING):
- For characters in continuityRefsByCharacter: do NOT mention fixed traits (age, face, hair, wardrobe)
- ONLY describe: actions, blocking, environment/prop changes
- For firstAppearanceByCharacter: identityLockline will be used (don't repeat)

STRUCTURED FIELDS (strict):
1. actions[] (max 3): Verbs-first, active voice. Example: "kneels, hands trembling; gazes upward"
2. shot (1 line): Camera angle, movement. Example: "Medium close, slow dolly left, shallow DOF"
3. lighting (1 line): Quality, direction. Example: "Golden hour, rim light, soft shadows"
4. environment_delta: ONLY changes vs ref. Empty if unchanged. Example: "wind picks up, dust swirls"
5. props_delta: ONLY new props. Empty if none. Example: "scroll in hand"

SELF-ASSESSMENT (required):
- redundancy_score: <0.3 required (are you repeating prior segments?)
- novelty_score: 0.4-0.8 target (fresh but not wild)
- continuity_confidence: >0.7 required (following refs correctly?)
- forbidden_traits_used[]: list any fixed traits you mentioned despite continuity

FORBIDDEN PHRASES:
- "The camera...", "A shot of...", "The mood is..."
- Fixed traits if continuityRefsByCharacter exists
- Passive voice
- Adjective stacking

OUTPUT REQUIREMENT:
- Always call generateSegments function with complete structured fields
- Temperature: stability over novelty
- Brevity: 50-80 words per fused prompt`;
  
  // ========================================
  // Phase 3: Tool Schemas
  // ========================================
  
  /**
   * Main generation tool - outputs STRUCTURED FIELDS (not final prose)
   * Host will fuse these fields into finalPrompt
   */
  private static readonly GENERATE_SEGMENTS_TOOL = {
    type: 'function' as const,
    function: {
      name: 'generateSegments',
      description: 'Generate structured fields for video segments. Output ONLY structured fields, NOT final prose. Host will fuse fields into prompt.',
      parameters: {
        type: 'object',
        properties: {
          segments: {
            type: 'array',
            description: 'Array of segments with structured fields',
            items: {
              type: 'object',
              properties: {
                segmentId: {
                  type: 'string',
                  description: 'Segment identifier (e.g., "segment_1")'
                },
                // Structured fields (host will fuse these)
                structuredFields: {
                  type: 'object',
                  description: 'Structured fields that host will compose into finalPrompt',
                  properties: {
                    actions: {
                      type: 'array',
                      description: 'Max 3 actions, verb-first. Example: ["kneels", "hands trembling", "gazes upward"]',
                      items: { type: 'string' },
                      maxItems: 3
                    },
                    shot: {
                      type: 'string',
                      description: 'One line: camera angle, movement. Example: "Medium close, slow dolly left, shallow DOF"'
                    },
                    lighting: {
                      type: 'string',
                      description: 'One line: quality, direction. Example: "Golden hour, rim light, soft shadows"'
                    },
                    environment_delta: {
                      type: 'string',
                      description: 'ONLY changes from continuity ref. Empty if unchanged. Example: "wind picks up, dust swirls"'
                    },
                    props_delta: {
                      type: 'string',
                      description: 'ONLY new props. Empty if none. Example: "scroll in hand"'
                    },
                    // Self-assessment scores
                    redundancy_score: {
                      type: 'number',
                      description: 'How repetitive vs prior segments? Must be <0.3. Range 0-1.',
                      minimum: 0,
                      maximum: 1
                    },
                    novelty_score: {
                      type: 'number',
                      description: 'Fresh but not wild? Target 0.4-0.8. Range 0-1.',
                      minimum: 0,
                      maximum: 1
                    },
                    continuity_confidence: {
                      type: 'number',
                      description: 'Following continuity refs correctly? Must be >0.7. Range 0-1.',
                      minimum: 0,
                      maximum: 1
                    },
                    forbidden_traits_used: {
                      type: 'array',
                      description: 'List any fixed traits mentioned despite continuity refs. Empty if none.',
                      items: { type: 'string' }
                    }
                  },
                  required: ['actions', 'shot', 'lighting', 'redundancy_score', 'novelty_score', 'continuity_confidence', 'forbidden_traits_used']
                },
                // Host-computed continuity (read-only, for reference)
                characters: {
                  type: 'array',
                  description: 'Characters in this segment (from host)',
                  items: { type: 'string' }
                },
                location: {
                  type: 'string',
                  description: 'Location name (from host)'
                },
                continuityRefsByCharacter: {
                  type: 'object',
                  description: 'Per-character continuity refs (from host)',
                  additionalProperties: { type: 'string' }
                },
                locationRef: {
                  type: 'string',
                  description: 'Location continuity ref (from host)'
                },
                firstAppearanceByCharacter: {
                  type: 'array',
                  description: 'Characters appearing for first time (from host)',
                  items: { type: 'string' }
                },
                usedAssets: {
                  type: 'array',
                  description: '[OPTIONAL/DEPRECATED] Asset IDs referenced in this segment. The host now uses narrativeContext for continuity tracking.',
                  items: { type: 'string' }
                }
              },
              required: ['segmentId', 'structuredFields']
            }
          },
          violations: {
            type: 'array',
            description: 'Names used that are not in context.storyAssets[].name',
            items: { type: 'string' }
          }
        },
        required: ['segments']
      }
    }
  };
  
  /**
   * Critic tool - reviews and rewrites structured fields if violations found
   */
  private static readonly CRITIC_TOOL = {
    type: 'function' as const,
    function: {
      name: 'critiqueAndRewrite',
      description: 'Review structured fields and rewrite if violations found (redundancy >0.3, novelty out of range, forbidden traits used)',
      parameters: {
        type: 'object',
        properties: {
          segments: {
            type: 'array',
            description: 'Array of critiqued/rewritten segments',
            items: {
              type: 'object',
              properties: {
                segmentId: {
                  type: 'string',
                  description: 'Segment identifier'
                },
                critique: {
                  type: 'object',
                  description: 'Critique results',
                  properties: {
                    hasViolations: {
                      type: 'boolean',
                      description: 'True if violations found'
                    },
                    violationTypes: {
                      type: 'array',
                      description: 'Types of violations found',
                      items: {
                        type: 'string',
                        enum: ['high_redundancy', 'low_novelty', 'high_novelty', 'trait_drift', 'filler_phrases']
                      }
                    },
                    issues: {
                      type: 'array',
                      description: 'Specific issues found',
                      items: { type: 'string' }
                    }
                  },
                  required: ['hasViolations', 'violationTypes', 'issues']
                },
                rewrittenFields: {
                  type: 'object',
                  description: 'Rewritten structured fields (only if hasViolations=true)',
                  properties: {
                    actions: {
                      type: 'array',
                      items: { type: 'string' },
                      maxItems: 3
                    },
                    shot: { type: 'string' },
                    lighting: { type: 'string' },
                    environment_delta: { type: 'string' },
                    props_delta: { type: 'string' },
                    redundancy_score: { type: 'number', minimum: 0, maximum: 1 },
                    novelty_score: { type: 'number', minimum: 0, maximum: 1 },
                    continuity_confidence: { type: 'number', minimum: 0, maximum: 1 },
                    forbidden_traits_used: {
                      type: 'array',
                      items: { type: 'string' }
                    }
                  }
                }
              },
              required: ['segmentId', 'critique']
            }
          }
        },
        required: ['segments']
      }
    }
  };
  
  constructor(apiKey: string, context: vscode.ExtensionContext, errorLogger: ExplicitErrorLogger) {
    this.openai = new OpenAI({ apiKey });
    this.context = context;
    this.errorLogger = errorLogger;
  }
  
  // ========================================
  // Phase 2: Assistant Management Methods
  // ========================================
  
  /**
   * Initialize pool of assistants (3-4 instances ready to use)
   */
  private async ensureAssistantPool(): Promise<void> {
    const poolCacheKey = `assistantPool_${AssistantsAPIOneShotGenerator.POLICY_VERSION}`;
    const cachedPool = this.context.globalState.get<string[]>(poolCacheKey);
    
    if (cachedPool && cachedPool.length >= AssistantsAPIOneShotGenerator.ASSISTANT_POOL_SIZE) {
      // Verify all assistants still exist
      const validAssistants: string[] = [];
      for (const assistantId of cachedPool) {
        try {
          const assistant = await this.openai.beta.assistants.retrieve(assistantId);
          if (assistant.metadata?.policy_version === AssistantsAPIOneShotGenerator.POLICY_VERSION) {
            validAssistants.push(assistantId);
          }
        } catch (error) {
          this.errorLogger.logInfo('system', `Cached assistant ${assistantId} not found, will create new one`);
        }
      }
      
      if (validAssistants.length >= AssistantsAPIOneShotGenerator.ASSISTANT_POOL_SIZE) {
        this.assistantPool = validAssistants;
        this.errorLogger.logInfo('system', `Reusing assistant pool (${validAssistants.length} assistants)`);
        return;
      }
    }
    
    // Create missing assistants to fill the pool
    this.errorLogger.logInfo('system', `Creating assistant pool (${AssistantsAPIOneShotGenerator.ASSISTANT_POOL_SIZE} assistants)...`);
    this.assistantPool = [];
    
    for (let i = 0; i < AssistantsAPIOneShotGenerator.ASSISTANT_POOL_SIZE; i++) {
      const assistant = await this.openai.beta.assistants.create({
        name: `Sora Video Director Pool ${i + 1}`,
        instructions: AssistantsAPIOneShotGenerator.ASSISTANT_CORE_INSTRUCTIONS,
        model: 'gpt-4.1',
        tools: [AssistantsAPIOneShotGenerator.GENERATE_SEGMENTS_TOOL],
        metadata: {
          policy_version: AssistantsAPIOneShotGenerator.POLICY_VERSION,
          pool_index: i.toString()
        }
      });
      
      this.assistantPool.push(assistant.id);
      this.errorLogger.logInfo('system', `Created assistant ${i + 1}/${AssistantsAPIOneShotGenerator.ASSISTANT_POOL_SIZE}: ${assistant.id}`);
    }
    
    // Cache the pool
    await this.context.globalState.update(poolCacheKey, this.assistantPool);
    this.errorLogger.logInfo('system', `Assistant pool ready with ${this.assistantPool.length} instances`);
  }
  
  /**
   * Get next available assistant from pool (round-robin)
   */
  private getNextAssistant(): string {
    if (this.assistantPool.length === 0) {
      throw new Error('Assistant pool not initialized');
    }
    
    const assistantId = this.assistantPool[this.currentAssistantIndex];
    this.currentAssistantIndex = (this.currentAssistantIndex + 1) % this.assistantPool.length;
    
    this.errorLogger.logInfo('system', `Using assistant ${assistantId} (index ${this.currentAssistantIndex})`);
    return assistantId;
  }
  
  /**
   * Track active threads for cleanup
   */
  private activeThreads: Map<string, string> = new Map(); // threadId -> storyId
  
  /**
   * Cancel all runs in a specific thread
   */
  private async cancelThreadRuns(threadId: string): Promise<number> {
    let cancelledCount = 0;
    try {
      const runs = await this.openai.beta.threads.runs.list(threadId);
      for (const run of runs.data) {
        if (run.status === 'in_progress' || run.status === 'requires_action' || run.status === 'queued') {
          try {
            await this.openai.beta.threads.runs.cancel(run.id, { thread_id: threadId });
            cancelledCount++;
            this.errorLogger.logInfo('system', `  ✓ Cancelled stuck run ${run.id} (status: ${run.status})`);
          } catch (cancelError) {
            this.errorLogger.logInfo('system', `  ⚠️ Failed to cancel run ${run.id}: ${cancelError}`);
          }
        }
      }
    } catch (error) {
      this.errorLogger.logInfo('system', `  ⚠️ Failed to list runs for thread ${threadId}: ${error}`);
    }
    return cancelledCount;
  }
  
  /**
   * Clean up any stuck runs from previous generation attempts
   * Cancels all active runs for all tracked threads
   */
  private async cleanupAllStuckRuns(): Promise<void> {
    if (this.activeThreads.size === 0) {
      this.errorLogger.logInfo('system', '✓ No active threads to clean up');
      return;
    }
    
    this.errorLogger.logInfo('system', `🧹 Cleaning up ${this.activeThreads.size} active threads...`);
    
    let totalCancelled = 0;
    for (const [threadId, storyId] of this.activeThreads.entries()) {
      this.errorLogger.logInfo('system', `  Checking thread ${threadId} (story: ${storyId})...`);
      const cancelled = await this.cancelThreadRuns(threadId);
      totalCancelled += cancelled;
    }
    
    if (totalCancelled > 0) {
      this.errorLogger.logInfo('system', `✓ Cancelled ${totalCancelled} stuck runs`);
    } else {
      this.errorLogger.logInfo('system', '✓ No stuck runs found');
    }
    
    // Clear the active threads map
    this.activeThreads.clear();
  }
  
  /**
   * Create or retrieve Assistant with stable instructions
   * DEPRECATED - Use ensureAssistantPool() instead
   */
  private async ensureAssistant(): Promise<string> {
    const cacheKey = `assistantId_${AssistantsAPIOneShotGenerator.POLICY_VERSION}`;
    const existingId = this.context.globalState.get<string>(cacheKey);
    
    if (existingId) {
      try {
        const assistant = await this.openai.beta.assistants.retrieve(existingId);
        if (assistant.metadata?.policy_version === AssistantsAPIOneShotGenerator.POLICY_VERSION) {
          this.errorLogger.logInfo('system', `Reusing cached assistant: ${existingId} (policy ${AssistantsAPIOneShotGenerator.POLICY_VERSION})`);
          return existingId;
        }
      } catch (error) {
        // Assistant deleted or not found, create new
        this.errorLogger.logInfo('system', `Cached assistant ${existingId} not found, creating new one`);
      }
    }
    
    // Create new assistant with stable instructions
    const assistant = await this.openai.beta.assistants.create({
      name: 'Sora Video Director - Structured Fields',
      model: 'gpt-4.1',
      instructions: AssistantsAPIOneShotGenerator.ASSISTANT_CORE_INSTRUCTIONS,
      tools: [
        { type: 'file_search' },
        AssistantsAPIOneShotGenerator.GENERATE_SEGMENTS_TOOL,
        AssistantsAPIOneShotGenerator.CRITIC_TOOL
      ],
      temperature: 0.3,  // Stability over novelty
      metadata: {
        policy_version: AssistantsAPIOneShotGenerator.POLICY_VERSION,
        created: new Date().toISOString()
      }
    });
    
    // Cache assistant ID
    await this.context.globalState.update(cacheKey, assistant.id);
    this.errorLogger.logInfo('system', `Created new assistant: ${assistant.id} (policy ${AssistantsAPIOneShotGenerator.POLICY_VERSION})`);
    
    return assistant.id;
  }
  
  /**
   * Create per-story thread
   * Thread is reused across batches for the same story
   * Note: We use inline context instead of vector stores for simplicity
   */
  private async createStoryThread(storyId: string): Promise<string> {
    const thread = await this.openai.beta.threads.create({
      metadata: {
        storyId,
        created: new Date().toISOString()
      }
    });
    
    // Track this thread for cleanup
    this.activeThreads.set(thread.id, storyId);
    
    this.errorLogger.logInfo(storyId, `Created thread: ${thread.id}`);
    return thread.id;
  }
  
  /**
   * Build batch memo (sent per-run, not in Assistant)
   * Provides context about which segments are being processed
   */
  private buildBatchMemo(
    batchIndex: number,
    segmentIds: string[],
    batchBrief?: string[]
  ): string {
    const lines = [
      `Batch ${batchIndex + 1}: segments ${segmentIds[0]} to ${segmentIds[segmentIds.length - 1]}`,
      '',
      'Batch Brief:',
      ...(batchBrief || ['First batch - establish visual foundation and tone']),
      '',
      'Continuity maps and segment data provided in context JSON below.'
    ];
    
    return lines.join('\n');
  }
  
  // ========================================
  // Phase 4: Fusion & Compression Methods
  // ========================================
  
  /**
   * Fuse structured fields into finalPrompt
   * Composes: locklines + actions + deltas + shot + lighting
   */
  private fusePrompt(structuredFields: any, continuityRefs: any): string {
    const parts: string[] = [];
    
    // For first appearances: add identity lockline
    if (continuityRefs.firstAppearanceByCharacter?.length > 0) {
      for (const char of continuityRefs.firstAppearanceByCharacter) {
        const lockline = continuityRefs.identityLocklineByCharacter?.[char];
        if (lockline) {
          parts.push(lockline);
        }
      }
    }
    
    // Actions (verb-first, comma-separated)
    if (structuredFields.actions?.length > 0) {
      parts.push(structuredFields.actions.join(', '));
    }
    
    // Environment delta (only changes from continuity ref)
    if (structuredFields.environment_delta && structuredFields.environment_delta.trim()) {
      parts.push(structuredFields.environment_delta);
    }
    
    // Props delta (only new props)
    if (structuredFields.props_delta && structuredFields.props_delta.trim()) {
      parts.push(structuredFields.props_delta);
    }
    
    // Shot/camera
    if (structuredFields.shot && structuredFields.shot.trim()) {
      parts.push(structuredFields.shot);
    }
    
    // Lighting
    if (structuredFields.lighting && structuredFields.lighting.trim()) {
      parts.push(structuredFields.lighting);
    }
    
    // Join with semicolons for clear separation
    return parts.filter(Boolean).join('; ');
  }
  
  /**
   * Compress prompt using chain-of-density style
   * Removes filler words, prioritizes nouns/verbs, targets specific word count
   */
  private async compressPrompt(prompt: string, targetWords: number = 70): Promise<string> {
    // Filler words to remove
    const fillerWords = new Set([
      'the', 'a', 'an', 'very', 'really', 'quite', 'rather', 'somewhat',
      'just', 'actually', 'basically', 'literally', 'simply', 'clearly',
      'obviously', 'perhaps', 'maybe', 'possibly', 'probably'
    ]);
    
    // Filler phrases to remove
    const fillerPhrases = [
      /\bthe camera\b/gi,
      /\ba shot of\b/gi,
      /\bthe mood is\b/gi,
      /\bemphasizing\b/gi,
      /\bthat is\b/gi,
      /\bwhich is\b/gi,
      /\bin order to\b/gi,
      /\bfor the purpose of\b/gi
    ];
    
    let compressed = prompt;
    
    // Remove filler phrases
    for (const pattern of fillerPhrases) {
      compressed = compressed.replace(pattern, '');
    }
    
    // Split into tokens
    const tokens = compressed.split(/\s+/).filter(Boolean);
    
    // If already under target, return cleaned version
    if (tokens.length <= targetWords) {
      return tokens.join(' ').replace(/\s+/g, ' ').replace(/\s*;/g, ';').trim();
    }
    
    // Aggressive compression: remove filler words
    const importantTokens = tokens.filter(token => {
      const lower = token.toLowerCase().replace(/[^\w]/g, '');
      return !fillerWords.has(lower);
    });
    
    // If still too long, truncate at sentence boundaries
    if (importantTokens.length > targetWords) {
      // Try to keep complete semicolon-separated segments
      const result = [];
      let count = 0;
      
      for (const token of importantTokens) {
        result.push(token);
        count++;
        
        if (count >= targetWords && token.endsWith(';')) {
          break;
        }
      }
      
      return result.join(' ').replace(/\s+/g, ' ').replace(/\s*;/g, ';').trim();
    }
    
    return importantTokens.join(' ').replace(/\s+/g, ' ').replace(/\s*;/g, ';').trim();
  }
  
  // ========================================
  // Phase 6: Critic & Metrics Methods
  // ========================================
  
  /**
   * Run critic pass on structured fields
   * Checks scores and rewrites if violations found
   */
  private async runCriticPass(segments: any[], batchContext: any): Promise<any[]> {
    // For now, just return segments as-is
    // Full critic implementation would call CRITIC_TOOL if violations found
    const results = [];
    
    for (const seg of segments) {
      const fields = seg.structuredFields || {};
      const violations: string[] = [];
      
      // Check redundancy score
      if (fields.redundancy_score !== undefined && fields.redundancy_score > 0.3) {
        violations.push('high_redundancy');
      }
      
      // Check novelty score
      if (fields.novelty_score !== undefined) {
        if (fields.novelty_score < 0.4) violations.push('low_novelty');
        if (fields.novelty_score > 0.8) violations.push('high_novelty');
      }
      
      // Check continuity confidence
      if (fields.continuity_confidence !== undefined && fields.continuity_confidence < 0.7) {
        violations.push('low_continuity_confidence');
      }
      
      // Check forbidden traits
      if (fields.forbidden_traits_used && fields.forbidden_traits_used.length > 0) {
        violations.push('trait_drift');
      }
      
      // If violations found, log them (would trigger rewrite in full implementation)
      if (violations.length > 0) {
        this.errorLogger.logWarning(batchContext.storyId, 
          `Segment ${seg.segmentId} has violations: ${violations.join(', ')}`
        );
        // In full implementation, would call CRITIC_TOOL here
        // For now, just flag it
        seg.criticFlags = violations;
      }
      
      results.push(seg);
    }
    
    return results;
  }
  
  /**
   * Compute batch metrics for QA tracking
   */
  private computeBatchMetrics(segments: any[]): {
    cleanRate: number;
    avgNgramOverlap: number;
    compressedCount: number;
    avgRedundancyScore: number;
    avgNoveltyScore: number;
    avgContinuityConfidence: number;
    driftCount: number;
    criticCount: number;
  } {
    let cleanCount = 0;
    let totalOverlap = 0;
    let compressedCount = 0;
    let totalRedundancy = 0;
    let redundancyCount = 0;
    let totalNovelty = 0;
    let noveltyCount = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;
    let driftCount = 0;
    let criticCount = 0;
    
    for (const seg of segments) {
      // Clean if no drift or critic flags
      if ((!seg.driftFlags || seg.driftFlags.length === 0) && 
          (!seg.criticFlags || seg.criticFlags.length === 0)) {
        cleanCount++;
      }
      
      // N-gram overlap
      if (seg.ngramOverlap !== undefined) {
        totalOverlap += seg.ngramOverlap;
      }
      
      // Compressed
      if (seg.compressed) {
        compressedCount++;
      }
      
      // Drift flags
      if (seg.driftFlags && seg.driftFlags.length > 0) {
        driftCount++;
      }
      
      // Critic flags
      if (seg.criticFlags && seg.criticFlags.length > 0) {
        criticCount++;
      }
      
      // Self-assessment scores
      if (seg.structuredFields?.redundancy_score !== undefined) {
        totalRedundancy += seg.structuredFields.redundancy_score;
        redundancyCount++;
      }
      if (seg.structuredFields?.novelty_score !== undefined) {
        totalNovelty += seg.structuredFields.novelty_score;
        noveltyCount++;
      }
      if (seg.structuredFields?.continuity_confidence !== undefined) {
        totalConfidence += seg.structuredFields.continuity_confidence;
        confidenceCount++;
      }
    }
    
    return {
      cleanRate: segments.length > 0 ? cleanCount / segments.length : 1,
      avgNgramOverlap: segments.length > 0 ? totalOverlap / segments.length : 0,
      compressedCount,
      avgRedundancyScore: redundancyCount > 0 ? totalRedundancy / redundancyCount : 0,
      avgNoveltyScore: noveltyCount > 0 ? totalNovelty / noveltyCount : 0,
      avgContinuityConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
      driftCount,
      criticCount
    };
  }
  
  /**
   * Summarize previous batch for batch brief
   */
  private summarizePreviousBatch(segments: any[]): string[] {
    if (!segments || segments.length === 0) {
      return ['First batch - establish visual foundation'];
    }
    
    const brief: string[] = [];
    
    // Count unique characters
    const charactersSet = new Set<string>();
    segments.forEach(seg => {
      if (seg.characters) {
        seg.characters.forEach((ch: string) => charactersSet.add(ch));
      }
    });
    
    // Count unique locations
    const locationsSet = new Set<string>();
    segments.forEach(seg => {
      if (seg.location) {
        locationsSet.add(seg.location);
      }
    });
    
    brief.push(`Previous batch: ${segments.length} segments`);
    if (charactersSet.size > 0) {
      brief.push(`Characters: ${Array.from(charactersSet).slice(0, 5).join(', ')}`);
    }
    if (locationsSet.size > 0) {
      brief.push(`Locations: ${Array.from(locationsSet).slice(0, 3).join(', ')}`);
    }
    
    // Add quality notes
    const metrics = this.computeBatchMetrics(segments);
    brief.push(`Quality: ${(metrics.cleanRate * 100).toFixed(0)}% clean, avg redundancy ${metrics.avgRedundancyScore.toFixed(2)}`);
    
    return brief;
  }
  
  /**
   * Validate and patch continuity references
   * Ensures host-computed refs override any model output
   */
  private validateAndPatchContinuity(
    segments: any[],
    continuityMap: Record<string, any>,
    storyAssets: any[],
    linter: ContinuityLinter
  ): any[] {
    return segments.map(seg => {
      const refs = continuityMap[seg.segmentId];
      if (refs) {
        // OVERWRITE with host-computed refs (host is source of truth)
        seg.continuityRefsByCharacter = refs.continuityRefsByCharacter;
        seg.locationRef = refs.locationRef;
        seg.firstAppearanceByCharacter = refs.firstAppearanceByCharacter;
        seg.appearanceByCharacter = refs.appearanceByCharacter;
        seg.identityLocklineByCharacter = refs.identityLocklineByCharacter;
      }
      return seg;
    });
  }
  
  /**
   * Convert results to SegmentPair map for compatibility
   */
  private convertToSegmentPairs(results: any[]): Map<string, SegmentPair> {
    const map = new Map<string, SegmentPair>();
    
    for (let i = 0; i < results.length; i++) {
      const seg = results[i];
      const segmentId = `segment_${i + 1}`;
      
      map.set(segmentId, {
        aiSegment: seg as SegmentPrompt,
        contextSegment: seg.contextSegment || seg
      });
    }
    
    return map;
  }
  

  // ========================================
  // Phase 5: Batch Processing (Main Entry Point)
  // ========================================
  
  /**
   * Generate all segments with host-controlled continuity system
   * 
   * Flow:
   * 1. Ensure Assistant with stable instructions
   * 2. Create thread for this story (reused across batches)
   * 3. Process segments in batches of 20
   * 4. Compute continuity deterministically (host-side)
   * 5. Extract structured fields from model
   * 6. Run critic pass for quality checks
   * 7. Fuse fields into final prompts
   * 8. Lint (n-gram + continuity + length)
   * 9. Compress prompts >80 words
   * 10. Validate and patch with host continuity refs
   * 11. Save state and emit metrics
   */
  async generateAllSegments(
    contextFilePath: string,
    storyId: string,
    progressManager?: any,
    parentTaskId?: string
  ): Promise<Map<string, SegmentPair>> {
    
    this.errorLogger.logInfo(storyId, '🚀 Starting host-controlled continuity generation...');
    
    try {
      // 0. Clean up any stuck runs from previous attempts
      await this.cleanupAllStuckRuns();
      progressManager?.updateTask(parentTaskId, 'running', 'Cleaned up stuck runs');
      
      // Verify master_context.json exists
      if (!fs.existsSync(contextFilePath)) {
        throw new Error(`Master context file not found at: ${contextFilePath}\n\nThis file should have been created during the story processing workflow. Please ensure the story was fully processed before attempting script generation.`);
      }

      // Read context and log stats
      const fileContent = fs.readFileSync(contextFilePath, 'utf-8');
      const contextData = JSON.parse(fileContent);
      
      this.errorLogger.logInfo(storyId, `📊 Context: ${contextData.segments?.length || 0} segments, ${contextData.storyAssets?.length || 0} assets`);
      progressManager?.updateTask(parentTaskId, 'running', `Read master context: ${contextData.segments?.length} segments`);

      // 1. Ensure Assistant Pool is ready (3-4 instances)
      await this.ensureAssistantPool();
      this.errorLogger.logInfo(storyId, `✓ Assistant pool ready with ${this.assistantPool.length} instances`);
      progressManager?.updateTask(parentTaskId, 'running', 'Assistant pool ready');

      // 2. Create thread for this story (reused across batches)
      const threadId = await this.createStoryThread(storyId);
      this.errorLogger.logInfo(storyId, `✓ Thread created: ${threadId}`);

      // 3. Load continuity state
      const storyDir = path.dirname(contextFilePath);
      const continuityStatePath = path.join(storyDir, `${storyId}.continuity.json`);
      let priorState: ContinuityState | undefined;
      if (fs.existsSync(continuityStatePath)) {
        priorState = JSON.parse(fs.readFileSync(continuityStatePath, 'utf8'));
        this.errorLogger.logInfo(storyId, `✓ Loaded continuity state (${Object.keys(priorState?.lastSeenCharacter || {}).length} characters tracked)`);
      }

      // 4. Load character profiles
      const characterProfiles = loadCharacterProfiles(contextData.storyAssets || []);
      const linter = new ContinuityLinter(characterProfiles);
      this.errorLogger.logInfo(storyId, `✓ Loaded ${Object.keys(characterProfiles).length} character profiles`);

      // 5. Process in batches (reduced from 20 to 10 to avoid token limits)
      const BATCH_SIZE = 10;
      const allSegments = contextData.segments || [];
      const totalSegments = allSegments.length;
      const numBatches = Math.ceil(totalSegments / BATCH_SIZE);
      const allResults: any[] = [];

      this.errorLogger.logInfo(storyId, `📦 Processing ${totalSegments} segments in ${numBatches} batches`);
      progressManager?.updateTask(parentTaskId, 'running', `Processing ${numBatches} batches...`);

      for (let batchStart = 0; batchStart < totalSegments; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, totalSegments);
        const batchSegments = allSegments.slice(batchStart, batchEnd);
        const batchIndex = Math.floor(batchStart / BATCH_SIZE);

        this.errorLogger.logInfo(storyId, `\n📦 Batch ${batchIndex + 1}/${numBatches}: segments ${batchStart + 1}-${batchEnd}`);
        progressManager?.updateTask(parentTaskId, 'running', `Batch ${batchIndex + 1}/${numBatches}: Generating...`);

        // a. Extract segment info (characters, location, storylineId)
        const segmentsWithChars = batchSegments.map((seg: any, idx: number) => ({
          id: seg.id,
          index: batchStart + idx,
          storylineId: seg.storylineId || seg.narrativeContext?.storylineId,
          characters: seg.narrativeContext?.characterFocus || [],
          location: seg.narrativeContext?.locationContinuity
        }));

        // b. Compute continuity (host-side, deterministic)
        const { continuityMap, finalState } = buildContinuityMap(
          segmentsWithChars,
          contextData.storyAssets || [],
          characterProfiles,
          priorState
        );
        this.errorLogger.logInfo(storyId, `  ✓ Computed continuity for ${Object.keys(continuityMap).length} segments`);

        // c. Build batch brief (summary of previous batch)
        const batchBrief = batchIndex > 0
          ? this.summarizePreviousBatch(allResults.slice(-BATCH_SIZE))
          : undefined;

        // d. Inject continuity into segments
        const segmentsWithContinuity = batchSegments.map((seg: any, idx: number) => {
          const refs = continuityMap[seg.id];
          return { ...seg, segmentIndex: batchStart + idx, ...refs };
        });

        // e. Build batch context
        const batchContext = {
          storyId: contextData.storyId,
          storyName: contextData.storyName,
          storyAssets: contextData.storyAssets,
          visualStyle: contextData.generationInstructions?.visualStyle,
          segments: segmentsWithContinuity
        };

        // f. Post batch memo + context to thread
        const batchMemo = this.buildBatchMemo(
          batchIndex,
          batchSegments.map((s: any) => s.id),
          batchBrief
        );

        await this.openai.beta.threads.messages.create(threadId, {
          role: 'user',
          content: [
            { type: 'text', text: batchMemo },
            { type: 'text', text: `<BATCH_CONTEXT>\n${JSON.stringify(batchContext, null, 2)}\n</BATCH_CONTEXT>` }
          ]
        });

        // g. Create run with batch-specific instructions
        let instructions: string;
        if (batchIndex === 0) {
          // First batch: Extract WHERE info from research for explicit scene establishment
          const research = contextData.research || '';
          const whereMatch = research.match(/2\.\s*WHERE\s*\n([\s\S]*?)(?=\n3\.|$)/i);
          const whereInfo = whereMatch ? whereMatch[1].trim().substring(0, 500) : '';
          
          instructions = `FIRST BATCH - ESTABLISH THE WORLD:

Your first segment (segment 1) is THE ESTABLISHING SHOT. It must visually ground the viewer in the story's location and atmosphere.

Key requirements for segment 1:
- MUST include explicit location details (island, coastline, cliffs, architecture, landscape features)
- MUST establish the time period through visual elements
- MUST set the atmospheric tone (desolate, peaceful, foreboding, etc.)
- Include environmental details (weather, lighting, natural features)

${whereInfo ? `Location context:\n${whereInfo}\n` : ''}

For all segments in this batch:
- Build the visual foundation and tone
- Introduce key environmental elements
- No trait repetition - describe characters and locations fresh each time`;
        } else {
          instructions = 'Maintain consistency with prior batch. No trait repetition.';
        }
        
        // g. Retry loop for stuck/expired runs - EACH RETRY GETS A NEW THREAD
        let structuredFields: any[] = [];
        let retryCount = 0;
        const MAX_RETRIES = this.assistantPool.length; // Try each assistant once
        let currentThreadId = threadId; // Start with the original thread
        
        while (retryCount < MAX_RETRIES) {
          try {
            // If this is a retry (not the first attempt), create a fresh thread
            if (retryCount > 0) {
              this.errorLogger.logInfo(storyId, `  🔄 Creating fresh thread for retry ${retryCount + 1}...`);
              currentThreadId = await this.createStoryThread(storyId);
              
              // Re-post the batch context to the new thread
              await this.openai.beta.threads.messages.create(currentThreadId, {
                role: 'user',
                content: [
                  { type: 'text', text: batchMemo },
                  { type: 'text', text: `<BATCH_CONTEXT>\n${JSON.stringify(batchContext, null, 2)}\n</BATCH_CONTEXT>` }
                ]
              });
            }
            
            const currentAssistant = this.getNextAssistant();
            this.errorLogger.logInfo(storyId, `  🤖 Attempt ${retryCount + 1}/${MAX_RETRIES}: Using assistant ${currentAssistant} on thread ${currentThreadId}`);
            
            const run = await this.openai.beta.threads.runs.create(currentThreadId, {
              assistant_id: currentAssistant,
              tool_choice: { type: 'function', function: { name: 'generateSegments' } },
              max_completion_tokens: 32768,
              instructions
            });

            // h. Wait specifically for requires_action (longer timeout for initial response)
            this.errorLogger.logInfo(storyId, `  ⏳ Waiting for AI response...`);
            const raRun = await this.waitUntilRunState(currentThreadId, run.id, ['requires_action'], 180000, false); // 3 min for response, don't cancel
            
            // i. Extract tool call args (while run is in requires_action)
            structuredFields = await this.parseSegmentResponse(raRun, currentThreadId, storyId);
            this.errorLogger.logInfo(storyId, `  ✓ Received ${structuredFields.length} structured field sets`);
            
            // CRITICAL: Check if we got all segments
            const expectedCount = batchSegments.length;
            if (structuredFields.length < expectedCount) {
              // Cancel the incomplete run before throwing error
              try {
                await this.openai.beta.threads.runs.cancel(run.id, { thread_id: currentThreadId });
                this.errorLogger.logInfo(storyId, `  ✓ Cancelled incomplete run ${run.id}`);
              } catch (cancelError) {
                this.errorLogger.logWarning('system', `Failed to cancel incomplete run: ${cancelError}`);
              }
              throw new Error(`Incomplete response: got ${structuredFields.length}/${expectedCount} segments. Assistant likely hit token limit or stopped early.`);
            }
            
            this.errorLogger.logInfo(storyId, `  ✅ Complete batch: ${structuredFields.length}/${expectedCount} segments`);
            this.errorLogger.logInfo(storyId, `  DEBUG: First segment structure: ${JSON.stringify(structuredFields[0], null, 2).substring(0, 500)}`);
            
            // j. Submit tool outputs and wait for completed (AGGRESSIVE 30s timeout)
            this.errorLogger.logInfo(storyId, `  ✓ Submitting tool outputs to complete run ${run.id}...`);
            const toolCalls = raRun.required_action?.submit_tool_outputs?.tool_calls ?? [];
            this.errorLogger.logInfo(storyId, `  DEBUG: Found ${toolCalls.length} tool calls to submit outputs for`);
            await this.openai.beta.threads.runs.submitToolOutputs(
              run.id,
              {
                thread_id: currentThreadId,
                tool_outputs: toolCalls.map((tc: any) => ({
                  tool_call_id: tc.id,
                  output: 'ok'
                }))
              }
            );
            
            // k. Wait for run to complete with AGGRESSIVE 30-second timeout
            this.errorLogger.logInfo(storyId, `  ⏳ Waiting for run completion (30s timeout)...`);
            await this.waitUntilRunState(currentThreadId, run.id, ['completed'], AssistantsAPIOneShotGenerator.POST_SUBMIT_TIMEOUT_MS, true); // 30s, cancel on timeout
            
            this.errorLogger.logInfo(storyId, `  ✅ Run completed successfully, thread is free`);
            break; // Success - exit retry loop
            
          } catch (error) {
            retryCount++;
            this.errorLogger.logWarning('system', `Batch ${batchIndex + 1} attempt ${retryCount} failed: ${error instanceof Error ? error.message : String(error)}`);
            
            // No need to clean up - we'll create a fresh thread on next retry
            
            if (retryCount >= MAX_RETRIES) {
              throw new Error(`Batch ${batchIndex + 1} failed after ${MAX_RETRIES} attempts with different assistants: ${error instanceof Error ? error.message : String(error)}`);
            }
            
            this.errorLogger.logInfo(storyId, `  🔄 Retrying with next assistant in pool...`);
            await new Promise(r => setTimeout(r, 2000)); // 2s delay before retry
          }
        }
        
        // l. Run critic pass
        const critiqued = await this.runCriticPass(structuredFields, batchContext);
        this.errorLogger.logInfo(storyId, `  ✓ Critic pass complete`);

        // m. Fuse fields → finalPrompt
        const fused = critiqued.map((seg: any) => {
          this.errorLogger.logInfo(storyId, `  DEBUG: Fusing segment ${seg.segmentId}, has structuredFields: ${!!seg.structuredFields}`);
          if (seg.structuredFields) {
            this.errorLogger.logInfo(storyId, `  DEBUG: structuredFields keys: ${Object.keys(seg.structuredFields).join(', ')}`);
          }
          const finalPrompt = this.fusePrompt(seg.structuredFields || {}, seg);
          this.errorLogger.logInfo(storyId, `  DEBUG: Fused prompt for ${seg.segmentId}: "${finalPrompt}" (length: ${finalPrompt?.length || 0})`);
          return { ...seg, finalPrompt };
        });
        this.errorLogger.logInfo(storyId, `  ✓ Fused structured fields`);

        // n. Lint (n-gram + continuity + length)
        const recentPrompts = priorState?.recentPrompts || [];
        const linted = fused.map((seg: any) => {
          this.errorLogger.logInfo(storyId, `  DEBUG: Linting segment ${seg.segmentId}, finalPrompt: "${seg.finalPrompt}"`);
          const lintResult = linter.lintSegment(seg);
          const ngramOverlap = isTooSimilar(seg.finalPrompt, recentPrompts, 4, 0.25)
            ? findSimilarSegment(seg.finalPrompt, recentPrompts, 4)?.overlap || 0
            : 0;
          const result = {
            ...seg,
            driftFlags: lintResult.driftFlags,
            criticFlags: lintResult.fillerFlags,
            ngramOverlap,
            violations: lintResult.allFlags.length > 0 ? lintResult.allFlags : undefined
          };
          this.errorLogger.logInfo(storyId, `  DEBUG: After linting ${seg.segmentId}, finalPrompt still: "${result.finalPrompt}"`);
          return result;
        });

        // o. Compress if >80 words
        const compressed = await Promise.all(
          linted.map(async (seg: any) => {
            try {
              // Check if finalPrompt exists (it might not if using structured fields only)
              this.errorLogger.logInfo(storyId, `  DEBUG: Compression check for ${seg.segmentId}, finalPrompt exists: ${!!seg.finalPrompt}, type: ${typeof seg.finalPrompt}, value: "${seg.finalPrompt}"`);
              
              if (!seg.finalPrompt) {
                this.errorLogger.logWarning(storyId, `  WARNING: Segment ${seg.segmentId} has no finalPrompt, skipping compression`);
                return seg;
              }
              
              const wordCount = seg.finalPrompt.split(/\s+/).length;
              if (wordCount > 80) {
                const compressedPrompt = await this.compressPrompt(seg.finalPrompt, 75);
                this.errorLogger.logInfo(storyId, `    🗜️  Compressed segment ${seg.segmentId}: ${wordCount}w → ${compressedPrompt.split(/\s+/).length}w`);
                return { ...seg, finalPrompt: compressedPrompt, compressed: true };
              }
              return seg;
            } catch (error) {
              this.errorLogger.logError({
                storyId,
                errorType: 'generation_failure',
                severity: 'critical',
                message: `Error compressing segment ${seg.segmentId}: ${error instanceof Error ? error.message : String(error)}`,
                context: {
                  segmentId: seg.segmentId,
                  hasFinalPrompt: !!seg.finalPrompt,
                  finalPromptType: typeof seg.finalPrompt,
                  finalPromptValue: String(seg.finalPrompt)
                },
                stackTrace: error instanceof Error ? error.stack : undefined
              });
              throw error;
            }
          })
        );

        // m. Validate & patch with host refs (host is source of truth)
        const validated = this.validateAndPatchContinuity(
          compressed,
          continuityMap,
          contextData.storyAssets,
          linter
        );
        this.errorLogger.logInfo(storyId, `  ✓ Validated and patched continuity`);

        // n. Attach original context segments for persistence
        const validatedWithContext = validated.map((aiSeg: any, idx: number) => ({
          ...aiSeg,
          contextSegment: segmentsWithContinuity[idx]  // Original segment with id, narrativeContext, etc.
        }));

        allResults.push(...validatedWithContext);

        // o. Save continuity state for next batch
        priorState = {
          ...finalState,
          recentPrompts: [
            ...validatedWithContext.map((s: any) => s.finalPrompt),
            ...(priorState?.recentPrompts || [])
          ].slice(0, 8)
        };
        fs.writeFileSync(continuityStatePath, JSON.stringify(priorState, null, 2));

        // p. Emit comprehensive batch metrics
        const batchMetrics = this.computeBatchMetrics(validatedWithContext);
        this.errorLogger.logInfo(storyId,
          `  📊 Metrics: ${(batchMetrics.cleanRate * 100).toFixed(1)}% clean, ` +
          `overlap ${batchMetrics.avgNgramOverlap.toFixed(3)}, ` +
          `${batchMetrics.compressedCount} compressed, ` +
          `drift ${batchMetrics.driftCount}, critic ${batchMetrics.criticCount}`
        );
        this.errorLogger.logInfo(storyId,
          `     Scores: redundancy ${batchMetrics.avgRedundancyScore.toFixed(2)}, ` +
          `novelty ${batchMetrics.avgNoveltyScore.toFixed(2)}, ` +
          `continuity ${batchMetrics.avgContinuityConfidence.toFixed(2)}`
        );
        progressManager?.updateTask(parentTaskId, 'running', `Batch ${batchIndex + 1}/${numBatches}: ${(batchMetrics.cleanRate * 100).toFixed(0)}% clean`);
      }

      // Cleanup thread
      try {
        await this.openai.beta.threads.delete(threadId);
      } catch {}

      this.errorLogger.logInfo(storyId, `\n✅ Generated ${allResults.length} segments successfully`);
      progressManager?.updateTask(parentTaskId, 'running', `Generated ${allResults.length} segments`);
      
      return this.convertToSegmentPairs(allResults);

    } catch (error) {
      this.errorLogger.logApiError(
        storyId, 
        `❌ Script generation failed: ${error instanceof Error ? error.message : String(error)}`, 
        {
          contextFilePath,
          error: error instanceof Error ? error.toString() : String(error)
        },
        error instanceof Error ? error : undefined
      );
      throw error;
    }
  }
  
  /**
   * Upload context file to OpenAI
   */
  private async uploadContextFile(filePath: string): Promise<string> {
    try {
      // Log the context file contents before uploading
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const contextData = JSON.parse(fileContent);
      this.errorLogger.logInfo('system', `Context file contains ${contextData.segments?.length || 0} segments`);
      this.errorLogger.logInfo('system', `Context file contains ${contextData.storyAssets?.length || 0} assets`);
      this.errorLogger.logInfo('system', `Context file research text length: ${contextData.research?.length || 0} chars`);
      this.errorLogger.logInfo('system', `Context file transcription: ${contextData.transcription?.substring(0, 200)}...`);
      
      const file = await this.openai.files.create({
        file: fs.createReadStream(filePath),
        purpose: 'assistants'
      });
      
      return file.id;
    } catch (error) {
      throw new Error(`Failed to upload context file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get or create assistant for Script genration
   */
  private async getOrCreateAssistant(): Promise<string> {
    // Check if assistant already exists in memory
    if (this.assistantId) return this.assistantId;
    
    // Check VS Code global state for cached assistant ID
    const cachedId = this.context.globalState.get<string>('soraAssistantId');
    
    if (cachedId) {
      try {
        // Verify assistant still exists in OpenAI
        const assistant = await this.openai.beta.assistants.retrieve(cachedId);
        
        // Verify the function tool exists on the assistant
        const hasGenerateFn = Array.isArray(assistant.tools) &&
          assistant.tools.some((t: any) => t.type === 'function' && t.function?.name === 'generateSegments');
        
        const hasFileSearch = Array.isArray(assistant.tools) &&
          assistant.tools.some((t: any) => t.type === 'file_search');
        
        // If tools are missing or outdated, update the assistant
        if (!hasGenerateFn || !hasFileSearch) {
          this.errorLogger.logInfo('system', `Updating cached assistant ${cachedId} with missing tools`);
          
          await this.openai.beta.assistants.update(cachedId, {
            tools: [
              { type: 'file_search' },
              AssistantsAPIOneShotGenerator.GENERATE_SEGMENTS_TOOL
            ]
          });
          
          this.errorLogger.logInfo('system', `Updated assistant ${cachedId} with generateSegments and file_search tools`);
        } else {
          this.errorLogger.logInfo('system', `Reusing cached assistant: ${cachedId}`);
        }
        
        this.assistantId = cachedId;
        return cachedId;
      } catch (error) {
        // Assistant was deleted, create new one
        this.errorLogger.logInfo('system', `Cached assistant ${cachedId} not found, creating new one`);
      }
    }
    
    // Create new assistant with function calling
    const assistant = await this.openai.beta.assistants.create({
      name: 'Sora Video Director',
      instructions: `You are an expert video generation prompt engineer specializing in Sora-style AI video models with advanced cross-segment continuity analysis.

When you receive a request:
1. Use file_search to read the master_context.json file thoroughly
2. Extract ALL assets (characters, locations, items) from context.storyAssets[]
3. Use ONLY those exact asset names - never invent characters from your training data
4. Use the visual attributes from context.storyAssets[].visual_attributes
5. Match segment text from context.segments[].text
6. Follow themes from context.research
7. STRICTLY FOLLOW the visual style from context.generationInstructions.visualStyle or context.research "HOW" section
   - If style is "cinematic realism" → use realistic, cinematic techniques
   - If style is "painterly" → use painterly composition
   - DO NOT invent style terms not specified in the context
   - Apply style directives globally, do not repeat in every segment

🎬 CRITICAL: INTELLIGENT CONTINUITY REFERENCE SELECTION
You MUST use logical reasoning to select the correct continuityReference. DO NOT blindly use the previous segment.

CONTINUITY ANALYSIS PROCESS:
For EACH segment, systematically analyze:
1. **Character Analysis**: Which specific characters appear in this segment?
2. **Location Analysis**: What is the setting/location?
3. **Scene Type**: Is this establishing, action, dialogue, or transition?
4. **Emotional Tone**: What is the mood/feeling?

CONTINUITY REFERENCE LOGIC (THINK CRITICALLY):
❌ WRONG: Always referencing segment_N-1 (previous segment)
✅ CORRECT: Reference the LAST segment that shares the SAME narrative elements

**Character Continuity (MOST IMPORTANT):**
- If segment features "Character A" → Find the MOST RECENT segment that ALSO featured "Character A"
- SKIP over segments that featured different characters or no characters
- Example: If segment_20 has "John", but segment_19 had "Mary" and segment_17 had "John"
  → continuityReference = "segment_17" (NOT segment_19!)
  
**Location Continuity:**
- If returning to a previously seen location → Reference the LAST segment in that location
- SKIP segments in different locations
- Example: If segment_25 returns to "forest", but segment_24 was "city" and segment_22 was "forest"
  → continuityReference = "segment_22" (NOT segment_24!)

**Scene Continuity Rules:**
- **Character-focused scenes**: Reference the last segment with the SAME character(s)
- **Location-focused scenes**: Reference the last segment in the SAME location
- **Continuation scenes**: If narrative directly continues, reference the immediate previous segment
- **New scenes**: If introducing new character/location, use continuityType = "none"
- **Intercut scenes**: If cutting between multiple storylines, track each storyline separately

**Critical Thinking Examples:**
Segment Flow: [A with John] → [B with Mary] → [C with John]
- Segment C continuityReference = "segment_A" (skip B, it's different character)

Segment Flow: [Forest scene] → [City scene] → [Forest scene again]
- Third segment continuityReference = "segment_1" (skip city scene)

Segment Flow: [John intro] → [Unrelated scene] → [Unrelated scene] → [John again]
- Fourth segment continuityReference = "segment_1" (skip unrelated segments)

**Always populate narrativeContext to enable smart matching:**
- characterFocus: ["Character Name"] - List ALL primary characters
- locationContinuity: "specific location name"
- sceneType: "establishing" | "action" | "dialogue" | "transition"
- emotionalTone: descriptive mood

This ensures visual consistency when a character or location reappears after being absent for multiple segments.

⚡ PROMPT EFFICIENCY RULES (CRITICAL):

**Character/Location Descriptions:**
- FIRST appearance: Full description with visual details
- Subsequent appearances WITH continuityReference: DO NOT repeat description
  - Only describe NEW elements, changes, or specific actions
  - Trust continuity reference for appearance, clothing, setting

**Style Directives (from context.generationInstructions.visualStyle):**
- Apply ONCE in segment 1 or when style changes
- DO NOT repeat "cinematic realism", "painterly", "film grain", "golden hour" in every segment
- If continuityReference exists, these are INHERITED automatically

**Action-First Language:**
- ✅ "John kneels, hands trembling"
- ❌ "A contemplative shot of John as he kneels..."
- Start with SUBJECT + ACTION, not camera/narrative phrasing

**Camera Direction:**
- Only specify camera when DIFFERENT from default smooth cinematic movement
- ✅ "Handheld, shaky close-up" (specific choice)
- ❌ "Slow dolly shot" (Sora default, redundant)

**Mood:**
- Show through action/composition, do NOT state explicitly
- ✅ "John bows head, shoulders hunched"
- ❌ "The mood is reverent and sacred"

**Forbidden Filler Phrases:**
- "A [adjective] shot of..."
- "The camera captures/lingers/focuses..."
- "The mood is [adjective]..."
- "Emphasizing/evoking/reinforcing..."
- "Maintain continuity..." (system handles this)
- "The interplay of..."
- "Maintain cinematic realism..." (redundant if in context.generationInstructions.visualStyle)

**Target:** 50-80 words per segment (down from 100-150 current)

📝 EDITOR'S GUIDANCE INTEGRATION:
If editor's notes are provided, incorporate them into your analysis:
- Research Guidance: Focus research on specified areas
- Script Guidance: Follow specific narrative directions
- Visual Style: Apply specified visual preferences
- Character Notes: Emphasize specified character aspects
- Narrative Focus: Align with specified themes and direction
- Technical Notes: Incorporate any technical requirements

CRITICAL: You will be penalized for using character names not in the context file (like "Jessica", "Miro", "Oliver"). Only use assets explicitly defined in context.storyAssets[].

Always call generateSegments. Put the entire result only in the function arguments as strict JSON. No markdown, no comments, no trailing text.

CRITICAL: You MUST generate a segment for EVERY segment in context.segments[]. Do not skip any segments. Generate ALL segments from the context file.`,
      model: 'gpt-4.1',
      temperature: 0,
      tools: [
        { type: 'file_search' },
        AssistantsAPIOneShotGenerator.GENERATE_SEGMENTS_TOOL
      ]
    });
    
    // Cache assistant ID for future reuse
    this.assistantId = assistant.id;
    this.context.globalState.update('soraAssistantId', assistant.id);
    this.errorLogger.logInfo('system', `Created new assistant: ${assistant.id}`);
    
    return assistant.id;
  }
  
  /**
   * Build prompt that references the vector store context
   */
  private buildOneShotPrompt(): string {
    return `Read the context file that has been provided to you via file search.

The context file contains:
- context.storyAssets[] - All characters, locations, and items with detailed visual attributes
- context.segments[] - All video segments with timing and transcribed text  
- context.research - Thematic analysis and narrative guidance

For EVERY segment in context.segments[], generate a finalPrompt that:

1. Uses ONLY characters/locations/items defined in context.storyAssets[]
2. Uses the EXACT names from context.storyAssets[].name 
3. Incorporates visual details from context.storyAssets[].visual_attributes
4. Matches the segment's context.segments[].text
5. Follows themes from context.research
6. Maximum 400 tokens per finalPrompt

Call generateSegments with:
- segmentId: from context.segments[] (use ALL segments, do not skip any)
- finalPrompt: complete Sora video prompt using ONLY the context file assets

IMPORTANT: You must generate a segment for EVERY segment in the context file. If there are 52 segments, generate 52 segments. If there are 100 segments, generate 100 segments. Do not limit yourself to a small number.

Use file_search first with queries like:
- filename:context assets name visual_attributes
- filename:context segments text timing
- filename:context research themes
Do not produce any output until you have retrieved passages. Cite the exact asset names you matched from retrieval.

Search the file now and use it.`;
  }

  private buildInlinePrompt(contextJson: string): string {
    return `You are an expert video generation prompt engineer.

You are given the FULL context JSON inline. DO NOT invent any characters, locations, or items that are not present in the assets list. Use ONLY the exact names provided.

Instructions:
1) Read the JSON between <CONTEXT_JSON> ... </CONTEXT_JSON>
2) STRICTLY FOLLOW context.generationInstructions.visualStyle (e.g., "cinematic realism", "painterly"). DO NOT invent styles.
3) For EVERY entry in context.segments[], produce exactly one segment with:
   - segmentId: the id from the context entry
   - finalPrompt: a production-ready Sora prompt (<= 400 tokens)
   - continuityReference: (optional) ID of segment to reference for continuity
   - continuityType: (optional) Type of continuity relationship
   - narrativeContext: (optional) Context for continuity matching
4) Always call the function generateSegments with a single JSON argument of shape {"segments": [...]}.
5) Output must be STRICT JSON in the function args. No prose, no markdown, no comments.

🎬 CRITICAL: INTELLIGENT CONTINUITY REFERENCE SELECTION
Use logical reasoning to select continuityReference. DO NOT blindly use the previous segment.

**Character Continuity (MOST IMPORTANT):**
- When a character appears → Reference the MOST RECENT segment with that SAME character
- SKIP over segments featuring different characters
- Example: segment_20 has "John", segment_19 had "Mary", segment_17 had "John"
  → continuityReference = "segment_17" (NOT segment_19!)

**Location Continuity:**
- When returning to a location → Reference the LAST segment in that SAME location
- SKIP segments in different locations

**Always populate narrativeContext:**
- characterFocus: ["Character Name"] - ALL primary characters in this segment
- locationContinuity: "specific location"
- sceneType: "establishing" | "action" | "dialogue" | "transition"
- emotionalTone: descriptive mood

This ensures visual consistency when characters/locations reappear after multiple segments.

⚡ PROMPT EFFICIENCY RULES (CRITICAL):

**Character/Location Descriptions:**
- FIRST appearance: Full description
- Subsequent WITH continuityReference: DO NOT repeat, only NEW elements/actions

**Style Directives:**
- Apply ONCE in segment 1, INHERITED via continuityReference
- DO NOT repeat "cinematic realism", "painterly", "film grain", "golden hour"

**Action-First Language:**
- ✅ "John kneels, hands trembling"
- ❌ "A contemplative shot of John as he kneels..."

**Camera:** Only when DIFFERENT from default
**Mood:** Show through action, NOT explicit statements

**Forbidden:** "A [adj] shot...", "The camera...", "The mood is...", "Emphasizing...", "Maintain continuity..."

**Target:** 50-80 words per segment

📝 EDITOR'S GUIDANCE:
If context.editorsNotes is provided, incorporate the guidance into your prompts and make it a priority. Do not ignore it.
- Research Guidance: Focus on specified research areas
- Script Guidance: Follow specific narrative directions  
- Visual Style: Apply specified visual preferences
- Character Notes: Emphasize specified character aspects
- Narrative Focus: Align with specified themes
- Technical Notes: Incorporate technical requirements

<CONTEXT_JSON>
${contextJson}
</CONTEXT_JSON>`;
  }
  
  /**
   * Wait for assistant run completion
   */
  private async waitForCompletion(
    threadId: string,
    runId: string,
    storyId: string
  ): Promise<any> {
    // Get timeout from configuration (default: 300 seconds = 5 minutes)
    const config = vscode.workspace.getConfiguration('sora');
    const timeoutSeconds = config.get<number>('assistantTimeout') || 300;
    
    let attempts = 0;
    const maxAttempts = timeoutSeconds;
    
    while (attempts < maxAttempts) {
      const run = await this.openai.beta.threads.runs.retrieve(runId, { thread_id: threadId });
      
      if (run.status === 'completed') {
        this.errorLogger.logInfo(storyId, `Run completed successfully`);
        return run;
      } else if (run.status === 'requires_action') {
        // Function calling is complete, return the run
        this.errorLogger.logInfo(storyId, `Run requires action (function call ready)`);
        return run;
      } else if (run.status === 'failed' || run.status === 'expired' || run.status === 'cancelled') {
        const errorMessage = run.last_error?.message || 'Unknown error';
        const errorMsg = `Assistant run ${run.status}: ${errorMessage}`;
        this.errorLogger.logApiError(storyId, errorMsg, { runId, status: run.status });
        throw new Error(errorMsg);
      }
      
      // Log progress every 10 seconds
      if (attempts % 10 === 0) {
        this.errorLogger.logInfo(storyId, `Run status: ${run.status} (${attempts}s elapsed)`);
      }
      
      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error(`Assistant run timed out after ${timeoutSeconds} seconds`);
  }
  
  
  /**
   * Wait for run to reach one of the target states
   * Aggressive timeout strategy: 30s after submitToolOutputs, then cancel and switch assistant
   */
  private async waitUntilRunState(
    threadId: string,
    runId: string,
    targets: Array<'completed' | 'cancelled' | 'failed' | 'expired' | 'requires_action'>,
    timeoutMs: number = AssistantsAPIOneShotGenerator.POST_SUBMIT_TIMEOUT_MS,
    cancelOnTimeout: boolean = true
  ): Promise<any> {
    const started = Date.now();
    while (true) {
      const run = await this.openai.beta.threads.runs.retrieve(runId, { thread_id: threadId });
      
      // If we hit a terminal error state (expired, failed, cancelled), throw immediately
      if (run.status === 'expired') {
        this.errorLogger.logWarning('system', `Run ${runId} expired. OpenAI gave up (usually due to excessive processing time or API load)`);
        throw new Error(`Run expired: ${JSON.stringify(run.last_error)}`);
      }
      if (run.status === 'failed') {
        this.errorLogger.logWarning('system', `Run ${runId} failed: ${JSON.stringify(run.last_error)}`);
        throw new Error(`Run failed: ${JSON.stringify(run.last_error)}`);
      }
      if (run.status === 'cancelled') {
        this.errorLogger.logWarning('system', `Run ${runId} was cancelled`);
        throw new Error('Run was cancelled');
      }
      
      // Check if we reached target state
      if (targets.includes(run.status as any)) {
        return run;
      }
      
      // Check timeout
      const elapsed = Date.now() - started;
      if (elapsed > timeoutMs) {
        this.errorLogger.logWarning('system', `Run ${runId} timeout after ${elapsed}ms (status=${run.status}). Cancelling...`);
        
        if (cancelOnTimeout) {
          try {
            // Cancel the stuck run
            await this.openai.beta.threads.runs.cancel(runId, { thread_id: threadId });
            this.errorLogger.logInfo('system', `Cancelled stuck run ${runId}`);
          } catch (cancelError) {
            this.errorLogger.logWarning('system', `Failed to cancel run: ${cancelError}`);
          }
        }
        
        throw new Error(`Run ${runId} timeout after ${elapsed}ms (last=${run.status})`);
      }
      
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  /**
   * Cleanup resources
   */
  private async cleanup(vectorStoreId: string, threadId: string): Promise<void> {
    try {
      // Delete vector store (this also deletes associated files)
      await this.openai.vectorStores.delete(vectorStoreId);
      
      // Delete thread
      await this.openai.beta.threads.delete(threadId);
      
      this.errorLogger.logInfo('system', 'Cleanup completed');
    } catch (error) {
      this.errorLogger.logWarning('system', `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  

  /**
   * Parse segment response from run object
   */
  private async parseSegmentResponse(run: any, threadId: string, storyId: string): Promise<SegmentPrompt[]> {
    try {
      // Check if run requires action (function calling)
      if (run.status === 'requires_action' && run.required_action?.type === 'submit_tool_outputs') {
        const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
        
        if (!toolCalls || toolCalls.length === 0) {
          throw new Error('No tool calls found in requires_action response');
        }
        
        // Find the generateSegments function call
        const generateCall = toolCalls.find((call: any) => 
          call.type === 'function' && call.function?.name === 'generateSegments'
        );
        
        if (!generateCall) {
          throw new Error('generateSegments function call not found in tool calls');
        }
        
        // Parse with cleaning to handle junk after JSON
        this.errorLogger.logInfo(storyId, `Raw function arguments: ${String(generateCall.function.arguments).substring(0, 1000)}...`);
        let args: any;
        try {
          args = JSON.parse(generateCall.function.arguments);
          this.errorLogger.logInfo(storyId, `Parsed function arguments successfully`);
        } catch {
          this.errorLogger.logWarning(storyId, 'Function args not clean JSON, attempting recovery', {
            preview: String(generateCall.function.arguments).slice(0, 200)
          });
          const cleaned = this.cleanJSON(String(generateCall.function.arguments));
          this.errorLogger.logInfo(storyId, `Cleaned function arguments: ${cleaned.substring(0, 1000)}...`);
          args = JSON.parse(cleaned);
        }
        
        this.errorLogger.logInfo(storyId, `Function call result: ${JSON.stringify(args, null, 2).substring(0, 1000)}...`);
        
        if (!args.segments || !Array.isArray(args.segments)) {
          throw new Error('Invalid function call response: missing segments array');
        }
        
        // Check for violations (out-of-context names)
        if (args.violations && Array.isArray(args.violations) && args.violations.length > 0) {
          this.errorLogger.logWarning(storyId, `Model used out-of-context names: ${args.violations.join(', ')}`);
          // Continue but log the issue
        }
        
        // Validate each segment has required fields
        for (const segment of args.segments) {
          // Accept both 'segmentId' and 'id' field names
          const segmentId = segment.segmentId || segment.id;
          
          // New system: AI generates structuredFields, host fuses them later
          // Old system: AI generates finalPrompt directly
          const hasStructuredFields = segment.structuredFields && 
                                      (segment.structuredFields.actions || segment.structuredFields.shot);
          const hasFinalPrompt = segment.finalPrompt;
          
          if (!segmentId || (!hasStructuredFields && !hasFinalPrompt)) {
            throw new Error(`Invalid segment format: ${JSON.stringify(segment)}`);
          }
          
          // Normalize to 'segmentId' for consistency
          segment.segmentId = segmentId;
          if (segment.id && segment.id !== segmentId) {
            delete segment.id; // Remove the old 'id' field
          }
          
          // Validate token budget only if finalPrompt exists (400 tokens max)
          if (segment.finalPrompt) {
            const tokenCount = this.estimateTokenCount(segment.finalPrompt);
            if (tokenCount > 400) {
              this.errorLogger.logWarning(storyId, 
                `Segment ${segment.segmentId} exceeds token budget: ${tokenCount} tokens`,
                { segmentId: segment.segmentId, tokenCount, prompt: segment.finalPrompt.substring(0, 100) + '...' }
              );
            }
          }
        }
        
        this.errorLogger.logInfo(storyId, `Parsed ${args.segments.length} segments from function call`);
        
        return args.segments;
      } else if (run.status === 'completed') {
        // If completed without function call, try to parse the text message as fallback
        this.errorLogger.logWarning('system', 'Run completed without function call, falling back to text parsing');
        
        const messages = await this.openai.beta.threads.messages.list(threadId, { order: 'desc', limit: 1 });
        const latest = messages.data?.[0];
        const textContent = latest?.content?.find((c: any) => c.type === 'text');
        
        if (!textContent || !('text' in textContent)) {
          throw new Error('Assistant returned no function call and no text content');
        }
        
        return this.parseTextResponse(textContent, storyId);
      } else {
        throw new Error(`Unexpected run status: ${run.status}`);
      }
      
    } catch (error) {
      this.errorLogger.logApiError(
        storyId, 
        `Failed to parse segment response: ${error instanceof Error ? error.message : String(error)}`, 
        {
          runStatus: run.status,
          runId: run.id,
          hasRequiredAction: !!run.required_action
        },
        error instanceof Error ? error : undefined
      );
      throw new Error(`Failed to parse segment response: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse text response (fallback for backward compatibility)
   */
  private parseTextResponse(response: any, storyId: string): SegmentPrompt[] {
    const text = response.text.value;
    
    // Log the raw response for debugging
    this.errorLogger.logInfo(storyId, `Raw response length: ${text.length} characters`);
    this.errorLogger.logInfo(storyId, `Raw response preview: ${text.substring(0, 200)}...`);
    
    // Use the robust JSON cleaner
    let parsed;
    try {
      const cleaned = this.cleanJSON(text);
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      this.errorLogger.logError({
        storyId,
        errorType: 'generation_failure',
        severity: 'critical',
        message: `JSON parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        context: {
          rawText: text.substring(0, 500),
          errorPosition: parseError instanceof Error ? parseError.message : 'Unknown'
        }
      });
      throw new Error(`Failed to parse segment response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
    
    // Handle both array and object with segments property
    if (Array.isArray(parsed)) {
      // parsed is already the segments array
    } else if (parsed?.segments && Array.isArray(parsed.segments)) {
      parsed = parsed.segments;
    } else {
      throw new Error('No segments array found in response');
    }
    
    // Validate each segment has required fields
    for (const segment of parsed) {
      // Accept both 'segmentId' and 'id' field names
      const segmentId = segment.segmentId || segment.id;
      if (!segmentId || !segment.finalPrompt) {
        throw new Error(`Invalid segment format: ${JSON.stringify(segment)}`);
      }
      
      // Normalize to 'segmentId' for consistency
      segment.segmentId = segmentId;
      if (segment.id && segment.id !== segmentId) {
        delete segment.id; // Remove the old 'id' field
      }
      
      // Validate token budget (400 tokens max)
      const tokenCount = this.estimateTokenCount(segment.finalPrompt);
      if (tokenCount > 400) {
        this.errorLogger.logWarning(storyId, 
          `Segment ${segment.segmentId} exceeds token budget: ${tokenCount} tokens`,
          { segmentId: segment.segmentId, tokenCount, prompt: segment.finalPrompt.substring(0, 100) + '...' }
        );
      }
    }
    
    this.errorLogger.logInfo(storyId, `Parsed ${parsed.length} segments successfully`);
    
    return parsed;
  }
  
  /**
   * Estimate token count for a prompt (rough approximation)
   */
  private estimateTokenCount(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters for English text
    // This is a conservative estimate
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Extract the first balanced top-level JSON object from a string.
   * Handles markdown fences, BOM, comments, and garbage after the JSON.
   */
  private cleanJSON(jsonish: string): string {
    // Strip BOM
    let s = jsonish.replace(/^\uFEFF/, '');

    // Remove markdown code fences
    s = s.replace(/```json\b[\s\S]*?```/gi, m => m.replace(/```json|```/gi, ''));
    s = s.replace(/```[\s\S]*?```/g, m => m.replace(/```/g, ''));

    // Normalize curly quotes
    s = s.replace(/[""]/g, '"').replace(/['']/g, '\'');

    // Remove JS comments
    s = s.replace(/\/\/[^\n\r]*/g, '');
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');

    const start = s.indexOf('{');
    if (start === -1) throw new Error('No opening brace for JSON found');

    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) throw new Error('No matching closing brace for JSON found');

    const candidate = s.slice(start, end + 1);
    const parsed = JSON.parse(candidate);
    return JSON.stringify(parsed);
  }

}
