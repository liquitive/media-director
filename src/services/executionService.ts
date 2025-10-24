import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StoryService } from './storyService';
import { AIService } from './aiService';
import { AssetService } from './assetService';
import { VideoService } from './videoService';
import { OpenAIService } from './openaiService';
import { ProgressManager } from './progressManager';
import { AssistantsAPIOneShotGenerator } from './assistantsAPIOneShotGenerator';
import { logger } from '../utils/logger';
import { Notifications } from '../utils/notifications';
import { Segment } from '../models/story';
import { SegmentPair } from '../types/asset.types';

export class ExecutionService {
    constructor(
        private storyService: StoryService,
        private aiService: AIService,
        private assetService: AssetService,
        private videoService: VideoService,
        private openaiService: OpenAIService,
        private progressManager: ProgressManager,
        private assistantsGenerator: AssistantsAPIOneShotGenerator
    ) {}

    /**
     * Generate videos for segments with progress tracking
     * @param storyId - The story ID
     * @param segmentIndices - Single segment index or array of segment indices
     * @param parentTaskId - Optional parent task ID for progress tracking
     */
    async generateVideosForSegments(storyId: string, segmentIndices: number | number[], parentTaskId?: string): Promise<void> {
        const story = this.storyService.getStory(storyId);
        if (!story) {
            throw new Error(`Story ${storyId} not found`);
        }

        // Normalize to array
        const indices = Array.isArray(segmentIndices) ? segmentIndices : [segmentIndices];
        
        if (indices.length === 0) {
            throw new Error('No segment indices provided');
        }

        // Validate all segments exist and have prompts
        for (const index of indices) {
            const segment = story.directorScript[index];
            if (!segment) {
                throw new Error(`Segment ${index} not found in story`);
            }
            if (!segment.prompt) {
                throw new Error(`Segment ${index} is not production-ready - missing prompt`);
            }
        }

        // Generate videos for each segment in sequence
        for (let i = 0; i < indices.length; i++) {
            const segmentIndex = indices[i];
            const segment = story.directorScript[segmentIndex];
            
            // Start progress tracking for this segment
            const segmentTaskId = `story_${storyId}_segment_${segmentIndex}`;
            const segmentName = segment.prompt.substring(0, 50) + '...';
            this.progressManager.startTask(segmentTaskId, `🎥 Generate Segment ${segmentIndex + 1}: "${segmentName}"`, parentTaskId);
            
            try {
                // Skip if segment already completed with video file
                if (segment.status === 'completed' && segment.videoPath) {
                    const videoExists = fs.existsSync(segment.videoPath);
                    if (videoExists) {
                        logger.info(`⏭️  Skipping segment ${segmentIndex + 1} - already completed with video at: ${segment.videoPath}`);
                        this.progressManager.updateTask(segmentTaskId, 'success', '✓ Already completed (skipped)', 100);
                        
                        // Update overall progress
                        if (parentTaskId) {
                            const overallProgress = Math.round(((i + 1) / indices.length) * 100);
                            this.progressManager.updateTask(parentTaskId, 'running', `Skipped segment ${i + 1} of ${indices.length} (already completed)...`, overallProgress);
                        }
                        continue; // Skip to next segment
                    } else {
                        logger.warn(`⚠️  Segment ${segmentIndex + 1} marked completed but video file missing - will regenerate`);
                    }
                }
                
                // Update segment progress: Starting
                this.progressManager.updateTask(segmentTaskId, 'running', 'Calling Sora API for video generation...', 0);
                
                // Update overall progress
                if (parentTaskId) {
                    const overallProgress = Math.round((i / indices.length) * 100);
                    this.progressManager.updateTask(parentTaskId, 'running', `Processing segment ${i + 1} of ${indices.length}...`, overallProgress);
                }
                
                // Determine continuity reference for this segment
                const continuityInfo = this.determineContinuityReference(story, segmentIndex);
                const shouldUseRemix = continuityInfo.shouldUseRemix;
                const remixVideoId = continuityInfo.remixVideoId;
                
                // Generate video for this segment using Sora API with progress tracking
                const videoResult = await this.openaiService.generateVideoSegment(
                    segment.prompt,
                    segment.duration,
                    story.settings.model,
                    story.settings.resolution,
                    story, // Pass full story config for character continuity
                    undefined, // imagePaths
                    undefined, // continuityFrame
                    story.directoryPath, // Use story's stored directory path
                    remixVideoId,
                    // Progress callback to update UI in real-time
                    (progress: number, message: string) => {
                        this.progressManager.updateTask(segmentTaskId, 'running', message, progress);
                    }
                );
                
                // Update segment progress: Processing
                this.progressManager.updateTaskProgress(segmentTaskId, 50, 'Processing video generation...');
                
                const videoPath = videoResult.url || videoResult.id;
                
                // Update segment with video path
                const updatedSegment = { ...segment, videoPath, status: 'completed' as const };
                story.directorScript[segmentIndex] = updatedSegment;
                
                // Save segment to individual file
                const storyDir = this.storyService.getStoryDirectory(story.id);
                const segmentPath = path.join(storyDir, 'segments', `segment_${segmentIndex + 1}.json`);
                await fs.promises.writeFile(segmentPath, JSON.stringify(updatedSegment, null, 2));
                
                // Complete segment task
                this.progressManager.updateTask(segmentTaskId, 'success', 'Video generated successfully!', 100);
                
                // Update overall progress
                if (parentTaskId) {
                    const overallProgress = Math.round(((i + 1) / indices.length) * 100);
                    this.progressManager.updateTask(parentTaskId, 'running', `Completed segment ${i + 1} of ${indices.length}...`, overallProgress);
                }
                
                Notifications.log(`✅ Video generated for segment ${segmentIndex + 1}`, true);
                
            } catch (error) {
                // Fail this specific segment
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.progressManager.failTask(segmentTaskId, `Video generation failed: ${errorMessage}`);
                logger.error(`Failed to generate video for segment ${segmentIndex + 1}:`, error);
                
                // Fail parent task and stop immediately
                if (parentTaskId) {
                    this.progressManager.failTask(parentTaskId, `Segment ${segmentIndex + 1} generation failed: ${errorMessage}`);
                }
                
                // Update story status to error
                this.storyService.updateStory(storyId, { status: 'error' });
                
                // Critical error - stop all generation immediately
                throw new Error(`Video generation failed for segment ${segmentIndex + 1}: ${errorMessage}`);
            }
        }
        
        // Update story with all changes
        this.storyService.updateStory(storyId, {
            directorScript: story.directorScript
        });
        
        await this.storyService.saveDirectorScript(storyId);
        
        const message = indices.length === 1 
            ? `✅ Video generated for segment ${indices[0] + 1}`
            : `✅ All ${indices.length} videos generated successfully`;
        Notifications.log(message, true);
    }

    // Placeholder methods for compatibility
    async generateScriptOneShot(
        story: any,
        timingMap: any,
        analysis: any,
        fullAssetLibrary: any,
        researchText: string,
        progressManager: any,
        scriptTaskId: string
    ): Promise<Map<string, SegmentPair>> {
        try {
            logger.info(`Generating script for story ${story.id} using Assistants API...`);
            progressManager?.updateTask(scriptTaskId, 'running', 'Initializing Assistants API...');
            
            // Build context file path
            const storyDir = this.storyService.getStoryDirectory(story.id);
            const contextFilePath = path.join(storyDir, 'source', 'master_context.json');
            
            progressManager?.updateTask(scriptTaskId, 'running', 'Generating visual prompts with AI...');
            
            // Use the AssistantsAPIOneShotGenerator to generate all segments
            const segmentMap = await this.assistantsGenerator.generateAllSegments(
                contextFilePath,
                story.id,
                progressManager,
                scriptTaskId
            );
            
            logger.info(`Generated ${segmentMap.size} segment pairs for story ${story.id}`);
            progressManager?.updateTask(scriptTaskId, 'running', `Generated ${segmentMap.size} segments`);
            
            return segmentMap;
        } catch (error) {
            logger.error('Failed to generate script:', error);
            progressManager?.failTask(scriptTaskId, `Failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    async preResolveTagsForStory(story: any, taskId: string, segmentIndex: number): Promise<void> {
        // Implementation would go here
        throw new Error('Method not implemented');
    }

    async queueAnalysis(storyId: string): Promise<void> {
        try {
            logger.info(`Queuing analysis for story ${storyId}`);
            
            // Get the story
            const story = this.storyService.getStory(storyId);
            if (!story) {
                throw new Error(`Story ${storyId} not found`);
            }
            
            // For now, just log that analysis is queued
            // In a full implementation, this would add to a task queue
            logger.info(`Analysis queued for story: ${story.name} (${storyId})`);
            
            // Update story status
            this.storyService.updateStory(storyId, {
                status: 'analyzing'
            });
            
        } catch (error) {
            logger.error('Failed to queue analysis:', error);
            throw error;
        }
    }

    /**
     * Queue video generation for a story with progress tracking
     */
    async queueGeneration(storyId: string): Promise<void> {
        try {
            logger.info(`Queuing generation for story ${storyId}`);
            
            const story = this.storyService.getStory(storyId);
            if (!story) {
                throw new Error(`Story ${storyId} not found`);
            }
            
            // Get all segments with prompts
            const segments = story.directorScript || [];
            const segmentIndices = segments
                .map((segment, index) => segment.prompt ? index : null)
                .filter(index => index !== null) as number[];

            if (segmentIndices.length === 0) {
                throw new Error('No segments with prompts found');
            }

            // Start main progress task with total segment count
            const mainTaskId = `story_${storyId}_generation`;
            this.progressManager.startTask(mainTaskId, `🎬 Generate Video: "${story.name}"`);
            
            // Set up overall progress tracking
            const task = this.progressManager['tasks'].get(mainTaskId);
            if (task) {
                task.totalSegments = segmentIndices.length;
                task.completedSegments = 0;
                task.progress = 0;
            }
            
            // Update story status
            this.storyService.updateStory(storyId, { status: 'generating' });
            
            // Update overall progress
            this.progressManager.updateTask(mainTaskId, 'running', 'Preparing video generation...', 0);

            // Generate all segments using the unified function
            await this.generateVideosForSegments(storyId, segmentIndices, mainTaskId);

            // Complete main task
            this.progressManager.updateTask(mainTaskId, 'success', 'Video generation completed successfully!', 100);
            
            // Update story status
            this.storyService.updateStory(storyId, { status: 'completed' });
            
            logger.info(`Generation completed for story: ${story.name} (${storyId})`);
            
        } catch (error) {
            logger.error('Failed to generate videos:', error);
            
            // Fail the main task
            const mainTaskId = `story_${storyId}_generation`;
            this.progressManager.failTask(mainTaskId, `Generation failed: ${error instanceof Error ? error.message : String(error)}`);
            
            // Update story status
            this.storyService.updateStory(storyId, { status: 'error' });
            
            throw error;
        }
    }

    /**
     * Queue video generation for a single segment
     */
    async queueSegmentGeneration(storyId: string, segmentIndex: number, taskId: string): Promise<void> {
        try {
            logger.info(`Queuing segment generation for story ${storyId}, segment ${segmentIndex}`);
            
            const story = this.storyService.getStory(storyId);
            if (!story) {
                throw new Error(`Story ${storyId} not found`);
            }
            
            // Generate single segment using the unified function
            await this.generateVideosForSegments(storyId, segmentIndex);
            
            logger.info(`Segment generation completed for story: ${story.name} (${storyId}), segment ${segmentIndex}`);
            
        } catch (error) {
            logger.error('Failed to generate segment:', error);
            throw error;
        }
    }

    /**
     * Determine continuity reference for intelligent cross-segment anchoring
     */
    private determineContinuityReference(story: any, segmentIndex: number): {
        shouldUseRemix: boolean;
        remixVideoId?: string;
        continuityType?: string;
    } {
        const currentSegment = story.directorScript[segmentIndex];
        
        // Check if segment has explicit continuity reference
        if (currentSegment?.continuityReference) {
            const referenceSegment = story.directorScript.find((seg: any) => seg.id === currentSegment.continuityReference);
            if (referenceSegment?.videoPath) {
                return {
                    shouldUseRemix: true,
                    remixVideoId: this.extractVideoIdFromPath(referenceSegment.videoPath),
                    continuityType: currentSegment.continuityType || 'narrative'
                };
            }
        }

        // Fallback to intelligent continuity detection
        const continuityInfo = this.findBestContinuityReference(story, segmentIndex);
        
        return {
            shouldUseRemix: continuityInfo.shouldUseRemix,
            remixVideoId: continuityInfo.remixVideoId,
            continuityType: continuityInfo.continuityType
        };
    }

    /**
     * Find the best continuity reference based on narrative context
     */
    private findBestContinuityReference(story: any, segmentIndex: number): {
        shouldUseRemix: boolean;
        remixVideoId?: string;
        continuityType?: string;
    } {
        const currentSegment = story.directorScript[segmentIndex];
        const completedSegments = story.directorScript
            .slice(0, segmentIndex)
            .filter((seg: any) => seg?.videoPath && seg.status === 'completed');

        if (completedSegments.length === 0) {
            return { shouldUseRemix: false };
        }

        // Analyze narrative context for best continuity match
        const currentContext = currentSegment?.narrativeContext;
        
        // Find segments with similar narrative context
        const similarSegments = completedSegments.filter((seg: any) => {
            const segContext = seg.narrativeContext;
            if (!currentContext || !segContext) return false;

            // Match by character focus
            if (currentContext.characterFocus && segContext.characterFocus) {
                const hasSharedCharacters = currentContext.characterFocus.some((char: string) => 
                    segContext.characterFocus?.includes(char)
                );
                if (hasSharedCharacters) return true;
            }

            // Match by location
            if (currentContext.locationContinuity && segContext.locationContinuity) {
                return currentContext.locationContinuity === segContext.locationContinuity;
            }

            // Match by emotional tone
            if (currentContext.emotionalTone && segContext.emotionalTone) {
                return currentContext.emotionalTone === segContext.emotionalTone;
            }

            return false;
        });

        // Use the most recent similar segment, or fallback to previous segment
        const referenceSegment = similarSegments.length > 0 
            ? similarSegments[similarSegments.length - 1]
            : completedSegments[completedSegments.length - 1];

        return {
            shouldUseRemix: true,
            remixVideoId: this.extractVideoIdFromPath(referenceSegment.videoPath),
            continuityType: similarSegments.length > 0 ? 'narrative' : 'sequential'
        };
    }

    /**
     * Extract video ID from video path for remix API
     * Handles paths like: /path/to/video_68fc026b0a788193bf3fd3954a118b3b0085938026f36c25_2025-10-24T22-51-16-284Z.mp4
     * Returns: video_68fc026b0a788193bf3fd3954a118b3b0085938026f36c25 (max 64 chars)
     */
    private extractVideoIdFromPath(videoPath: string): string | undefined {
        // Get filename without extension
        const filename = path.basename(videoPath, path.extname(videoPath));
        
        // If it's already a clean video ID (starts with video_ and is <=64 chars without timestamp), return it
        if (filename.startsWith('video_') && filename.length <= 64 && !filename.includes('_2025')) {
            return filename;
        }
        
        // Extract video ID from filename with pattern: video_{hex_hash}_{timestamp}
        // Sora video IDs: video_ + 50-char hex hash = ~56 chars total
        // Match: video_ followed by hex chars, stopping before underscore+timestamp
        const match = filename.match(/^(video_[a-f0-9]+?)(?:_\d{4}-|$)/);
        if (match && match[1].length <= 64) {
            return match[1];
        }
        
        // Fallback: extract any video_[hex] pattern up to 64 chars
        const idMatch = filename.match(/^(video_[a-f0-9]{40,60})/);
        if (idMatch && idMatch[1].length <= 64) {
            return idMatch[1];
        }
        
        // Last resort: if starts with video_, take first 64 chars
        if (filename.startsWith('video_')) {
            return filename.substring(0, 64);
        }
        
        return filename;
    }

}