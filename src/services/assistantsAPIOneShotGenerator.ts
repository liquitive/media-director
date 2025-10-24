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

export class AssistantsAPIOneShotGenerator {
  private openai: OpenAI;
  private assistantId?: string;
  private context: vscode.ExtensionContext;
  private errorLogger: ExplicitErrorLogger;
  
  // Shared function tool definition to avoid duplication
  private static readonly GENERATE_SEGMENTS_TOOL = {
    type: 'function' as const,
    function: {
      name: 'generateSegments',
      description: 'Generate video segment prompts for all segments in the story',
      parameters: {
        type: 'object',
        properties: {
          segments: {
            type: 'array',
            description: 'Array of generated segment prompts',
            items: {
              type: 'object',
              properties: {
                segmentId: {
                  type: 'string',
                  description: 'Unique identifier for the segment (e.g., "segment_1", "segment_2")'
                },
                finalPrompt: {
                  type: 'string',
                  description: 'The final prompt for video generation (max 400 tokens)'
                }
              },
              required: ['segmentId', 'finalPrompt']
            }
          }
        },
        violations: {
          type: 'array',
          description: 'Names used that are not present in context.assets[].name',
          items: { type: 'string' }
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
  

  /**
   * Generate all segments using proper vector store file_search
   * Automatically batches for stories with many segments (>35)
   */
  async generateAllSegments(
    contextFilePath: string,
    storyId: string,
    progressManager?: any,
    parentTaskId?: string
  ): Promise<Map<string, SegmentPair>> {
    
    this.errorLogger.logInfo(storyId, 'Starting one-shot segment generation...');
    try {
      // Verify master_context.json exists in the expected location
      if (!fs.existsSync(contextFilePath)) {
        throw new Error(`Master context file not found at: ${contextFilePath}\n\nThis file should have been created during the story processing workflow. Please ensure the story was fully processed before attempting script generation.`);
      }

      this.errorLogger.logInfo(storyId, `Reading master context file from: ${contextFilePath}`);

      // Read context and log stats
      const fileContent = fs.readFileSync(contextFilePath, 'utf-8');
      const contextData = JSON.parse(fileContent);
      this.errorLogger.logInfo(storyId, `Context file contains ${contextData.segments?.length || 0} segments`);
      this.errorLogger.logInfo(storyId, `Context file contains ${contextData.compressedAssets?.length || 0} assets`);
      this.errorLogger.logInfo(storyId, `Context file research text length: ${contextData.research?.length || 0} chars`);
      this.errorLogger.logInfo(storyId, `Context file transcription: ${contextData.transcription?.substring(0, 200)}...`);
      if (contextData.segments && contextData.segments.length > 0) {
        this.errorLogger.logInfo(storyId, `First segment: ${JSON.stringify(contextData.segments[0], null, 2).substring(0, 300)}...`);
      }
      if (contextData.compressedAssets && contextData.compressedAssets.length > 0) {
        this.errorLogger.logInfo(storyId, `First asset: ${JSON.stringify(contextData.compressedAssets[0], null, 2).substring(0, 300)}...`);
      }
      
      progressManager?.updateTask(parentTaskId, 'running', `Read master context: ${contextData.segments?.length} segments`);

      // Check if we need to batch (16384 tokens / ~420 tokens per segment ≈ 35 segments max)
      const totalSegments = contextData.segments?.length || 0;
      const SEGMENTS_PER_BATCH = 35;
      
      if (totalSegments > SEGMENTS_PER_BATCH) {
        this.errorLogger.logInfo(storyId, `Story has ${totalSegments} segments, using batch generation...`);
        progressManager?.updateTask(parentTaskId, 'running', `Batching ${totalSegments} segments (${Math.ceil(totalSegments / SEGMENTS_PER_BATCH)} batches)...`);
        return await this.generateSegmentsBatched(contextData, storyId, progressManager, parentTaskId);
      }
      
      // Single batch generation for smaller stories
      progressManager?.updateTask(parentTaskId, 'running', `Generating ${totalSegments} segments in one batch...`);

      // Get or create assistant
      const assistantId = await this.getOrCreateAssistant();
      this.errorLogger.logInfo(storyId, `Using assistant: ${assistantId}`);
      progressManager?.updateTask(parentTaskId, 'running', `Using AI assistant: ${assistantId}`);

      // Create simple thread (no file_search)
      const thread = await this.openai.beta.threads.create({});
      this.errorLogger.logInfo(storyId, `Created thread: ${thread.id}`);

      // Build a compact inline context: exclude heavy fields (timingMap, audioAnalysis)
      const parsed: any = contextData;
      const inlineContext: any = {
        storyId: parsed.storyId,
        storyName: parsed.storyName,
        storyDescription: parsed.storyDescription,
        storyContent: parsed.storyContent,
        transcription: parsed.transcription,
        research: parsed.research,
        compressedAssets: parsed.compressedAssets,
        cinematographyGuidelines: parsed.cinematographyGuidelines,
        generationInstructions: parsed.generationInstructions,
        segments: parsed.segments
      };
      // Safety: trim excessively long research text to keep payload under limits
      if (inlineContext.research && typeof inlineContext.research === 'string' && inlineContext.research.length > 120000) {
        inlineContext.research = inlineContext.research.slice(0, 120000);
      }
      const compactJson = JSON.stringify(inlineContext);
      const prompt = this.buildInlinePrompt(compactJson);
      this.errorLogger.logInfo(storyId, `Sending inline prompt to AI (length: ${prompt.length} chars)`);
      progressManager?.updateTask(parentTaskId, 'running', 'Sending context to AI...');
      await this.openai.beta.threads.messages.create(thread.id, {
        role: 'user',
        content: prompt
      });

      // Run with only the function tool and forced tool_choice
      this.errorLogger.logInfo(storyId, `Starting run with assistant: ${assistantId}`);
      const run = await this.openai.beta.threads.runs.create(thread.id, {
        assistant_id: assistantId,
        tools: [AssistantsAPIOneShotGenerator.GENERATE_SEGMENTS_TOOL],
        tool_choice: { type: 'function', function: { name: 'generateSegments' } },
        max_completion_tokens: 32768  // Increase output limit to support stories with many segments
      });
      this.errorLogger.logInfo(storyId, `Run created: ${run.id}, status: ${run.status}`);

      // Wait for completion
      this.errorLogger.logInfo(storyId, `Waiting for run completion...`);
      progressManager?.updateTask(parentTaskId, 'running', 'Waiting for AI response...');
      const completedRun = await this.waitForCompletion(thread.id, run.id, storyId);
      this.errorLogger.logInfo(storyId, `Run completed with status: ${completedRun.status}`);

      // Parse response
      const aiSegments = await this.parseSegmentResponse(completedRun, thread.id, storyId);
      progressManager?.updateTask(parentTaskId, 'running', `Received ${aiSegments.length} AI-generated prompts`);

      // Check segment count vs expected
      const expected = Array.isArray(contextData.segments) ? contextData.segments.length : undefined;
      if (expected && aiSegments.length !== expected) {
        this.errorLogger.logCritical(storyId, `Segment count mismatch: expected ${expected}, got ${aiSegments.length}`);
      }

      // Create Map of segment pairs
      const segmentMap = new Map<string, SegmentPair>();
      const originalSegments = contextData.segments || [];

      this.errorLogger.logInfo(storyId, `Creating segment pair map...`);
      progressManager?.updateTask(parentTaskId, 'running', 'Pairing AI segments with original metadata...');

      for (let i = 0; i < aiSegments.length; i++) {
        const aiSegment = aiSegments[i];
        
        // Find matching original segment by ID
        const contextSegment = originalSegments.find((seg: any) => seg.id === aiSegment.segmentId);
        
        if (!contextSegment) {
          this.errorLogger.logWarning(storyId, `No context segment found for AI segment ${i + 1}`);
          continue;
        }
        
        const segmentId = `segment_${i + 1}`;
        segmentMap.set(segmentId, {
          aiSegment,
          contextSegment
        });
        
        this.errorLogger.logInfo(storyId, `Paired segment ${i + 1}: "${contextSegment.text}" (${contextSegment.duration}s)`);
        progressManager?.updateTask(parentTaskId, 'running', `Paired segment ${i + 1}/${aiSegments.length}...`);
      }

      this.errorLogger.logInfo(storyId, `Created ${segmentMap.size} segment pairs`);

      // Cleanup thread
      try {
        await this.openai.beta.threads.delete(thread.id);
      } catch {}

      this.errorLogger.logInfo(storyId, `Generated ${segmentMap.size} segment pairs successfully`);
      return segmentMap;

    } catch (error) {
      this.errorLogger.logApiError(storyId, `Script genration failed: ${error instanceof Error ? error.message : String(error)}`, {
        contextFilePath,
        error: error instanceof Error ? error.toString() : String(error)
      });
      throw error;
    }
  }
  
  /**
   * Generate segments in batches for long stories (>35 segments)
   */
  private async generateSegmentsBatched(
    contextData: any,
    storyId: string,
    progressManager?: any,
    parentTaskId?: string
  ): Promise<Map<string, SegmentPair>> {
    const SEGMENTS_PER_BATCH = 35;
    const allSegments = contextData.segments || [];
    const totalSegments = allSegments.length;
    const numBatches = Math.ceil(totalSegments / SEGMENTS_PER_BATCH);
    
    this.errorLogger.logInfo(storyId, `Batching ${totalSegments} segments into ${numBatches} batches of ${SEGMENTS_PER_BATCH}`);
    
    const allAiSegments: SegmentPrompt[] = [];
    const assistantId = await this.getOrCreateAssistant();
    
    // Process each batch
    for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
      const startIdx = batchIndex * SEGMENTS_PER_BATCH;
      const endIdx = Math.min(startIdx + SEGMENTS_PER_BATCH, totalSegments);
      const batchSegments = allSegments.slice(startIdx, endIdx);
      
      this.errorLogger.logInfo(storyId, `Processing batch ${batchIndex + 1}/${numBatches} (segments ${startIdx + 1}-${endIdx})`);
      progressManager?.updateTask(parentTaskId, 'running', `Batch ${batchIndex + 1}/${numBatches}: Generating segments ${startIdx + 1}-${endIdx}...`);
      
      // Create thread for this batch
      const thread = await this.openai.beta.threads.create({});
      
      try {
        // Build context with only this batch's segments
        const batchContext = {
          ...contextData,
          segments: batchSegments
        };
        
        // Safety: trim research if too long
        if (batchContext.research && typeof batchContext.research === 'string' && batchContext.research.length > 120000) {
          batchContext.research = batchContext.research.slice(0, 120000);
        }
        
        const compactJson = JSON.stringify(batchContext);
        const prompt = this.buildInlinePrompt(compactJson);
        
        await this.openai.beta.threads.messages.create(thread.id, {
          role: 'user',
          content: prompt
        });
        
        // Run assistant
        const run = await this.openai.beta.threads.runs.create(thread.id, {
          assistant_id: assistantId,
          tools: [AssistantsAPIOneShotGenerator.GENERATE_SEGMENTS_TOOL],
          tool_choice: { type: 'function', function: { name: 'generateSegments' } },
          max_completion_tokens: 32768
        });
        
        // Wait for completion
        const completedRun = await this.waitForCompletion(thread.id, run.id, storyId);
        
        // Parse batch response
        const batchAiSegments = await this.parseSegmentResponse(completedRun, thread.id, storyId);
        this.errorLogger.logInfo(storyId, `Batch ${batchIndex + 1} generated ${batchAiSegments.length} segments`);
        
        // Add to results
        allAiSegments.push(...batchAiSegments);
        
        progressManager?.updateTask(parentTaskId, 'running', `Batch ${batchIndex + 1}/${numBatches} complete (${allAiSegments.length}/${totalSegments} total)`);
        
      } finally {
        // Cleanup thread
        try {
          await this.openai.beta.threads.delete(thread.id);
        } catch {}
      }
    }
    
    // Check total count
    if (allAiSegments.length !== totalSegments) {
      this.errorLogger.logCritical(storyId, `Batch mismatch: expected ${totalSegments}, got ${allAiSegments.length}`);
    }
    
    // Create segment map
    const segmentMap = new Map<string, SegmentPair>();
    
    for (let i = 0; i < allAiSegments.length; i++) {
      const aiSegment = allAiSegments[i];
      const contextSegment = allSegments.find((seg: any) => seg.id === aiSegment.segmentId);
      
      if (!contextSegment) {
        this.errorLogger.logWarning(storyId, `No context segment found for AI segment ${i + 1}`);
        continue;
      }
      
      const segmentId = `segment_${i + 1}`;
      segmentMap.set(segmentId, {
        aiSegment,
        contextSegment
      });
    }
    
    this.errorLogger.logInfo(storyId, `Batched generation complete: ${segmentMap.size} segment pairs`);
    return segmentMap;
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
      this.errorLogger.logInfo('system', `Context file contains ${contextData.compressedAssets?.length || 0} assets`);
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
      instructions: `You are an expert video generation prompt engineer specializing in Sora-style AI video models.

When you receive a request:
1. Use file_search to read the master_context.json file thoroughly
2. Extract ALL assets (characters, locations, items) from context.assets[]
3. Use ONLY those exact asset names - never invent characters from your training data
4. Use the visual attributes from context.assets[].visual_attributes
5. Match segment text from context.segments[].text
6. Follow themes from context.research

CRITICAL: You will be penalized for using character names not in the context file (like "Jessica", "Miro", "Oliver"). Only use assets explicitly defined in context.assets[].

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
- context.assets[] - All characters, locations, and items with detailed visual attributes
- context.segments[] - All video segments with timing and transcribed text  
- context.research - Thematic analysis and narrative guidance

For EVERY segment in context.segments[], generate a finalPrompt that:

1. Uses ONLY characters/locations/items defined in context.assets[]
2. Uses the EXACT names from context.assets[].name 
3. Incorporates visual details from context.assets[].visual_attributes
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
2) For EVERY entry in context.segments[], produce exactly one segment with:
   - segmentId: the id from the context entry
   - finalPrompt: a production-ready Sora prompt (<= 400 tokens)
3) Always call the function generateSegments with a single JSON argument of shape {"segments": [...]}.
4) Output must be STRICT JSON in the function args. No prose, no markdown, no comments.

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
   * Wait for vector store file processing
   */
  private async waitForVectorStoreReady(vectorStoreId: string, storyId: string): Promise<void> {
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max
    
    while (attempts < maxAttempts) {
      const vectorStore = await this.openai.vectorStores.retrieve(vectorStoreId);
      
      if (vectorStore.status === 'completed') {
        this.errorLogger.logInfo(storyId, 'Vector store ready');
        return;
      }
      
      // Accept intermediate states and keep waiting
      if (['failed', 'expired'].includes(vectorStore.status)) {
        throw new Error(`Vector store ${vectorStore.status}`);
      }
      
      // Otherwise status is queued or in_progress - keep waiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error('Vector store processing timed out');
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
        
        // Cancel run for tidiness since we don't need to submit outputs
        try { 
          await this.openai.beta.threads.runs.cancel(threadId, run.id); 
        } catch {
          // Ignore cancel errors
        }
        
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
      this.errorLogger.logApiError(storyId, `Failed to parse segment response: ${error instanceof Error ? error.message : String(error)}`, {
        runStatus: run.status,
        runId: run.id,
        hasRequiredAction: !!run.required_action
      });
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
