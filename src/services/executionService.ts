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
                // Update segment progress: Starting
                this.progressManager.updateTask(segmentTaskId, 'running', 'Calling Sora API for video generation...', 0);
                
                // Update overall progress
                if (parentTaskId) {
                    const overallProgress = Math.round((i / indices.length) * 100);
                    this.progressManager.updateTask(parentTaskId, 'running', `Processing segment ${i + 1} of ${indices.length}...`, overallProgress);
                }
                
                // Generate video for this segment using Sora API
                const videoResult = await this.openaiService.generateVideoSegment(
                    segment.prompt,
                    segment.duration,
                    story.settings.model,
                    story.settings.resolution,
                    [],
                    undefined, // imagePaths
                    undefined, // continuityFrame
                    story.directoryPath // Use story's stored directory path
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
                
                // Don't throw error - continue with other segments
                logger.warn(`⚠️ Skipping segment ${segmentIndex + 1} due to generation failure, continuing with remaining segments...`);
                continue;
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

}