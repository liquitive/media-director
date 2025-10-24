/**
 * Command Registration
 * Registers all VS Code commands for the extension
 */

import * as vscode from 'vscode';
import { StoryService } from '../services/storyService';
import { OpenAIService } from '../services/openaiService';
import { AIService } from '../services/aiService';
import { VideoService } from '../services/videoService';
import { AudioService } from '../services/audioService';
import { ExecutionService } from '../services/executionService';
import { DirectorScriptGeneratorService } from '../services/directorScriptGeneratorService';
import { StoryTreeProvider } from '../providers/storyTreeProvider';
import { StorylineEditorProvider } from '../providers/storylineEditorProvider';
import { AssetService } from '../services/assetService';
import { Notifications } from '../utils/notifications';
import { logger } from '../utils/logger';
import { Segment } from '../models/story';
import * as path from 'path';
import * as fs from 'fs';
import { createStoryWizard } from './createStoryWizard';
import { WebResourceService } from '../services/webResourceService';
import { ProgressManager } from '../services/progressManager';
import { PythonDependencyService } from '../services/pythonDependencyService';

interface Services {
    storyService: StoryService;
    openaiService: OpenAIService;
    aiService: AIService;
    videoService: VideoService;
    audioService: AudioService;
    executionService: ExecutionService;
    storyTreeProvider: StoryTreeProvider;
    webResourceService: WebResourceService;
    assetService: AssetService;
    progressManager: ProgressManager;
    storylineEditorProvider: StorylineEditorProvider;
}

export function registerCommands(context: vscode.ExtensionContext, services: Services): void {
    const { storyService, openaiService, aiService, videoService, audioService, executionService, storyTreeProvider, webResourceService, assetService, progressManager, storylineEditorProvider } = services;
    
    // Initialize Script Generator Service
    const directorScriptGenerator = new DirectorScriptGeneratorService(
        storyService,
        audioService,
        assetService,
        openaiService,
        executionService,
        aiService
    );

    // Initialize Sora project
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.initializeProject', async () => {
            await initializeProject(storyService);
        }),

        // Create new story (unified wizard)
        vscode.commands.registerCommand('sora.createStory', async () => {
            await createStoryWizard({
                storyService,
                openaiService,
                aiService,
                audioService,
                webResourceService,
                storyTreeProvider,
                assetService,
                executionService
            });
        })
    );

    // Open story
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.openStory', async (storyIdOrItem: any) => {
            // Handle both string IDs and tree items
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (!storyId) {
                Notifications.error('No story ID provided to openStory command');
                logger.error('openStory called without storyId', storyIdOrItem);
                return;
            }
            await openStory(storyId, storyService);
        })
    );

    // Delete story
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.deleteStory', async (item: any) => {
            const storyId = item?.story?.id;
            if (storyId) {
                await deleteStory(storyId, storyService, storyTreeProvider);
            }
        })
    );

    // Clear all stories (wipe workspace state)
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.clearAllStories', async () => {
            await clearAllStories(context, storyService, storyTreeProvider);
        })
    );

    // Refresh stories
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.refreshStories', () => {
            storyTreeProvider.refresh();
            Notifications.log('🔄 Stories refreshed');
        })
    );

    // Analyze content (DEPRECATED - redirects to Generate Full Script)
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.analyzeContent', async (storyIdOrItem: any) => {
            // Handle both string IDs and tree items
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await directorScriptGenerator.generateScript(storyId);
                storyTreeProvider.refresh();
            }
        })
    );

    // Generate script - Full Pipeline
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.generateScript', async (storyIdOrItem: any) => {
            // Handle both string IDs and tree items
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await directorScriptGenerator.generateScript(storyId);
                storyTreeProvider.refresh();
            }
        })
    );

    // Execute production
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.executeProduction', async (storyIdOrItem: any) => {
            // Handle both string IDs and tree items
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await executeProduction(storyId, executionService);
            }
        })
    );

    // View media
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.viewMedia', async (storyId: string) => {
            await viewMedia(storyId, storyService);
        })
    );

    // Show progress
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.showProgress', () => {
            // Open progress webview in editor area
            progressManager.showProgressPanel();
        })
    );

    // Manual story editing commands
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.editStoryDetails', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await editStoryDetails(storyId, storyService, storyTreeProvider);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.addTextContent', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await addTextContent(storyId, storyService, storyTreeProvider);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.addSegmentManually', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await addSegmentManually(storyId, storyService, storyTreeProvider);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.importContentToStory', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await importContentToStory(storyId, storyService, audioService, openaiService, storyTreeProvider);
            }
        })
    );

    // New tree view commands
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.openScript', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await openScript(storyId, storyService);
            }
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.openStorylineEditor', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await openStorylineEditor(storyId, storyService, storylineEditorProvider);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.regenerateScript', async (storyIdOrItem: any, segmentIndex?: number) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                // If segment index provided, get that segment
                let segmentInstance: Segment | undefined;
                if (segmentIndex !== undefined) {
                    const story = storyService.getStory(storyId);
                    if (story?.directorScript && Array.isArray(story.directorScript)) {
                        segmentInstance = story.directorScript[segmentIndex];
                    }
                }
                await directorScriptGenerator.reGenerateScript(storyId, segmentInstance);
                storyTreeProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.openSegmentsFolder', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await openFolder(storyId, 'segments', storyService);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.generateAllSegments', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await executeProduction(storyId, executionService);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.generateSegment', async (treeItem: any) => {
            console.log('🎬 sora.generateSegment called with treeItem:', treeItem);
            
            if (!treeItem || !treeItem.story || !treeItem.segment || treeItem.segmentIndex === undefined) {
                console.error('🎬 Invalid treeItem:', treeItem);
                vscode.window.showErrorMessage(`Invalid treeItem: ${JSON.stringify(treeItem)}`);
                return;
            }
            
            const storyId = treeItem.story.id;
            const segmentInstance = treeItem.segment;
            console.log('🎬 Regenerating segment:', { storyId, segmentId: segmentInstance.id });
            
            await directorScriptGenerator.reGenerateScript(storyId, segmentInstance);
            storyTreeProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.editSegment', async (storyId: string, segmentIndex: number) => {
            await editSegment(storyId, segmentIndex, storyService, storyTreeProvider);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.previewSegment', async (storyId: string, segmentIndex: number) => {
            await previewSegment(storyId, segmentIndex, storyService);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.openCompletedFolder', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await openFolder(storyId, 'completed', storyService);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.playVideo', async (filePath: string) => {
            await playVideo(filePath);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.openSourceFolder', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await openFolder(storyId, 'source', storyService);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.viewTimingMap', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await viewTimingMap(storyId, storyService);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.regenerateResearch', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await regenerateResearch(storyId, storyService, aiService);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.cleanupAssets', async () => {
            if (assetService) {
                await cleanupAssets(assetService);
            } else {
                Notifications.error('Asset service not available');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.openFile', async (filePath: string) => {
            await openFile(filePath);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.showAIProviders', async () => {
            await showAIProviders();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.installPythonDependencies', async () => {
            await installPythonDependencies(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.compileVideo', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await compileVideo(storyId, storyService, videoService);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.generateCharacterImages', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            if (storyId) {
                await generateCharacterImages(storyId, storyService, assetService, openaiService, storyTreeProvider);
            }
        })
    );

    // Generate reference image for a single asset
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.generateAssetImage', async (item: any) => {
            const assetId = item?.asset?.id;
            if (assetId) {
                await generateAssetImage(assetId, assetService, openaiService);
            }
        })
    );

    // Delete reference image for a single asset
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.deleteAssetImage', async (item: any) => {
            const assetId = item?.asset?.id;
            if (assetId) {
                await deleteAssetImage(assetId, assetService);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.showProgressPanel', async () => {
            // Open progress webview in editor area
            progressManager.showProgressPanel();
            Notifications.info('Progress panel opened in editor');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sora.testProgressPanel', async () => {
            await progressManager.testProgressPanel();
            // Progress is now handled in the dev panel
            Notifications.info('Test task started - check progress panel');
        })
    );

    logger.info('Commands registered successfully');
}

// Manual story editing functions
async function editStoryDetails(storyId: string, storyService: StoryService, storyTreeProvider: StoryTreeProvider): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    const newName = await Notifications.input(
        'Edit Story Name',
        'Enter new name',
        story.name,
        (value) => {
            if (!value || value.trim().length === 0) {
                return 'Story name is required';
            }
            return undefined;
        }
    );

    if (!newName) return;

    const newDescription = await Notifications.input(
        'Edit Description',
        'Enter description',
        story.description
    );

    story.name = newName;
    story.description = newDescription || '';
    story.modifiedAt = new Date().toISOString();
    storyService.updateStory(storyId, story);
    storyTreeProvider.refresh();

    Notifications.log(`✅ Story details updated`);
}

async function addTextContent(storyId: string, storyService: StoryService, storyTreeProvider: StoryTreeProvider): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    const content = await Notifications.input(
        'Add Text Content',
        'Enter or paste your content',
        story.content,
        (value) => {
            if (!value || value.trim().length === 0) {
                return 'Content is required';
            }
            return undefined;
        }
    );

    if (!content) return;

    story.content = content;
    story.modifiedAt = new Date().toISOString();
    storyService.updateStory(storyId, story);
    storyTreeProvider.refresh();

    Notifications.log(`✅ Text content added to story`);
}

async function addSegmentManually(storyId: string, storyService: StoryService, storyTreeProvider: StoryTreeProvider): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    const text = await Notifications.input(
        'Segment Text',
        'Enter the text/lyrics for this segment',
        '',
        (value) => {
            if (!value || value.trim().length === 0) {
                return 'Text is required';
            }
            return undefined;
        }
    );

    if (!text) return;

    const visualPrompt = await Notifications.input(
        'Visual Prompt',
        'Describe the visual scene for this segment',
        '',
        (value) => {
            if (!value || value.trim().length === 0) {
                return 'Visual prompt is required';
            }
            return undefined;
        }
    );

    if (!visualPrompt) return;

    const duration = await Notifications.quickPick(
        [
            { label: '4 seconds', description: 'Short segment', value: 4 },
            { label: '8 seconds', description: 'Medium segment', value: 8 },
            { label: '12 seconds', description: 'Long segment', value: 12 }
        ],
        'Select segment duration'
    );

    if (!duration) return;

    const segment = {
        id: `segment_${Date.now()}`,
        text: text,
        prompt: `SCENE:\n${visualPrompt}`,
        duration: duration.value as 4 | 8 | 12,
        startTime: story.directorScript.length * 8, // Rough estimate
        status: 'pending' as const
    };

    story.directorScript.push(segment);
    story.progress.totalSegments = story.directorScript.length;
    story.modifiedAt = new Date().toISOString();
    storyService.updateStory(storyId, story);
    storyTreeProvider.refresh();

    Notifications.log(`✅ Segment added to story`);
}

async function importContentToStory(storyId: string, storyService: StoryService, audioService: AudioService, openaiService: OpenAIService, storyTreeProvider: StoryTreeProvider): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    const fileUri = await Notifications.openFile('Select file to import', {
        'All Supported': ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'mov', 'avi', 'mkv', 'txt', 'md'],
        'Audio Files': ['mp3', 'wav', 'm4a', 'flac', 'ogg'],
        'Video Files': ['mp4', 'mov', 'avi', 'mkv'],
        'Text Files': ['txt', 'md']
    });

    if (!fileUri) {
        return;
    }

    const filePath = fileUri.fsPath;
    const ext = path.extname(filePath).toLowerCase();

    try {
        let content = '';

        if (['.mp3', '.wav', '.m4a', '.flac', '.ogg'].includes(ext)) {
            await Notifications.withProgress('Transcribing audio...', async (progress) => {
                const transcription = await openaiService.transcribeAudio(filePath);
                content = transcription.text;
            });
        } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
            await Notifications.withProgress('Extracting and transcribing audio...', async (progress) => {
                const transcription = await openaiService.transcribeAudio(filePath);
                content = transcription.text;
            });
        } else if (['.txt', '.md'].includes(ext)) {
            const fs = require('fs');
            content = fs.readFileSync(filePath, 'utf8');
        } else {
            Notifications.error(`Unsupported file type: ${ext}`);
            return;
        }

        // Append to existing content
        story.content = story.content ? `${story.content}\n\n${content}` : content;
        story.modifiedAt = new Date().toISOString();
        storyService.updateStory(storyId, story);
        storyTreeProvider.refresh();

        Notifications.log(`✅ Content imported to story`);
    } catch (error) {
        logger.error('Content import failed:', error);
        Notifications.error('Failed to import content', error);
    }
}

async function openStory(storyId: string, storyService: StoryService): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    // Ensure all directories exist
    storyService.createStoryDirectories(storyId);
    
    // Save current Script to JSON
    storyService.saveDirectorScript(storyId);
    
    // Open script JSON with custom editor
    const storyDir = storyService.getStoryDirectory(storyId);
    const scriptPath = path.join(storyDir, 'scripts', 'script.json');
    
    // Open with custom editor
    const document = await vscode.workspace.openTextDocument(scriptPath);
    await vscode.window.showTextDocument(document, { 
        preview: false,
        viewColumn: vscode.ViewColumn.One
    });

    // Show file explorer focused on story directory
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(storyDir));

    logger.info(`Opened story: ${storyId}`);
}

function generateScriptMarkdown(story: any): string {
    let markdown = `# ${story.name}\n\n`;
    markdown += `**Status:** ${story.status}\n`;
    markdown += `**Created:** ${new Date(story.createdAt).toLocaleDateString()}\n`;
    markdown += `**Modified:** ${new Date(story.modifiedAt).toLocaleDateString()}\n\n`;

    if (story.content) {
        markdown += `## Original Content\n\n${story.content}\n\n`;
    }

    if (story.directorScript && story.directorScript.length > 0) {
        markdown += `## Script\n\n`;
        
        story.directorScript.forEach((segment: any, index: number) => {
            markdown += `### Segment ${index + 1}\n\n`;
            markdown += `**Duration:** ${segment.duration}s | **Start Time:** ${segment.startTime}s\n\n`;
            
            if (segment.text) {
                markdown += `**Text:** ${segment.text}\n\n`;
            }
            
            markdown += `**Visual Prompt:**\n${segment.visualPrompt}\n\n`;
            
            if (segment.cameraWork) {
                markdown += `**Camera Work:** ${segment.cameraWork}\n\n`;
            }
            
            if (segment.lighting) {
                markdown += `**Lighting:** ${segment.lighting}\n\n`;
            }
            
            markdown += `---\n\n`;
        });
    }

    return markdown;
}

async function deleteStory(storyId: string, storyService: StoryService, storyTreeProvider: StoryTreeProvider): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        return;
    }

    const confirmed = await Notifications.confirm(
        `Are you sure you want to delete "${story.name}"? This will also delete all generated videos and cannot be undone.`,
        'Delete',
        'Cancel'
    );

    if (confirmed) {
        storyService.deleteStory(storyId);
        storyTreeProvider.refresh();
        Notifications.log(`🗑️ Story "${story.name}" deleted`);
        logger.info(`Deleted story: ${storyId}`);
    }
}

async function clearAllStories(context: vscode.ExtensionContext, storyService: StoryService, storyTreeProvider: StoryTreeProvider): Promise<void> {
    const allStories = storyService.getAllStories();
    
    if (allStories.length === 0) {
        Notifications.info('No stories to clear');
        return;
    }

    const confirmed = await Notifications.confirm(
        `⚠️ This will DELETE ALL ${allStories.length} stories and clear workspace state. This cannot be undone. Continue?`,
        'Clear All',
        'Cancel'
    );

    if (!confirmed) {
        return;
    }

    try {
        // Delete all stories
        for (const story of allStories) {
            storyService.deleteStory(story.id);
        }

        // Clear workspace state
        await context.workspaceState.update('sora.stories', undefined);
        
        // Refresh UI
        storyTreeProvider.refresh();
        
        Notifications.log(`🧹 Cleared all ${allStories.length} stories and workspace state`);
        logger.info(`Cleared all stories from workspace state`);
    } catch (error) {
        logger.error('Failed to clear stories:', error);
        Notifications.error(`Failed to clear stories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// LEGACY analyzeContent function DELETED - replaced by DirectorScriptGeneratorService.generateScript()

async function executeProduction(storyId: string, executionService: ExecutionService): Promise<void> {
    await executionService.queueGeneration(storyId);
    Notifications.log('🎬 Video production queued', true);
    logger.info(`Queued generation for story: ${storyId}`);
}

async function viewMedia(storyId: string, storyService: StoryService): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    const storyDir = storyService.getStoryDirectory(storyId);
    
    if (story.outputFiles.finalVideo) {
        const uri = vscode.Uri.file(story.outputFiles.finalVideo);
        await vscode.env.openExternal(uri);
    } else {
        Notifications.warn('No final video available yet');
    }
}

// New tree view command implementations

async function openScript(storyId: string, storyService: StoryService): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    // Ensure directories exist
    storyService.createStoryDirectories(storyId);
    
    // Save any unsaved segments (uses real-time persistence)
    storyService.saveDirectorScript(storyId);
    
    // Open segments folder instead of monolithic script.json
    const storyDir = storyService.getStoryDirectory(storyId);
    const segmentsFolder = path.join(storyDir, 'segments');
    
    // Open segments folder in explorer
    const folderUri = vscode.Uri.file(segmentsFolder);
    await vscode.commands.executeCommand('revealFileInOS', folderUri);
    
    // Also show info message with guidance
    Notifications.info('Each segment is stored as an individual JSON file for real-time persistence');

    logger.info(`Opened segments folder for story: ${storyId}`);
}

async function openStorylineEditor(
    storyId: string,
    storyService: StoryService,
    storylineEditorProvider: StorylineEditorProvider
): Promise<void> {
    try {
        const story = storyService.getStory(storyId);
        if (!story) {
            Notifications.error('Story not found');
            return;
        }
        
        // Use the provider to create the panel
        await storylineEditorProvider.openStorylineEditor(storyId);
        
        Notifications.info(`Opening storyline editor for: ${story.name}`);
        logger.info(`Storyline editor panel opened for story: ${storyId}`);
    } catch (error) {
        logger.error('Failed to open storyline editor:', error);
        Notifications.error(`Failed to open storyline editor: ${error}`);
    }
}

// LEGACY regenerateScript function DELETED - replaced by DirectorScriptGeneratorService.reGenerateScript()

async function openFolder(storyId: string, folderName: string, storyService: StoryService): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    const storyDir = storyService.getStoryDirectory(storyId);
    const folderPath = path.join(storyDir, folderName);
    
    // Ensure folder exists
    if (!require('fs').existsSync(folderPath)) {
        require('fs').mkdirSync(folderPath, { recursive: true });
    }
    
    // Reveal in file explorer
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folderPath));
    
    logger.info(`Opened ${folderName} folder for story: ${storyId}`);
}

async function viewTimingMap(storyId: string, storyService: StoryService): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    const storyDir = storyService.getStoryDirectory(storyId);
    const timingMapPath = path.join(storyDir, 'source', 'timing_map.json');
    
    if (!require('fs').existsSync(timingMapPath)) {
        Notifications.error('No timing map found. This story may not have audio timing analysis.');
        return;
    }

    // Open the timing map file
    const timingMapUri = vscode.Uri.file(timingMapPath);
    await vscode.commands.executeCommand('vscode.open', timingMapUri);
    
    logger.info(`Opened timing map: ${timingMapPath}`);
}

async function regenerateResearch(storyId: string, storyService: StoryService, aiService: AIService): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    if (!story.transcription) {
        Notifications.error('No transcription available. Import audio first.');
        return;
    }

    const progressManager = ProgressManager.getInstance();
    const researchTaskId = `story_${storyId}_research`;
    progressManager.startTask(researchTaskId, `$(search) Regenerate Research for "${story.name}"`);
    progressManager.updateTask(researchTaskId, 'running', 'Researching historical and cultural context...');
    
    try {
        const { StoryResearchService } = await import('../services/storyResearchService');
        const storyResearchService = new StoryResearchService(aiService);
        const research = await storyResearchService.performDeepResearch(
            story.transcription,
            storyId
        );
        
        // Update analysis.json with research data
        const storyDir = storyService.getStoryDirectory(storyId);
        const analysisPath = path.join(storyDir, 'source', 'analysis.json');
        if (require('fs').existsSync(analysisPath)) {
            const analysisData = JSON.parse(require('fs').readFileSync(analysisPath, 'utf-8'));
            const enhancedAnalysis = {
                ...analysisData,
                researchText: research
            };
            require('fs').writeFileSync(analysisPath, JSON.stringify(enhancedAnalysis, null, 2));
        }
        
        progressManager.completeTask(researchTaskId, 
            `Research complete: ${research.length} characters of contextual analysis`);
        
        Notifications.log(`✅ Research regenerated for "${story.name}"`);
        logger.info(`Research regenerated for story ${storyId}: ${research.length} characters of research text`);
        
    } catch (error) {
        logger.error('Failed to regenerate research:', error);
        progressManager.failTask(researchTaskId, 'Research regeneration failed');
        Notifications.error('Failed to regenerate research', error);
    }
}

async function cleanupAssets(assetService: AssetService): Promise<void> {
    const progressManager = ProgressManager.getInstance();
    const cleanupTaskId = 'asset_cleanup';
    progressManager.startTask(cleanupTaskId, '$(trash) Cleanup Orphaned Assets');
    progressManager.updateTask(cleanupTaskId, 'running', 'Checking for orphaned assets...');
    
    try {
        const result = await assetService.cleanupOrphanedAssets();
        
        if (result.removed.length > 0) {
            progressManager.completeTask(cleanupTaskId, `Removed ${result.removed.length} orphaned assets`);
            Notifications.log(`✅ Asset cleanup complete: removed ${result.removed.length} orphaned assets`);
            logger.info(`Asset cleanup complete: removed ${result.removed.length} orphaned assets`);
        } else {
            progressManager.completeTask(cleanupTaskId, 'No orphaned assets found');
            Notifications.log('✅ No orphaned assets found');
            logger.info('No orphaned assets found');
        }
        
        if (result.errors.length > 0) {
            logger.warn(`Asset cleanup errors: ${result.errors.join(', ')}`);
        }
        
    } catch (error) {
        logger.error('Asset cleanup failed:', error);
        progressManager.failTask(cleanupTaskId, `Failed: ${error}`);
        Notifications.error('Asset cleanup failed', error);
    }
}

// Removed old generateSegment function - now using regenerateScript for segment regeneration

async function editSegment(storyId: string, segmentIndex: number, storyService: StoryService, storyTreeProvider: StoryTreeProvider): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story || !story.directorScript || !story.directorScript[segmentIndex]) {
        Notifications.error('Segment not found');
        return;
    }

    const segment = story.directorScript[segmentIndex];

    const newText = await Notifications.input(
        'Edit Segment Text',
        'Enter text/lyrics',
        segment.text
    );

    if (newText === undefined) return;

    const newVisualPrompt = await Notifications.input(
        'Edit Visual Prompt',
        'Describe the visual scene',
        segment.prompt
    );

    if (newVisualPrompt === undefined) return;

    // Update segment
    segment.text = newText || segment.text;
    segment.prompt = newVisualPrompt || segment.prompt;

    storyService.updateStory(storyId, {
        directorScript: story.directorScript
    });

    await storyService.saveDirectorScript(storyId);
    storyTreeProvider.refresh();

    Notifications.log('✅ Segment updated');
    logger.info(`Updated segment ${segmentIndex} for story: ${storyId}`);
}

async function previewSegment(storyId: string, segmentIndex: number, storyService: StoryService): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    // Check if segment video exists
    const storyDir = storyService.getStoryDirectory(storyId);
    const segmentPath = path.join(storyDir, 'segments', `segment_${segmentIndex}.mp4`);
    
    if (require('fs').existsSync(segmentPath)) {
        await vscode.env.openExternal(vscode.Uri.file(segmentPath));
        logger.info(`Previewing segment ${segmentIndex} for story: ${storyId}`);
    } else {
        Notifications.log(`⚠️ Segment ${segmentIndex + 1} video not yet generated`, true);
    }
}

async function playVideo(filePath: string): Promise<void> {
    if (require('fs').existsSync(filePath)) {
        await vscode.env.openExternal(vscode.Uri.file(filePath));
        logger.info(`Playing video: ${filePath}`);
    } else {
        Notifications.error('Video file not found');
    }
}

async function openFile(filePath: string): Promise<void> {
    if (!require('fs').existsSync(filePath)) {
        Notifications.error('File not found');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    
    // Open media files externally
    if (['.mp4', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.m4a', '.flac'].includes(ext)) {
        await vscode.env.openExternal(vscode.Uri.file(filePath));
    } else {
        // Open text files in editor
        const document = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(document);
    }
    
    logger.info(`Opened file: ${filePath}`);
}

async function showAIProviders(): Promise<void> {
    // Get AI service from extension exports
    const services = require('../extension').getServices();
    if (!services || !services.aiService) {
        Notifications.error('AI service not initialized');
        return;
    }
    
    const aiService = services.aiService;
    const providerInfo = aiService.getProviderInfo();
    
    const message = `**Text AI Provider:** ${providerInfo.textProvider}
    
**Media AI Provider:** ${providerInfo.mediaProvider}
  • Whisper (audio transcription)
  • Sora (video generation)
  • DALL-E (image generation)
  
**Cost Savings:** Text generation tasks use ${providerInfo.textProvider === 'IDE AI (Cursor/Copilot)' ? 'your IDE AI subscription (free)' : 'OpenAI GPT-4 API'} instead of consuming API tokens.`;

    vscode.window.showInformationMessage(
        message,
        'Configure Settings'
    ).then(selection => {
        if (selection === 'Configure Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'sora');
        }
    });
    
    logger.info(`AI Providers: ${JSON.stringify(providerInfo)}`);
}

/**
 * Install Python dependencies for audio analysis
 */
async function installPythonDependencies(context: vscode.ExtensionContext): Promise<void> {
    try {
        const pythonService = PythonDependencyService.getInstance(context.extensionPath);
        
        // Check if already installed
        const isInstalled = await pythonService.checkDependencies();
        
        if (isInstalled) {
            vscode.window.showInformationMessage(
                '✅ Python audio analysis dependencies are already installed!',
                'View Logs'
            ).then(action => {
                if (action === 'View Logs') {
                    logger.show();
                }
            });
            return;
        }
        
        // Install dependencies
        const success = await pythonService.installDependencies(true);
        
        if (success) {
            logger.info('✅ Python dependencies installed successfully');
        } else {
            logger.error('❌ Failed to install Python dependencies');
        }
        
    } catch (error) {
        logger.error('Failed to install Python dependencies:', error);
        Notifications.error('Failed to install Python dependencies', error);
    }
}

/**
 * Compile video segments into final video with audio
 */
async function compileVideo(storyId: string, storyService: StoryService, videoService: VideoService): Promise<void> {
    const story = storyService.getStory(storyId);
    if (!story) {
        Notifications.error('Story not found');
        return;
    }

    if (!story.outputFiles?.segments || story.outputFiles.segments.length === 0) {
        Notifications.error('No video segments found to compile. Generate videos first.');
        return;
    }

    try {
        Notifications.log(`🎬 Compiling ${story.outputFiles.segments.length} video segments for "${story.name}"...`, true);
        
        const storyDir = storyService.getStoryDirectory(storyId);
        const completedDir = path.join(storyDir, 'completed');
        const finalVideoPath = path.join(completedDir, `${story.name}.mp4`);
        
        // Ensure completed directory exists
        if (!fs.existsSync(completedDir)) {
            fs.mkdirSync(completedDir, { recursive: true });
        }
        
        // Compile segments with audio if available
        await videoService.compileSegments(
            story.outputFiles.segments,
            finalVideoPath,
            story.inputSource && story.inputType !== 'text' ? story.inputSource : undefined
        );
        
        // Update story with final video path
        storyService.updateStory(storyId, {
            outputFiles: {
                ...story.outputFiles,
                finalVideo: finalVideoPath
            }
        });
        
        Notifications.log(`✅ Video compiled successfully: ${finalVideoPath}`, true);
        logger.info(`Video compiled for story ${storyId}: ${finalVideoPath}`);
        
        // Ask if user wants to open the video
        const action = await vscode.window.showInformationMessage(
            `Video compiled! (${story.outputFiles.segments.length} segments)`,
            'Play Video',
            'Show in Folder'
        );
        
        if (action === 'Play Video') {
            await vscode.env.openExternal(vscode.Uri.file(finalVideoPath));
        } else if (action === 'Show in Folder') {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(finalVideoPath));
        }
    } catch (error) {
        logger.error('Failed to compile video:', error);
        Notifications.error(`Failed to compile video: ${error}`);
    }
}

/**
 * Initialize a new Sora project
 */
async function initializeProject(storyService: StoryService): Promise<void> {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            Notifications.error('No workspace folder open. Please open a folder first.');
            return;
        }

        // Check if already a Sora project
        const soraConfigPath = path.join(workspaceRoot, '.sora', 'config.json');
        if (require('fs').existsSync(soraConfigPath)) {
            Notifications.log('ℹ️ This is already a Sora project!', true);
            return;
        }

        // Create .sora directory and config
        const soraDir = path.join(workspaceRoot, '.sora');
        const soraOutputDir = path.join(workspaceRoot, 'sora-output');
        
        if (!require('fs').existsSync(soraDir)) {
            require('fs').mkdirSync(soraDir, { recursive: true });
        }
        
        if (!require('fs').existsSync(soraOutputDir)) {
            require('fs').mkdirSync(soraOutputDir, { recursive: true });
        }

        // Create project config
        const config = {
            version: '1.0',
            name: path.basename(workspaceRoot),
            created: new Date().toISOString(),
            settings: {
                model: 'sora-2',
                resolution: '1280x720'
            }
        };

        require('fs').writeFileSync(soraConfigPath, JSON.stringify(config, null, 2));

        // Create stories directory
        const storiesDir = path.join(soraOutputDir, 'stories');
        if (!require('fs').existsSync(storiesDir)) {
            require('fs').mkdirSync(storiesDir, { recursive: true });
        }

        Notifications.log('✅ Sora project initialized successfully!', true);
        logger.info('Sora project initialized in:', workspaceRoot);

    } catch (error) {
        logger.error('Failed to initialize Sora project:', error);
        Notifications.error('Failed to initialize Sora project', error);
    }
}

/**
 * Generate character reference images for a story
 */
async function generateCharacterImages(
    storyId: string,
    storyService: StoryService,
    assetService: AssetService,
    openaiService: OpenAIService,
    storyTreeProvider: StoryTreeProvider
): Promise<void> {
    try {
        const story = storyService.getStory(storyId);
        if (!story) {
            Notifications.error('Story not found');
            return;
        }

        Notifications.info(`Generating character reference images for: ${story.name}`);
        logger.info(`Generating character images for story: ${storyId}`);

        // Use asset service to generate images for all story characters
        const generatedImages = await assetService.generateStoryAssetImages(
            storyId,
            openaiService,
            (current: number, total: number, assetName: string) => {
                Notifications.log(`Generating image ${current}/${total}: ${assetName}`);
                logger.info(`Generating asset image ${current}/${total}: ${assetName}`);
            }
        );

        if (generatedImages.length === 0) {
            Notifications.warn('No character images were generated. Check that characters exist in the asset library for this story.');
            return;
        }

        Notifications.info(`✅ Generated ${generatedImages.length} character reference images!`);
        logger.info(`Successfully generated ${generatedImages.length} character images for story ${storyId}`);
        
        // Refresh the tree view
        storyTreeProvider.refresh();

    } catch (error) {
        logger.error('Failed to generate character images:', error);
        Notifications.error(`Failed to generate character images: ${error}`);
    }
}

/**
 * Generate reference image for a single asset
 */
async function generateAssetImage(
    assetId: string,
    assetService: AssetService,
    openaiService: OpenAIService
): Promise<void> {
    try {
        const asset = await assetService.getAsset(assetId);
        if (!asset) {
            Notifications.error('Asset not found');
            return;
        }

        // Check if image already exists
        if (asset.reference_image && fs.existsSync(asset.reference_image)) {
            const overwrite = await vscode.window.showWarningMessage(
                `Reference image already exists for "${asset.name}". Regenerate?`,
                'Yes', 'No'
            );
            if (overwrite !== 'Yes') {
                return;
            }
        }

        Notifications.info(`🎨 Generating reference image for: ${asset.name}`);
        logger.info(`Generating reference image for asset: ${assetId}`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Generating image for ${asset.name}`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });
            
            const imagePath = await assetService.generateCharacterReferenceImage(assetId, openaiService);
            
            if (imagePath) {
                progress.report({ increment: 100 });
                Notifications.info(`✅ Reference image generated for ${asset.name}`);
                logger.info(`Reference image generated: ${imagePath}`);
                
                // Open the generated image
                const imageUri = vscode.Uri.file(imagePath);
                await vscode.commands.executeCommand('vscode.open', imageUri);
            } else {
                Notifications.error('Failed to generate reference image');
            }
        });

    } catch (error) {
        logger.error('Failed to generate asset image:', error);
        Notifications.error(`Failed to generate image: ${error}`);
    }
}

/**
 * Delete reference image for a single asset
 */
async function deleteAssetImage(
    assetId: string,
    assetService: AssetService
): Promise<void> {
    try {
        const asset = await assetService.getAsset(assetId);
        if (!asset) {
            Notifications.error('Asset not found');
            return;
        }

        // Check if image exists
        if (!asset.reference_image || !fs.existsSync(asset.reference_image)) {
            Notifications.warn(`No reference image exists for "${asset.name}"`);
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete reference image for "${asset.name}"?`,
            'Yes', 'No'
        );
        
        if (confirm !== 'Yes') {
            return;
        }

        // Delete the image file
        fs.unlinkSync(asset.reference_image);
        logger.info(`Deleted reference image: ${asset.reference_image}`);

        // Update asset metadata
        asset.reference_image = undefined;
        asset.reference_image_generated = undefined;
        await assetService.updateAsset(assetId, asset);

        Notifications.info(`✅ Reference image deleted for ${asset.name}`);
        logger.info(`Asset metadata updated for: ${assetId}`);

    } catch (error) {
        logger.error('Failed to delete asset image:', error);
        Notifications.error(`Failed to delete image: ${error}`);
    }
}

