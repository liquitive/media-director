import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StoryService } from './storyService';
import { AudioService } from './audioService';
import { AssetService } from './assetService';
import { OpenAIService } from './openaiService';
import { ExecutionService } from './executionService';
import { AIService } from './aiService';
import { AudioAnalysisService } from './audioAnalysisService';
import { StoryResearchService } from './storyResearchService';
import { ProgressManager } from './progressManager';
import { FileManager } from '../utils/fileManager';
import { logger } from '../utils/logger';
import { Notifications } from '../utils/notifications';
import { Segment } from '../models/story';
import { SegmentPair } from '../types/asset.types';

/**
 * Script Generator Service
 * Orchestrates the complete end-to-end script generation pipeline
 */
export class DirectorScriptGeneratorService {
    private storyService: StoryService;
    private audioService: AudioService;
    private assetService: AssetService;
    private openaiService: OpenAIService;
    private executionService: ExecutionService;
    private aiService: AIService;
    private progressManager: ProgressManager;

    constructor(
        storyService: StoryService,
        audioService: AudioService,
        assetService: AssetService,
        openaiService: OpenAIService,
        executionService: ExecutionService,
        aiService: AIService
    ) {
        this.storyService = storyService;
        this.audioService = audioService;
        this.assetService = assetService;
        this.openaiService = openaiService;
        this.executionService = executionService;
        this.aiService = aiService;
        this.progressManager = ProgressManager.getInstance();
    }

    /**
     * Transcribes the audio file and saves the transcript
     */
    async generateStoryTranscription(storyId: string, audioFilePath: string, parentTaskId: string): Promise<{ text: string; result: any }> {
        const transcriptTaskId = `${storyId}_transcribe`;
        this.progressManager.startTask(transcriptTaskId, 'Transcribing Audio', parentTaskId);
        
        try {
            const story = this.storyService.getStory(storyId);
            if (!story) {
                throw new Error('Story not found');
            }

            this.progressManager.updateTask(transcriptTaskId, 'running', 'Checking audio file size...');
            const stats = await fs.promises.stat(audioFilePath);
            const fileSizeMB = stats.size / (1024 * 1024);
            
            let transcriptionResult;
            
            if (fileSizeMB > 24) {
                // Large file - chunk it
                this.progressManager.updateTask(transcriptTaskId, 'running', `Large file detected (${fileSizeMB.toFixed(1)}MB), chunking...`);
                
                const storyDir = this.storyService.getStoryDirectory(storyId);
                const chunksDir = path.join(storyDir, 'audio_chunks');
                await fs.promises.mkdir(chunksDir, { recursive: true });
                
                this.progressManager.updateTask(transcriptTaskId, 'running', 'Splitting audio into chunks...');
                const chunkFiles = await this.audioService.splitAudioIntoChunks(audioFilePath, chunksDir);
                
                this.progressManager.updateTask(transcriptTaskId, 'running', `Transcribing ${chunkFiles.length} chunks...`);
                transcriptionResult = await this.openaiService.transcribeAudioChunks(chunkFiles);
                
                // Cleanup chunks
                this.progressManager.updateTask(transcriptTaskId, 'running', 'Cleaning up temporary files...');
                for (const chunkFile of chunkFiles) {
                    await fs.promises.unlink(chunkFile).catch(() => {});
                }
                await fs.promises.rmdir(chunksDir).catch(() => {});
            } else {
                // Small file - transcribe directly
                this.progressManager.updateTask(transcriptTaskId, 'running', 'Transcribing audio...');
                transcriptionResult = await this.openaiService.transcribeAudio(audioFilePath);
            }
            
            // Save transcript
            this.progressManager.updateTask(transcriptTaskId, 'running', 'Saving transcript...');
            const storyDir = this.storyService.getStoryDirectory(storyId);
            const transcriptPath = FileManager.saveTranscription(transcriptionResult.text, storyDir);
            
            // Update story
            story.transcription = transcriptionResult.text;
            this.storyService.updateStory(storyId, story);
            
            this.progressManager.updateTask(transcriptTaskId, 'success', `Transcribed ${transcriptionResult.text.length} characters`);
            logger.info(`Transcription completed for story ${storyId}`);
            
            return { text: transcriptionResult.text, result: transcriptionResult };
        } catch (error: any) {
            logger.error('Transcription failed', error);
            this.progressManager.updateTask(transcriptTaskId, 'failed', `Transcription failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generates audio timing map and saves it
     */
    async generateTimingMap(storyId: string, audioFilePath: string, transcriptionResult: any, parentTaskId: string): Promise<any> {
        const timingTaskId = `${storyId}_timing`;
        this.progressManager.startTask(timingTaskId, 'Generating Timing Map', parentTaskId);
        
        try {
            this.progressManager.updateTask(timingTaskId, 'running', 'Analyzing audio timing...');
            
            const ffmpegPath = vscode.workspace.getConfiguration('sora').get<string>('ffmpegPath') || 'ffmpeg';
            const audioAnalysisService = new AudioAnalysisService(ffmpegPath);
            
            const timingMap = await audioAnalysisService.analyzeAudioTiming(audioFilePath, transcriptionResult);
            
            // Save timing map
            this.progressManager.updateTask(timingTaskId, 'running', 'Saving timing map...');
            const storyDir = this.storyService.getStoryDirectory(storyId);
            const sourceDir = path.join(storyDir, 'source');
            await fs.promises.mkdir(sourceDir, { recursive: true });
            
            const timingPath = path.join(sourceDir, 'timing_map.json');
            await fs.promises.writeFile(timingPath, JSON.stringify(timingMap, null, 2));
            
            this.progressManager.updateTask(timingTaskId, 'success', `Generated timing map with ${timingMap.segments?.length || 0} segments`);
            logger.info(`Timing map generated for story ${storyId}`);
            
            return timingMap;
        } catch (error: any) {
            logger.error('Timing map generation failed', error);
            this.progressManager.updateTask(timingTaskId, 'failed', `Timing map failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Performs story research and saves it
     */
    async generateStoryResearch(storyId: string, transcription: string, parentTaskId: string): Promise<string> {
        const researchTaskId = `${storyId}_research`;
        this.progressManager.startTask(researchTaskId, 'Deep Story Research', parentTaskId);
        
        try {
            this.progressManager.updateTask(researchTaskId, 'running', 'Researching historical and cultural context...');
            
            const storyResearchService = new StoryResearchService(this.aiService);
            const researchText = await storyResearchService.performDeepResearch(transcription, storyId);
            
            // Save research
            this.progressManager.updateTask(researchTaskId, 'running', 'Saving research results...');
            const storyDir = this.storyService.getStoryDirectory(storyId);
            const sourceDir = path.join(storyDir, 'source');
            await fs.promises.mkdir(sourceDir, { recursive: true});
            
            const researchPath = path.join(sourceDir, 'research.txt');
            await fs.promises.writeFile(researchPath, researchText);
            
            this.progressManager.updateTask(researchTaskId, 'success', `Research completed (${researchText.length} characters)`);
            logger.info(`Research completed for story ${storyId}`);
            
            return researchText;
        } catch (error: any) {
            logger.error('Research failed', error);
            this.progressManager.updateTask(researchTaskId, 'failed', `Research failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generates a single asset image and saves it
     */
    async generateAssetImage(storyId: string, asset: any, parentTaskId: string): Promise<void> {
        const imageTaskId = `${storyId}_image_${asset.id || asset.name}`;
        this.progressManager.startTask(imageTaskId, `Generating image for ${asset.name}`, parentTaskId);
        
        try {
            // Check if image generation is enabled in configuration
            const config = vscode.workspace.getConfiguration('sora');
            const isEnabled = config.get<boolean>('generateAssetImages', false);
            
            if (!isEnabled) {
                this.progressManager.updateTask(imageTaskId, 'success', `Image generation disabled by configuration`);
                logger.info(`Asset image generation is disabled in settings. Skipping image generation for ${asset.name}`);
                return;
            }
            
            this.progressManager.updateTask(imageTaskId, 'running', 'Generating reference image...');
            
            // Generate image using existing asset service method
            const assetId = asset.id || asset.name.toLowerCase().replace(/\s+/g, '_');
            await this.assetService.generateCharacterReferenceImage(assetId, this.openaiService);
            
            this.progressManager.updateTask(imageTaskId, 'success', `Image generated for ${asset.name}`);
            logger.info(`Asset image generated for ${asset.name} in story ${storyId}`);
        } catch (error: any) {
            logger.error(`Asset image generation failed for ${asset.name}:`, error);
            this.progressManager.updateTask(imageTaskId, 'failed', `Image generation failed: ${error.message}`);
            // Don't throw - continue with other assets
        }
    }

    /**
     * Generates all story assets
     */
    async generateStoryAssets(storyId: string, transcription: string, audioAnalysis: any, researchText: string, parentTaskId: string): Promise<any[]> {
        const assetsTaskId = `${storyId}_assets`;
        this.progressManager.startTask(assetsTaskId, 'Extracting Assets', parentTaskId);
        
        try {
            this.progressManager.updateTask(assetsTaskId, 'running', 'Extracting characters, locations, and items...');
            
            const extractedAssets = await this.openaiService.extractAssetsWithResearch(
                transcription,
                audioAnalysis,
                researchText,
                this.progressManager,
                assetsTaskId
            );

            for (const asset of extractedAssets) {
                this.progressManager.updateTask(assetsTaskId, 'success', `Extracted ${asset.name} successfully.`);
            }
            
            // Save assets
            this.progressManager.updateTask(assetsTaskId, 'running', 'Saving asset library...');
            const storyDir = this.storyService.getStoryDirectory(storyId);
            const assetsDir = path.join(storyDir, 'assets');
            await fs.promises.mkdir(assetsDir, { recursive: true });
            
            const assetsPath = path.join(assetsDir, 'extracted_assets.json');
            await fs.promises.writeFile(assetsPath, JSON.stringify({
                storyId,
                extractedAt: new Date().toISOString(),
                assets: extractedAssets
            }, null, 2));
            
            // Add to global asset library with AI-powered deduplication
            if (extractedAssets && extractedAssets.length > 0) {
                this.progressManager.updateTask(assetsTaskId, 'running', '📚 Adding to global library...');
                let reusedCount = 0;
                let createdCount = 0;
                
                for (const asset of extractedAssets) {
                    try {
                        const beforeCount = (await this.assetService.searchAssets({ type: asset.type })).length;
                        
                        await this.assetService.findOrCreateAsset(
                            asset.name,
                            asset.type,
                            asset.description,
                            {
                                visual_attributes: asset.visual_attributes,
                                references: asset.references,
                                tags: asset.tags,
                                indexed_in: asset.indexed_in,
                                stories: [storyId]
                            },
                            transcription,
                            this.aiService
                        );
                        
                        const afterCount = (await this.assetService.searchAssets({ type: asset.type })).length;
                        if (afterCount > beforeCount) {
                            createdCount++;
                        } else {
                            reusedCount++;
                        }
                    } catch (error) {
                        logger.warn(`Failed to add asset "${asset.name}":`, error);
                    }
                }
                
                logger.info(`Assets: ${createdCount} new, ${reusedCount} reused`);
            }
            
            // Generate asset images if enabled in configuration
            const config = vscode.workspace.getConfiguration('sora');
            const generateImages = config.get<boolean>('generateAssetImages', false);
            const imageCount = extractedAssets.length;
            
            if (generateImages && imageCount > 0) {
                const imagesTaskId = `${storyId}_images`;
                this.progressManager.startTask(imagesTaskId, `Generating Reference Images`, assetsTaskId);
                
                logger.info(`Generating reference images for ${imageCount} assets (enabled in settings)`);
                
                // Generate images asynchronously for all assets
                const imagePromises = extractedAssets.map(asset => 
                    this.generateAssetImage(storyId, asset, imagesTaskId)
                );
                
                await Promise.all(imagePromises);
                
                // Re-save assets with image paths
                await fs.promises.writeFile(assetsPath, JSON.stringify({
                    storyId,
                    extractedAt: new Date().toISOString(),
                    assets: extractedAssets
                }, null, 2));
                
                this.progressManager.updateTask(imagesTaskId, 'success', `Generated ${imageCount} reference images`);
            } else if (!generateImages && imageCount > 0) {
                logger.info(`Skipping image generation for ${imageCount} assets (disabled in settings)`);
            }
            
            this.progressManager.updateTask(assetsTaskId, 'success', `Extracted ${extractedAssets.length} assets`);
            logger.info(`Assets extracted for story ${storyId}`);
            
            return extractedAssets;
        } catch (error: any) {
            logger.error('Asset extraction failed', error);
            this.progressManager.updateTask(assetsTaskId, 'failed', `Asset extraction failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generates the master context file
     */
    async generateMasterContext(storyId: string, transcription: string, timingMap: any, audioAnalysis: any, extractedAssets: any[], researchText: string, parentTaskId: string): Promise<string> {
        const contextTaskId = `${storyId}_context`;
        this.progressManager.startTask(contextTaskId, 'Building Master Context', parentTaskId);
        
        try {
            this.progressManager.updateTask(contextTaskId, 'running', 'Assembling master context...');
            
            // Use segments from timing map, adding segment IDs and used assets
            const segments = (timingMap.segments || []).map((seg: any, index: number) => ({
                id: `segment_${index + 1}`,
                index: index,
                text: seg.text || '',
                duration: seg.duration,
                startTime: seg.startTime,
                endTime: seg.endTime,
                hasVocals: seg.hasVocals || false,
                energy: seg.energy || 0.5,
                beats: seg.beats || 0,
                usedAssets: []  // Will be populated by AI during script generation
            }));
            
            // Group extracted assets by type (these are story-specific assets)
            const storyAssets = {
                characters: extractedAssets.filter((a: any) => a.type === 'character'),
                locations: extractedAssets.filter((a: any) => a.type === 'location'),
                items: extractedAssets.filter((a: any) => a.type === 'item'),
                vehicles: extractedAssets.filter((a: any) => a.type === 'vehicle'),
                animals: extractedAssets.filter((a: any) => a.type === 'animal'),
                other: extractedAssets.filter((a: any) => a.type === 'other')
            };
            
            const masterContext = {
                version: '1.0',
                storyId: storyId,
                createdAt: new Date().toISOString(),
                transcription: transcription,
                research: researchText,
                audioAnalysis: audioAnalysis,
                timingMap: timingMap,
                assets: storyAssets,  // Only assets extracted from this story's transcript
                segments: segments
            };
            
            // Save master context
            this.progressManager.updateTask(contextTaskId, 'running', 'Saving master context...');
            const storyDir = this.storyService.getStoryDirectory(storyId);
            const contextPath = path.join(storyDir, 'source', 'master_context.json');
            await fs.promises.writeFile(contextPath, JSON.stringify(masterContext, null, 2));
            
            this.progressManager.updateTask(contextTaskId, 'success', `Master context created with ${segments.length} segments`);
            logger.info(`Master context created for story ${storyId} with ${segments.length} segments`);
            
            return contextPath;
        } catch (error: any) {
            logger.error('Master context creation failed', error);
            this.progressManager.updateTask(contextTaskId, 'failed', `Master context failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generates the script using AI (inner function)
     */
    async generateScriptInner(storyId: string, contextFilePath: string, parentTaskId: string): Promise<Map<string, SegmentPair>> {
        const scriptTaskId = `${storyId}_script`;
        this.progressManager.startTask(scriptTaskId, 'Generating Script', parentTaskId);
        
        try {
            const story = this.storyService.getStory(storyId);
            if (!story) {
                throw new Error('Story not found');
            }

            // Read master context
            this.progressManager.updateTask(scriptTaskId, 'running', 'Loading master context...');
            const contextData = JSON.parse(await fs.promises.readFile(contextFilePath, 'utf-8'));
            
            // Load all required data
            const timingMap = contextData.timingMap;
            const audioAnalysis = contextData.audioAnalysis;
            const fullAssetLibrary = await this.assetService.getAllAssets();
            const researchText = contextData.research;
            
            // Create minimal analysis object
            const analysis = {
                title: story.name,
                context: story.description,
                transcription: contextData.transcription,
                visualStyle: 'naturalistic',
                colorPalette: 'earth tones',
                mainCharacter: 'protagonist',
                setting: 'various locations',
                theme: 'narrative',
                mood: 'contemplative'
            };
            
            // Generate script using AI
            this.progressManager.updateTask(scriptTaskId, 'running', 'Sending to AI for script generation...');
            const segmentMap = await this.executionService.generateScriptOneShot(
                story,
                timingMap,
                analysis,
                fullAssetLibrary,
                researchText,
                this.progressManager,
                scriptTaskId
            );
            
            // Write segment files
            this.progressManager.updateTask(scriptTaskId, 'running', 'Writing segment files...');
            const storyDir = this.storyService.getStoryDirectory(storyId);
            const segmentsDir = path.join(storyDir, 'segments');
            await fs.promises.mkdir(segmentsDir, { recursive: true });
            
            const segments: Segment[] = [];
            let fileSegmentIndex = 0;
            
            for (const [segmentId, pair] of segmentMap) {
                this.progressManager.updateTask(scriptTaskId, 'running', `Writing ${segmentId}...`);
                
                const mergedSegment: Segment = {
                    id: pair.contextSegment.id,
                    text: pair.contextSegment.text,
                    prompt: pair.aiSegment.finalPrompt,
                    duration: pair.contextSegment.duration,
                    startTime: pair.contextSegment.startTime,
                    status: 'pending',
                    usedAssets: pair.contextSegment.usedAssets || []
                };
                
                segments.push(mergedSegment);
                
                const segmentFilePath = path.join(segmentsDir, `${segmentId}.json`);
                const segmentFileData = {
                    version: '1.0',
                    storyId: storyId,
                    segmentIndex: fileSegmentIndex,
                    createdAt: new Date().toISOString(),
                    ...mergedSegment
                };
                await fs.promises.writeFile(segmentFilePath, JSON.stringify(segmentFileData, null, 2));
                
                logger.info(`Written ${segmentId}: "${mergedSegment.text}" (${mergedSegment.duration}s)`);
                fileSegmentIndex++;
            }
            
            // Update story with Script
            story.directorScript = segments;
            this.storyService.updateStory(storyId, story);
            
            this.progressManager.updateTask(scriptTaskId, 'success', `Generated ${segments.length} segment prompts`);
            logger.info(`Script generated for story ${storyId}`);
            
            return segmentMap;
        } catch (error: any) {
            logger.error('Script generation failed', error);
            this.progressManager.updateTask(scriptTaskId, 'failed', `Script generation failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Full pipeline: Generates complete script from scratch
     * (generateStoryTranscription → generateTimingMap → generateStoryResearch → generateStoryAssets → generateMasterContext → generateScriptInner)
     */
    async generateScript(storyId: string): Promise<void> {
        const mainTaskId = `${storyId}_generate_full`;
        this.progressManager.startTask(mainTaskId, 'Generate Script (Full Pipeline)');
        
        try {
            const story = this.storyService.getStory(storyId);
            if (!story) {
                throw new Error('Story not found');
            }

            const audioFilePath = story.sourceFiles?.original;
            if (!audioFilePath) {
                throw new Error('No audio file found for this story');
            }

            // Step 1: Transcription
            const { text: transcription, result: transcriptionResult } = await this.generateStoryTranscription(storyId, audioFilePath, mainTaskId);
            
            // Step 2: Timing Map
            const timingMap = await this.generateTimingMap(storyId, audioFilePath, transcriptionResult, mainTaskId);
            
            // Step 3: Research
            const researchText = await this.generateStoryResearch(storyId, transcription, mainTaskId);
            
            // Step 4: Audio Analysis (needed for master context)
            const audioAnalysisTaskId = `${storyId}_audio_analysis`;
            this.progressManager.startTask(audioAnalysisTaskId, 'Analyzing Audio', mainTaskId);
            const audioAnalysis = await this.audioService.analyzeAudio(audioFilePath);
            
            // Integrate research into audio analysis
            const enhancedAnalysis = {
                ...audioAnalysis,
                researchText: researchText
            };
            
            // Save audio analysis
            const storyDir = this.storyService.getStoryDirectory(storyId);
            const sourceDir = path.join(storyDir, 'source');
            await fs.promises.mkdir(sourceDir, { recursive: true });
            const analysisPath = path.join(sourceDir, 'analysis.json');
            await fs.promises.writeFile(analysisPath, JSON.stringify(enhancedAnalysis, null, 2));
            
            this.progressManager.updateTask(audioAnalysisTaskId, 'success', 'Audio analysis complete');
            
            // Step 5: Assets
            const extractedAssets = await this.generateStoryAssets(storyId, transcription, enhancedAnalysis, researchText, mainTaskId);
            
            // Step 6: Master Context
            const contextFilePath = await this.generateMasterContext(
                storyId,
                transcription,
                timingMap,
                enhancedAnalysis,
                extractedAssets,
                researchText,
                mainTaskId
            );
            
            // Step 7: Generate Script
            await this.generateScriptInner(storyId, contextFilePath, mainTaskId);
            
            this.progressManager.updateTask(mainTaskId, 'success', 'Script generation complete!');
            Notifications.info('Script generated successfully!');
            
        } catch (error: any) {
            logger.error('Full script generation failed', error);
            this.progressManager.updateTask(mainTaskId, 'failed', `Generation failed: ${error.message}`);
            Notifications.error(`Script generation failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Regenerate pipeline: Regenerates script from existing master context
     * Can regenerate all segments or just a specific segment
     */
    async reGenerateScript(storyId: string, segmentInstance?: Segment): Promise<void> {
        const mainTaskId = `${storyId}_regenerate${segmentInstance ? '_' + segmentInstance.id : ''}`;
        this.progressManager.startTask(
            mainTaskId,
            segmentInstance ? `Regenerate Segment ${segmentInstance.id}` : 'ReGenerate Script'
        );
        
        try {
            const story = this.storyService.getStory(storyId);
            if (!story) {
                throw new Error('Story not found');
            }

            const storyDir = this.storyService.getStoryDirectory(storyId);
            const contextFilePath = path.join(storyDir, 'master_context.json');
            
            // Verify master context exists
            if (!fs.existsSync(contextFilePath)) {
                throw new Error('Master context not found. Please run full generation first.');
            }

            // Generate script from existing context
            const segmentMap = await this.generateScriptInner(storyId, contextFilePath, mainTaskId);
            
            // If regenerating a specific segment, only update that segment
            if (segmentInstance) {
                const updateTaskId = `${storyId}_update_${segmentInstance.id}`;
                this.progressManager.startTask(updateTaskId, `Updating ${segmentInstance.id}`, mainTaskId);
                
                const segmentKey = segmentInstance.id;
                const pair = segmentMap.get(segmentKey);
                
                if (!pair) {
                    throw new Error(`Segment ${segmentInstance.id} not found in generated results`);
                }
                
                // Update only this segment file
                const segmentsDir = path.join(storyDir, 'segments');
                const segmentFilePath = path.join(segmentsDir, `${segmentKey}.json`);
                
                const mergedSegment: Segment = {
                    id: pair.contextSegment.id,
                    text: pair.contextSegment.text,
                    prompt: pair.aiSegment.finalPrompt,
                    duration: pair.contextSegment.duration,
                    startTime: pair.contextSegment.startTime,
                    status: 'pending',
                    usedAssets: pair.contextSegment.usedAssets || []
                };
                
                const segmentFileData = {
                    version: '1.0',
                    storyId: storyId,
                    segmentIndex: parseInt(segmentInstance.id.split('_')[1]) - 1,
                    createdAt: new Date().toISOString(),
                    ...mergedSegment
                };
                
                await fs.promises.writeFile(segmentFilePath, JSON.stringify(segmentFileData, null, 2));
                
                // Update in story
                if (story.directorScript && Array.isArray(story.directorScript)) {
                    const index = story.directorScript.findIndex(s => s.id === segmentInstance.id);
                    if (index !== -1) {
                        story.directorScript[index] = mergedSegment;
                        this.storyService.updateStory(storyId, story);
                    }
                }
                
                this.progressManager.updateTask(updateTaskId, 'success', `${segmentInstance.id} updated`);
                logger.info(`Regenerated segment ${segmentInstance.id} for story ${storyId}`);
            }
            
            this.progressManager.updateTask(mainTaskId, 'success', 
                segmentInstance ? 'Segment regenerated!' : 'Script regenerated!');
            Notifications.info(segmentInstance ? 'Segment regenerated successfully!' : 'Script regenerated successfully!');
            
        } catch (error: any) {
            logger.error('Script regeneration failed', error);
            this.progressManager.updateTask(mainTaskId, 'failed', `Regeneration failed: ${error.message}`);
            Notifications.error(`Script regeneration failed: ${error.message}`);
            throw error;
        }
    }
}
