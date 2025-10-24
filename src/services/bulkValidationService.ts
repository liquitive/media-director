/**
 * Bulk Validation Service - Single validation call for all segments
 * Uses Assistants API with file attachment for comprehensive validation
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import * as vscode from 'vscode';
import { SegmentPrompt } from '../types/asset.types';
import { Story } from '../models/story';
import { ExplicitErrorLogger } from '../utils/explicitErrorLogger';

export interface ValidationResult {
  isValid: boolean;
  totalSegments: number;
  errors: ValidationError[];
  summary: {
    totalErrors: number;
    criticalErrors: number;
    warnings: number;
    overallQuality: 'excellent' | 'good' | 'fair' | 'poor';
  };
}

export interface ValidationError {
  id: string;
  type: 'character_inconsistency' | 'asset_missing' | 'temporal_logic' | 'narrative_flow' | 'visual_coherence';
  segmentIds: string[];
  description: string;
  severity: 'critical' | 'warning';
  suggestedFix: string;
}

export class BulkValidationService {
  private openai: OpenAI;
  private context: vscode.ExtensionContext;
  private errorLogger: ExplicitErrorLogger;
  private workspaceRoot: string;
  
  // Shared function tool definition to avoid duplication
  private static readonly VALIDATE_SEGMENTS_TOOL = {
    type: 'function' as const,
    function: {
      name: 'validateSegments',
      description: 'Validate video segments for consistency and quality issues',
      parameters: {
        type: 'object',
        properties: {
          isValid: {
            type: 'boolean',
            description: 'Whether all segments pass validation'
          },
          totalSegments: {
            type: 'number',
            description: 'Total number of segments analyzed'
          },
          errors: {
            type: 'array',
            description: 'List of validation errors found',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Unique error identifier'
                },
                type: {
                  type: 'string',
                  enum: ['character_inconsistency', 'asset_missing', 'temporal_logic', 'narrative_flow', 'visual_coherence'],
                  description: 'Type of validation error'
                },
                segmentIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'IDs of segments affected by this error'
                },
                description: {
                  type: 'string',
                  description: 'Detailed description of the error'
                },
                severity: {
                  type: 'string',
                  enum: ['critical', 'warning'],
                  description: 'Severity level of the error'
                },
                suggestedFix: {
                  type: 'string',
                  description: 'How to fix this error'
                }
              },
              required: ['id', 'type', 'segmentIds', 'description', 'severity', 'suggestedFix']
            }
          },
          summary: {
            type: 'object',
            description: 'Summary of validation results',
            properties: {
              totalErrors: {
                type: 'number',
                description: 'Total number of errors found'
              },
              criticalErrors: {
                type: 'number',
                description: 'Number of critical errors'
              },
              warnings: {
                type: 'number',
                description: 'Number of warning-level errors'
              },
              overallQuality: {
                type: 'string',
                enum: ['excellent', 'good', 'fair', 'poor'],
                description: 'Overall quality assessment'
              }
            },
            required: ['totalErrors', 'criticalErrors', 'warnings', 'overallQuality']
          }
        },
        required: ['isValid', 'totalSegments', 'errors', 'summary']
      }
    }
  };
  
  constructor(
    apiKey: string,
    context: vscode.ExtensionContext,
    errorLogger: ExplicitErrorLogger,
    workspaceRoot: string
  ) {
    this.openai = new OpenAI({ apiKey });
    this.context = context;
    this.errorLogger = errorLogger;
    this.workspaceRoot = workspaceRoot;
  }
  
  /**
   * Validate all segments in a single API call
   */
  async validateAllSegments(
    segments: SegmentPrompt[],
    story: Story
  ): Promise<ValidationResult> {
    
    this.errorLogger.logInfo(story.id, `Starting bulk validation for ${segments.length} segments`);
    
    try {
      // Create validation context file
      const validationContext = await this.createValidationContext(segments, story);
      const contextFilePath = await this.writeValidationContext(validationContext);
      
      // Upload to Assistants API
      const fileId = await this.uploadValidationFile(contextFilePath);
      
      // Single validation call
      const result = await this.validateWithFileAttachment(fileId, segments.length);
      
      // Cleanup
      await this.cleanup(fileId, contextFilePath);
      
      this.errorLogger.logInfo(story.id, `Bulk validation completed: ${result.summary.overallQuality} quality, ${result.summary.totalErrors} errors`);
      
      return result;
    } catch (error) {
      this.errorLogger.logCritical(story.id, 'Bulk validation failed', {
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }
  
  /**
   * Create validation context file
   */
  private async createValidationContext(
    segments: SegmentPrompt[],
    story: Story
  ): Promise<any> {
    return {
      storyId: story.id,
      storyName: story.name,
      totalSegments: segments.length,
      segments: segments.map(seg => ({
        segmentId: seg.segmentId,
        finalPrompt: seg.finalPrompt,
        tokenCount: this.estimateTokenCount(seg.finalPrompt)
      })),
      validationCriteria: {
        characterConsistency: 'Check for eye color, appearance, clothing consistency across segments',
        assetResolution: 'Ensure all [[tags]] have corresponding usedAssets',
        temporalLogic: 'Verify time progression and scene continuity',
        narrativeFlow: 'Check story progression and emotional arc',
        visualCoherence: 'Ensure visual style and mood consistency'
      },
      qualityThresholds: {
        maxTokensPerPrompt: 400,
        minTokensPerPrompt: 50,
        maxCharacterInconsistencies: 2,
        maxAssetMissingErrors: 1
      }
    };
  }
  
  /**
   * Write validation context to temporary file
   */
  private async writeValidationContext(context: any): Promise<string> {
    const tempDir = path.join(this.workspaceRoot, 'sora-output', 'temp', 'validation');
    await fsPromises.mkdir(tempDir, { recursive: true });
    
    const filePath = path.join(tempDir, `validation_${Date.now()}.json`);
    await fsPromises.writeFile(filePath, JSON.stringify(context, null, 2), 'utf-8');
    
    return filePath;
  }
  
  /**
   * Upload validation file to OpenAI
   */
  private async uploadValidationFile(filePath: string): Promise<string> {
    const file = await this.openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: 'assistants'
    });
    
    return file.id;
  }
  
  /**
   * Validate with file attachment using Assistants API with function calling
   */
  private async validateWithFileAttachment(
    fileId: string,
    totalSegments: number
  ): Promise<ValidationResult> {
    
    const prompt = `Using the attached validation context file, analyze all ${totalSegments} segments for:

1. CHARACTER CONSISTENCY: Check for eye color, appearance, clothing consistency
2. ASSET RESOLUTION: Ensure all [[tags]] have corresponding usedAssets
3. TEMPORAL LOGIC: Verify time progression and scene continuity
4. NARRATIVE FLOW: Check story progression and emotional arc
5. VISUAL COHERENCE: Ensure visual style and mood consistency

Focus on PATTERNS across segments. If 3+ segments share the same issue, mark it as systematic.

You must return your results by calling the function validateSegments with a single, compact JSON object as the arguments.
Do not include comments, markdown, or any prose in the arguments.
Do not include fields that are not in the schema.`;

    // Create thread with validation prompt
    const thread = await this.openai.beta.threads.create({
      messages: [{
        role: 'user',
        content: prompt,
        attachments: [{ file_id: fileId, tools: [{ type: 'file_search' }] }]
      }]
    });
    
    // Run validation with function calling - FORCE the tool call
    const validationAssistant = await this.getValidationAssistant();
    const run = await this.openai.beta.threads.runs.create(thread.id, {
      assistant_id: validationAssistant,
      // Pass tools on the run to ensure they're available even if assistant is stale
      tools: [
        { type: 'file_search' },
        BulkValidationService.VALIDATE_SEGMENTS_TOOL
      ],
      // Force the model to call validateSegments instead of replying with text
      tool_choice: { type: 'function', function: { name: 'validateSegments' } },
      temperature: 0 // Deterministic output
    });
    
    // Wait for completion
    const completedRun = await this.waitForCompletion(thread.id, run.id);
    
    // Primary path: function call present
    let result: ValidationResult;
    try {
      result = this.parseFunctionCallResponse(completedRun);
    } catch (error) {
      // Fallback: parse the latest assistant message as JSON
      this.errorLogger.logWarning('system', 'Function call parsing failed, falling back to text parsing', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      const msgs = await this.openai.beta.threads.messages.list(thread.id, { order: 'desc', limit: 1 });
      const latest = msgs.data?.[0];
      const textContent = latest?.content?.find((c: any) => c.type === 'text');
      const textPart = textContent && 'text' in textContent ? textContent.text.value : '';
      
      if (!textPart) {
        throw new Error('No function call and no text content in assistant response');
      }
      
      result = this.parseValidationResponse({ text: { value: textPart } });
    }
    
    // Cleanup thread
    await this.openai.beta.threads.delete(thread.id);
    
    return result;
  }
  
  /**
   * Get or create validation assistant
   */
  private async getValidationAssistant(): Promise<string> {
    // Check VS Code global state for cached validation assistant ID
    const cachedId = this.context.globalState.get<string>('soraValidationAssistantId');
    
    if (cachedId) {
      try {
        // Verify assistant still exists in OpenAI
        const assistant = await this.openai.beta.assistants.retrieve(cachedId);
        
        // Verify the function tool exists on the assistant
        const hasValidateFn = Array.isArray(assistant.tools) &&
          assistant.tools.some((t: any) => t.type === 'function' && t.function?.name === 'validateSegments');
        
        const hasFileSearch = Array.isArray(assistant.tools) &&
          assistant.tools.some((t: any) => t.type === 'file_search');
        
        // If tools are missing or outdated, update the assistant
        if (!hasValidateFn || !hasFileSearch) {
          this.errorLogger.logInfo('system', `Updating cached assistant ${cachedId} with missing tools`);
          
          await this.openai.beta.assistants.update(cachedId, {
            tools: [
              { type: 'file_search' },
              BulkValidationService.VALIDATE_SEGMENTS_TOOL
            ]
          });
          
          this.errorLogger.logInfo('system', `Updated assistant ${cachedId} with validateSegments and file_search tools`);
        } else {
          this.errorLogger.logInfo('system', `Reusing cached validation assistant: ${cachedId}`);
        }
        
        return cachedId;
      } catch (error) {
        this.errorLogger.logInfo('system', `Cached validation assistant ${cachedId} not found, creating new one`);
      }
    }
    
    // Create new validation assistant with function calling
    const assistant = await this.openai.beta.assistants.create({
      name: 'Sora Segment Validator',
      instructions: `You are an expert validator for video production segments. Always return results by calling the validateSegments function. Do not reply with prose.

Your expertise includes:
- Detecting character appearance inconsistencies across segments
- Validating asset usage and tag resolution
- Checking temporal logic and scene continuity
- Analyzing narrative flow and emotional progression
- Identifying systematic errors affecting multiple segments`,
      model: 'gpt-4o-2024-08-06', // Use GPT-4o for reliable tool calling
      tools: [
        { type: 'file_search' },
        BulkValidationService.VALIDATE_SEGMENTS_TOOL
      ]
    });
    
    // Cache validation assistant ID for future reuse
    this.context.globalState.update('soraValidationAssistantId', assistant.id);
    this.errorLogger.logInfo('system', `Created new validation assistant: ${assistant.id}`);
    
    return assistant.id;
  }
  
  /**
   * Wait for assistant run completion
   */
  private async waitForCompletion(
    threadId: string,
    runId: string
  ): Promise<any> {
    // Get timeout from configuration (default: 300 seconds = 5 minutes)
    const config = vscode.workspace.getConfiguration('sora');
    const timeoutSeconds = config.get<number>('assistantTimeout') || 300;
    
    let attempts = 0;
    const maxAttempts = timeoutSeconds;
    
    while (attempts < maxAttempts) {
      const run = await this.openai.beta.threads.runs.retrieve(runId, { thread_id: threadId });
      
      if (run.status === 'completed') {
        return run;
      } else if (run.status === 'requires_action') {
        // Function calling is complete, return the run
        return run;
      } else if (run.status === 'failed' || run.status === 'expired' || run.status === 'cancelled') {
        const errorMessage = run.last_error?.message || 'Unknown error';
        throw new Error(`Validation run ${run.status}: ${errorMessage}`);
      }
      
      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error(`Validation run timed out after ${timeoutSeconds} seconds`);
  }
  
  /**
   * Parse function call response from run object
   */
  private parseFunctionCallResponse(run: any): ValidationResult {
    try {
      if (run.status === 'requires_action' && run.required_action?.type === 'submit_tool_outputs') {
        const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
        if (!toolCalls?.length) throw new Error('No tool calls found');

        const validateCall = toolCalls.find((c: any) => c.type === 'function' && c.function?.name === 'validateSegments');
        if (!validateCall) throw new Error('validateSegments function call not found');

        const rawArgs: string = String(validateCall.function.arguments ?? '');
        let args: any;

        try {
          args = JSON.parse(rawArgs);
        } catch {
          this.errorLogger.logWarning('system', 'Function arguments contain extra characters, attempting to clean', {
            rawArgs: rawArgs.slice(0, 200)
          });
          const cleaned = this.cleanJSON(rawArgs);
          args = JSON.parse(cleaned);
        }

        if (typeof args.isValid !== 'boolean' || typeof args.totalSegments !== 'number') {
          throw new Error('Invalid function call response format');
        }

        return args as ValidationResult;
      } else if (run.status === 'completed') {
        throw new Error('Assistant returned text instead of calling validateSegments function. Run status: completed without tool calls.');
      } else {
        throw new Error(`Unexpected run status: ${run.status}`);
      }
    } catch (error) {
      this.errorLogger.logCritical('system', 'Failed to parse function call response', {
        error: error instanceof Error ? error.message : String(error),
        runStatus: run.status,
        runId: run.id,
        hasRequiredAction: !!run.required_action,
        stackTrace: error instanceof Error ? error.stack : undefined
      });
      throw new Error(`Failed to parse function call response: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Clean and extract the first valid top-level JSON object from a string.
   * - Handles markdown fences, BOM, comments, and garbage after the JSON.
   * - Tracks quotes and escapes so braces inside strings do not break parsing.
   */
  private cleanJSON(jsonish: string): string {
    // Strip BOM
    let s = jsonish.replace(/^\uFEFF/, '');

    // Remove markdown code fences if present
    s = s.replace(/```json\b[\s\S]*?```/gi, m => m.replace(/```json|```/gi, ''));
    s = s.replace(/```[\s\S]*?```/g, m => m.replace(/```/g, ''));

    // Normalize smart quotes to regular quotes (rare but can happen)
    s = s.replace(/[""]/g, '"').replace(/['']/g, '\'');

    // Remove JS-style comments
    s = s.replace(/\/\/[^\n\r]*/g, '');
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');

    // Find the first '{'
    const start = s.indexOf('{');
    if (start === -1) throw new Error('No opening brace for JSON found');

    // Walk forward and find the matching closing '}' for the top-level object.
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;

    for (let i = start; i < s.length; i++) {
      const ch = s[i];

      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) {
      throw new Error('No matching closing brace for JSON found');
    }

    const candidate = s.slice(start, end + 1);

    // Final sanity: trim and parse once here to ensure it is valid
    const parsed = JSON.parse(candidate);
    return JSON.stringify(parsed); // return a canonical JSON string
  }

  /**
   * Parse validation response (fallback for text responses)
   */
  private parseValidationResponse(response: any): ValidationResult {
    const text = response.text.value;
    
    // Remove markdown code blocks if present
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    
    // Remove any explanatory text before JSON
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}') + 1;
    
    if (jsonStart === -1 || jsonEnd === 0) {
      throw new Error('No valid JSON object found in response');
    }
    
    const jsonOnly = cleaned.substring(jsonStart, jsonEnd);
    
    try {
      const parsed = JSON.parse(jsonOnly);
      
      if (typeof parsed.isValid !== 'boolean' || typeof parsed.totalSegments !== 'number') {
        throw new Error('Invalid validation response format');
      }
      
      return parsed as ValidationResult;
    } catch (error) {
      this.errorLogger.logCritical('system', 'Failed to parse validation response', {
        error: error instanceof Error ? error.message : String(error),
        rawResponse: text.substring(0, 500),
        stackTrace: error instanceof Error ? error.stack : undefined
      });
      throw new Error(`Failed to parse validation response: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Cleanup resources
   */
  private async cleanup(fileId: string, contextFilePath: string): Promise<void> {
    try {
      // Delete uploaded file
      await this.openai.files.delete(fileId);
      
      // Delete context file
      if (fs.existsSync(contextFilePath)) {
        fs.unlinkSync(contextFilePath);
      }
    } catch (error) {
      this.errorLogger.logWarning('system', `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Estimate token count for a prompt
   */
  private estimateTokenCount(prompt: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(prompt.length / 4);
  }
}