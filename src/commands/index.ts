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


    // Open editor's notes in a panel
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.openEditorsNotesPanel', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            await openEditorsNotesPanel(storyService, storyId, context);
        })
    );

    // Open edit research results panel
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.openEditResearchPanel', async (storyIdOrItem: any) => {
            const storyId = typeof storyIdOrItem === 'string' ? storyIdOrItem : storyIdOrItem?.story?.id;
            await openEditResearchPanel(storyService, storyId, context, aiService);
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
    const masterContextPath = path.join(storyDir, 'source', 'master_context.json');
    
    if (!require('fs').existsSync(masterContextPath)) {
        Notifications.error('master_context.json not found. This story may be incomplete.');
        return;
    }
    
    const masterContext = JSON.parse(require('fs').readFileSync(masterContextPath, 'utf-8'));
    if (!masterContext.timingMap) {
        Notifications.error('No timing map found in master_context.json. This story may not have audio timing analysis.');
        return;
    }
    
    // Create a temporary file to display the timing map
    const tempTimingMapPath = path.join(storyDir, 'source', '.timing_map_view.json');
    require('fs').writeFileSync(tempTimingMapPath, JSON.stringify(masterContext.timingMap, null, 2));
    
    const timingMapUri = vscode.Uri.file(tempTimingMapPath);
    await vscode.commands.executeCommand('vscode.open', timingMapUri);
    
    logger.info(`Opened timing map from master_context.json: ${tempTimingMapPath}`);
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
        
        // Update master_context.json with research data
        const storyDir = storyService.getStoryDirectory(storyId);
        const masterContextPath = path.join(storyDir, 'source', 'master_context.json');
        if (require('fs').existsSync(masterContextPath)) {
            const masterContext = JSON.parse(require('fs').readFileSync(masterContextPath, 'utf-8'));
            masterContext.research = research;
            masterContext.modifiedAt = new Date().toISOString();
            require('fs').writeFileSync(masterContextPath, JSON.stringify(masterContext, null, 2));
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

/**
 * Open Editor's Notes in a webview panel
 */
async function openEditorsNotesPanel(storyService: StoryService, storyId?: string, context?: vscode.ExtensionContext) {
    try {
        // Create and show a new webview panel
        const panel = vscode.window.createWebviewPanel(
            'soraEditorsNotes',
            'Editor\'s Notes',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        // Get the HTML content - try multiple paths
        let htmlContent: string;
        try {
            // First try the extension context path
            const htmlPath = vscode.Uri.joinPath(context!.extensionUri, 'src', 'webviews', 'editorsNotes.html');
            htmlContent = require('fs').readFileSync(htmlPath.fsPath, 'utf8');
        } catch (error) {
            try {
                // Fallback to relative path from compiled location
                const htmlPath = require('path').join(__dirname, '../../src/webviews/editorsNotes.html');
                htmlContent = require('fs').readFileSync(htmlPath, 'utf8');
            } catch (error2) {
                // Final fallback - use embedded HTML
                htmlContent = getEmbeddedEditorsNotesHTML();
            }
        }
        panel.webview.html = htmlContent;

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'loadNotes':
                        await handleLoadNotes(panel.webview, storyService, storyId);
                        break;
                    case 'saveNotes':
                        await handleSaveNotes(message.notes, panel.webview, storyService, storyId, message.showStatus);
                        break;
                    case 'summarizeField':
                        await handleSummarizeField(message.fieldId, message.content, panel.webview, storyService);
                        break;
                }
            },
            undefined,
            []
        );

        // Load notes when panel becomes visible
        panel.onDidChangeViewState(e => {
            if (e.webviewPanel.visible) {
                handleLoadNotes(panel.webview, storyService, storyId);
            }
        });

        logger.info('Editor\'s notes panel opened');
    } catch (error) {
        logger.error('Failed to open editor\'s notes panel:', error);
        Notifications.error(`Failed to open editor's notes: ${error}`);
    }
}

/**
 * Handle loading notes in the webview
 */
async function handleLoadNotes(webview: vscode.Webview, storyService: StoryService, storyId?: string) {
    try {
        let currentStory;
        
        if (storyId) {
            // Use the specific story ID provided
            currentStory = storyService.getStory(storyId);
        } else {
            // Fallback to first story if no specific ID
            const stories = storyService.getAllStories();
            if (stories.length === 0) {
                webview.postMessage({
                    command: 'loadNotes',
                    notes: null
                });
                return;
            }
            currentStory = stories[0];
        }
        
        if (currentStory) {
            webview.postMessage({
                command: 'loadNotes',
                notes: currentStory.editorsNotes || null
            });
        } else {
            webview.postMessage({
                command: 'loadNotes',
                notes: null
            });
        }
    } catch (error) {
        logger.error('Error loading editor\'s notes:', error);
        webview.postMessage({
            command: 'loadNotes',
            notes: null
        });
    }
}

/**
 * Handle saving notes in the webview
 */
async function handleSaveNotes(notes: any, webview: vscode.Webview, storyService: StoryService, storyId?: string, showStatus?: boolean) {
    try {
        let currentStory;
        
        if (storyId) {
            // Use the specific story ID provided
            currentStory = storyService.getStory(storyId);
        } else {
            // Fallback to first story if no specific ID
            const stories = storyService.getAllStories();
            if (stories.length === 0) {
                webview.postMessage({
                    command: 'saveResult',
                    success: false,
                    error: 'No stories available'
                });
                return;
            }
            currentStory = stories[0];
        }

        if (!currentStory) {
            webview.postMessage({
                command: 'saveResult',
                success: false,
                error: 'No story found'
            });
            return;
        }

        // Update story with editor's notes
        const updatedStory = {
            ...currentStory,
            editorsNotes: {
                ...notes,
                createdAt: currentStory.editorsNotes?.createdAt || new Date().toISOString(),
                modifiedAt: new Date().toISOString()
            }
        };

        storyService.updateStory(currentStory.id, updatedStory);

        webview.postMessage({
            command: 'saveResult',
            success: true,
            showStatus: showStatus || false
        });

        logger.info(`Editor's notes saved for story ${currentStory.id}`);
    } catch (error) {
        logger.error('Error saving editor\'s notes:', error);
        webview.postMessage({
            command: 'saveResult',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            showStatus: showStatus || false
        });
    }
}

/**
 * Handle summarizing a field using AI
 */
async function handleSummarizeField(fieldId: string, content: string, webview: vscode.Webview, storyService: StoryService) {
    try {
        logger.info(`Handling summarize request for field: ${fieldId}, content length: ${content.length}`);
        
        // Get the AI service from the extension
        const services = require('../extension').getServices();
        if (!services || !services.aiService) {
            throw new Error('AI service not initialized');
        }
        const aiService = services.aiService;
        
        // Create a prompt based on the field type
        const fieldPrompts: { [key: string]: string } = {
            'researchGuidance': 'Summarize and refine this research guidance for AI story analysis. Make it concise but comprehensive:',
            'scriptGuidance': 'Summarize and refine this script guidance for video generation. Make it clear and actionable:',
            'visualStyle': 'Summarize and refine this visual style description. Make it specific and cinematic:',
            'characterNotes': 'Summarize and refine this character description. Make it vivid and detailed:',
            'narrativeFocus': 'Summarize and refine this narrative focus. Make it thematic and clear:',
            'technicalNotes': 'Summarize and refine these technical requirements. Make them specific and actionable:'
        };
        
        const prompt = fieldPrompts[fieldId] || 'Summarize and refine this content:';
        const fullPrompt = `${prompt}\n\n${content}`;
        
        // Call the AI service to summarize
        const summarizedContent = await aiService.getRawText(fullPrompt);
        
        // Send the result back to the webview
        webview.postMessage({
            command: 'summarizeResult',
            fieldId: fieldId,
            success: true,
            summarizedContent: summarizedContent.trim()
        });
        
    } catch (error) {
        logger.error('Error summarizing field:', error);
        webview.postMessage({
            command: 'summarizeResult',
            fieldId: fieldId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

/**
 * Get embedded HTML content for Editor's Notes
 */
function getEmbeddedEditorsNotesHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Editor's Notes</title>
    <style>
        :root {
            --vscode-font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            --vscode-font-size: var(--vscode-font-size, 13px);
            --vscode-font-weight: var(--vscode-font-weight, 400);
            --vscode-editor-background: var(--vscode-editor-background, #ffffff);
            --vscode-editor-foreground: var(--vscode-editor-foreground, #000000);
            --vscode-panel-background: var(--vscode-panel-background, #f3f3f3);
            --vscode-panel-border: var(--vscode-panel-border, #e1e1e1);
            --vscode-input-background: var(--vscode-input-background, #ffffff);
            --vscode-input-foreground: var(--vscode-input-foreground, #000000);
            --vscode-input-border: var(--vscode-input-border, #cccccc);
            --vscode-button-background: var(--vscode-button-background, #0e639c);
            --vscode-button-foreground: var(--vscode-button-foreground, #ffffff);
            --vscode-button-hoverBackground: var(--vscode-button-hoverBackground, #1177bb);
            --vscode-button-secondaryBackground: var(--vscode-button-secondaryBackground, #5a5a5a);
            --vscode-button-secondaryForeground: var(--vscode-button-secondaryForeground, #ffffff);
            --vscode-button-secondaryHoverBackground: var(--vscode-button-secondaryHoverBackground, #6a6a6a);
            --vscode-focusBorder: var(--vscode-focusBorder, #007acc);
            --vscode-textLink-foreground: var(--vscode-textLink-foreground, #0066cc);
            --vscode-textPreformat-foreground: var(--vscode-textPreformat-foreground, #a31515);
            --vscode-textBlockQuote-background: var(--vscode-textBlockQuote-background, #f0f0f0);
            --vscode-textBlockQuote-border: var(--vscode-textBlockQuote-border, #cccccc);
            --vscode-textCodeBlock-background: var(--vscode-textCodeBlock-background, #f5f5f5);
            --vscode-widget-shadow: var(--vscode-widget-shadow, 0 2px 8px rgba(0, 0, 0, 0.1));
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            font-weight: var(--vscode-font-weight);
            margin: 0;
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            line-height: 1.6;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        h1 {
            color: var(--vscode-editor-foreground);
            margin-bottom: 30px;
            border-bottom: 2px solid var(--vscode-focusBorder);
            padding-bottom: 10px;
        }
        
        .section {
            margin-bottom: 30px;
            background: var(--vscode-panel-background);
            border-radius: 8px;
            padding: 20px;
            border: 1px solid var(--vscode-panel-border);
            box-shadow: var(--vscode-widget-shadow);
        }
        
        .section h3 {
            color: var(--vscode-editor-foreground);
            margin-top: 0;
            margin-bottom: 15px;
            font-size: 16px;
            font-weight: 600;
        }
        
        .section p {
            color: var(--vscode-editor-foreground);
            margin-bottom: 15px;
            font-size: 14px;
            opacity: 0.8;
        }
        
        textarea {
            width: 100%;
            min-height: 100px;
            padding: 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: 14px;
            resize: vertical;
            box-sizing: border-box;
        }
        
        textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
        }
        
        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
        
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .btn-summarize {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            font-size: 12px;
            padding: 6px 12px;
            margin-top: 8px;
        }
        
        .btn-summarize:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .btn-summarize:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .status {
            margin-top: 15px;
            padding: 10px;
            border-radius: 6px;
            font-size: 14px;
        }
        
        .status.success {
            background-color: var(--vscode-textBlockQuote-background);
            color: var(--vscode-textPreformat-foreground);
            border: 1px solid var(--vscode-textBlockQuote-border);
        }
        
        .status.error {
            background-color: var(--vscode-textBlockQuote-background);
            color: var(--vscode-textPreformat-foreground);
            border: 1px solid var(--vscode-textBlockQuote-border);
        }
        
        .help-text {
            font-size: 12px;
            color: var(--vscode-editor-foreground);
            margin-top: 5px;
            opacity: 0.6;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📝 Editor's Notes</h1>
        <p style="color: var(--vscode-editor-foreground); margin-bottom: 30px; opacity: 0.8;">
            Add your guidance and preferences to influence research and script generation. 
            These notes will be incorporated into the AI analysis and prompt generation.
        </p>
        
        <div class="section">
            <h3>🔍 Research Guidance</h3>
            <p>Direct the research focus and areas of interest for the story analysis.</p>
            <textarea id="researchGuidance" placeholder="e.g., Focus on 1st century Mediterranean culture, early Christian symbolism, and historical context of Patmos Island..."></textarea>
            <div class="help-text">This will guide the AI research to focus on specific areas of interest.</div>
            <button class="btn-summarize" data-field="researchGuidance" onclick="summarizeField('researchGuidance')">📝 Summarize</button>
        </div>
        
        <div class="section">
            <h3>🎬 Script Guidance</h3>
            <p>Provide direction for script generation and narrative flow.</p>
            <textarea id="scriptGuidance" placeholder="e.g., Emphasize the spiritual transformation journey, focus on the protagonist's emotional arc, maintain biblical epic tone..."></textarea>
            <div class="help-text">This influences how the AI generates video prompts and narrative structure.</div>
            <button class="btn-summarize" data-field="scriptGuidance" onclick="summarizeField('scriptGuidance')">📝 Summarize</button>
        </div>
        
        <div class="section">
            <h3>🎨 Visual Style</h3>
            <p>Specify your preferred visual style and cinematographic approach.</p>
            <textarea id="visualStyle" placeholder="e.g., Cinematic, golden hour lighting, biblical epic style, high contrast, warm color palette..."></textarea>
            <div class="help-text">This will be applied consistently across all video segments.</div>
            <button class="btn-summarize" data-field="visualStyle" onclick="summarizeField('visualStyle')">📝 Summarize</button>
        </div>
        
        <div class="section">
            <h3>👤 Character Notes</h3>
            <p>Provide specific guidance about character appearance and behavior.</p>
            <textarea id="characterNotes" placeholder="e.g., Protagonist should appear weathered but dignified, with piercing eyes that convey spiritual depth..."></textarea>
            <div class="help-text">This influences character descriptions and visual consistency.</div>
            <button class="btn-summarize" data-field="characterNotes" onclick="summarizeField('characterNotes')">📝 Summarize</button>
        </div>
        
        <div class="section">
            <h3>📖 Narrative Focus</h3>
            <p>Define the themes and narrative direction for the story.</p>
            <textarea id="narrativeFocus" placeholder="e.g., Redemption and divine revelation themes, spiritual awakening, transformation from exile to enlightenment..."></textarea>
            <div class="help-text">This guides the overall narrative and thematic approach.</div>
            <button class="btn-summarize" data-field="narrativeFocus" onclick="summarizeField('narrativeFocus')">📝 Summarize</button>
        </div>
        
        <div class="section">
            <h3>⚙️ Technical Notes</h3>
            <p>Specify technical requirements and constraints.</p>
            <textarea id="technicalNotes" placeholder="e.g., Maintain 16:9 aspect ratio, high contrast lighting, avoid fast cuts, prefer steady camera work..."></textarea>
            <div class="help-text">Technical requirements that will be incorporated into video generation.</div>
            <button class="btn-summarize" data-field="technicalNotes" onclick="summarizeField('technicalNotes')">📝 Summarize</button>
        </div>
        
        <div class="button-group">
            <button class="btn-secondary" onclick="clearNotes()">🗑️ Clear All</button>
        </div>
        
        <div id="status"></div>
        <div id="autoSaveStatus" style="position: fixed; bottom: 10px; right: 10px; font-size: 12px; opacity: 0.6; color: var(--vscode-editor-foreground);">Auto-save enabled</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Load existing notes when page loads
        window.addEventListener('load', () => {
            loadNotes();
            setupAutoSave();
        });
        
        function setupAutoSave() {
            const textareas = [
                'researchGuidance',
                'scriptGuidance', 
                'visualStyle',
                'characterNotes',
                'narrativeFocus',
                'technicalNotes'
            ];
            
            textareas.forEach(fieldId => {
                const textarea = document.getElementById(fieldId);
                if (textarea) {
                    // Auto-save on input with debouncing
                    let saveTimeout;
                    textarea.addEventListener('input', () => {
                        clearTimeout(saveTimeout);
                        updateAutoSaveStatus('Saving...');
                        saveTimeout = setTimeout(() => {
                            saveNotes();
                            updateAutoSaveStatus('Saved');
                            setTimeout(() => {
                                updateAutoSaveStatus('Auto-save enabled');
                            }, 2000);
                        }, 1000); // Save 1 second after user stops typing
                    });
                }
            });
        }
        
        function loadNotes() {
            vscode.postMessage({
                command: 'loadNotes'
            });
        }
        
        function saveNotes(showStatus = false) {
            const notes = {
                researchGuidance: document.getElementById('researchGuidance').value.trim(),
                scriptGuidance: document.getElementById('scriptGuidance').value.trim(),
                visualStyle: document.getElementById('visualStyle').value.trim(),
                characterNotes: document.getElementById('characterNotes').value.trim(),
                narrativeFocus: document.getElementById('narrativeFocus').value.trim(),
                technicalNotes: document.getElementById('technicalNotes').value.trim(),
                modifiedAt: new Date().toISOString()
            };
            
            vscode.postMessage({
                command: 'saveNotes',
                notes: notes,
                showStatus: showStatus
            });
        }
        
        function clearNotes() {
            if (confirm('Are you sure you want to clear all editor\\'s notes?')) {
                document.getElementById('researchGuidance').value = '';
                document.getElementById('scriptGuidance').value = '';
                document.getElementById('visualStyle').value = '';
                document.getElementById('characterNotes').value = '';
                document.getElementById('narrativeFocus').value = '';
                document.getElementById('technicalNotes').value = '';
                
                showStatus('All notes cleared', 'success');
            }
        }
        
        function summarizeField(fieldId) {
            alert('Summarize called for: ' + fieldId);
            console.log('Summarize field called for:', fieldId);
            const textarea = document.getElementById(fieldId);
            const content = textarea.value.trim();
            
            if (!content) {
                showStatus('Please enter some content to summarize', 'error');
                return;
            }
            
            // Find the button for this field using data attribute
            const button = document.querySelector('button[data-field="' + fieldId + '"]');
            if (button) {
                button.disabled = true;
                button.textContent = '⏳ Summarizing...';
            }
            
            console.log('Sending summarize request for field:', fieldId, 'content length:', content.length);
            
            // Send to extension for AI processing
            vscode.postMessage({
                command: 'summarizeField',
                fieldId: fieldId,
                content: content
            });
        }
        
        function showStatus(message, type) {
            const statusDiv = document.getElementById('status');
            statusDiv.textContent = message;
            statusDiv.className = \`status \${type}\`;
            
            setTimeout(() => {
                statusDiv.textContent = '';
                statusDiv.className = '';
            }, 3000);
        }
        
        function updateAutoSaveStatus(message) {
            const autoSaveDiv = document.getElementById('autoSaveStatus');
            if (autoSaveDiv) {
                autoSaveDiv.textContent = message;
            }
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'loadNotes':
                    if (message.notes) {
                        document.getElementById('researchGuidance').value = message.notes.researchGuidance || '';
                        document.getElementById('scriptGuidance').value = message.notes.scriptGuidance || '';
                        document.getElementById('visualStyle').value = message.notes.visualStyle || '';
                        document.getElementById('characterNotes').value = message.notes.characterNotes || '';
                        document.getElementById('narrativeFocus').value = message.notes.narrativeFocus || '';
                        document.getElementById('technicalNotes').value = message.notes.technicalNotes || '';
                    }
                    break;
                    
                case 'saveResult':
                    if (message.showStatus) {
                        if (message.success) {
                            showStatus('Editor\\'s notes saved successfully!', 'success');
                        } else {
                            showStatus('Failed to save notes: ' + message.error, 'error');
                        }
                    }
                    break;
                    
                case 'summarizeResult':
                    // Re-enable the button
                    const button = document.querySelector('button[data-field="' + message.fieldId + '"]');
                    if (button) {
                        button.disabled = false;
                        button.textContent = '📝 Summarize';
                    }
                    
                    if (message.success) {
                        // Update the textarea with the summarized content
                        document.getElementById(message.fieldId).value = message.summarizedContent;
                        showStatus('Content summarized successfully!', 'success');
                    } else {
                        showStatus('Failed to summarize: ' + message.error, 'error');
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
}

/**
 * Open Edit Research Results in a webview panel
 */
async function openEditResearchPanel(storyService: StoryService, storyId?: string, context?: vscode.ExtensionContext, aiService?: AIService) {
    try {
        // Create and show a new webview panel
        const panel = vscode.window.createWebviewPanel(
            'soraEditResearch',
            'Edit Research Results',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        // Get the HTML content - try multiple paths
        let htmlContent: string;
        try {
            // First try the extension context path
            const htmlPath = vscode.Uri.joinPath(context!.extensionUri, 'src', 'webviews', 'editResearchResults.html');
            htmlContent = require('fs').readFileSync(htmlPath.fsPath, 'utf8');
        } catch (error) {
            try {
                // Fallback to relative path from compiled location
                const htmlPath = require('path').join(__dirname, '../../src/webviews/editResearchResults.html');
                htmlContent = require('fs').readFileSync(htmlPath, 'utf8');
            } catch (error2) {
                // Final fallback - use embedded HTML
                htmlContent = getEmbeddedEditResearchHTML();
            }
        }
        panel.webview.html = htmlContent;

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'loadResearch':
                        await handleLoadResearch(panel.webview, storyService, storyId);
                        break;
                    case 'saveResearch':
                        await handleSaveResearch(message.content, panel.webview, storyService, storyId, message.showStatus);
                        break;
                    case 'summarizeResearch':
                        await handleSummarizeResearch(message.fieldId, message.content, panel.webview, storyService, aiService!);
                        break;
                }
            },
            undefined,
            []
        );

        // Load research when panel becomes visible
        panel.onDidChangeViewState(e => {
            if (e.webviewPanel.visible) {
                handleLoadResearch(panel.webview, storyService, storyId);
            }
        });

        // Initial load of research data after panel is set up
        // Use setTimeout to ensure webview is fully initialized
        setTimeout(() => {
            handleLoadResearch(panel.webview, storyService, storyId);
        }, 100);

        logger.info('Edit research results panel opened');
    } catch (error) {
        logger.error('Failed to open edit research results panel:', error);
        Notifications.error(`Failed to open edit research results: ${error}`);
    }
}

/**
 * Handle loading research in the webview
 */
async function handleLoadResearch(webview: vscode.Webview, storyService: StoryService, storyId?: string) {
    try {
        let currentStory;
        
        if (storyId) {
            // Use the specific story ID provided
            currentStory = storyService.getStory(storyId);
        } else {
            // Fallback to first story if no specific ID
            const stories = storyService.getAllStories();
            if (stories.length === 0) {
                webview.postMessage({
                    command: 'loadResearch',
                    research: null
                });
                return;
            }
            currentStory = stories[0];
        }
        
        if (currentStory) {
            // Load research ONLY from master_context.json (single source of truth)
            let researchContent = '';
            
            try {
                const storyDir = storyService.getStoryDirectory(currentStory.id);
                const masterContextPath = require('path').join(storyDir, 'source', 'master_context.json');
                
                logger.info(`Loading research from: ${masterContextPath}`);
                
                if (require('fs').existsSync(masterContextPath)) {
                    const masterContext = JSON.parse(require('fs').readFileSync(masterContextPath, 'utf8'));
                    
                    if (masterContext.research) {
                        researchContent = typeof masterContext.research === 'string' 
                            ? masterContext.research 
                            : JSON.stringify(masterContext.research, null, 2);
                        logger.info(`Research loaded: ${researchContent.length} characters`);
                    } else {
                        logger.warn('master_context.json exists but research field is empty');
                    }
                } else {
                    logger.warn('master_context.json not found for story:', currentStory.id, 'at path:', masterContextPath);
                }
            } catch (error) {
                logger.error(`Error loading research from master_context.json for story ${currentStory.id}:`, error);
            }
            
            webview.postMessage({
                command: 'loadResearch',
                storyId: currentStory.id,
                research: {
                    content: researchContent
                }
            });
        } else {
            webview.postMessage({
                command: 'loadResearch',
                research: null
            });
        }
    } catch (error) {
        logger.error('Error loading research:', error);
        webview.postMessage({
            command: 'loadResearch',
            research: null
        });
    }
}

/**
 * Handle saving research in the webview
 */
async function handleSaveResearch(content: string, webview: vscode.Webview, storyService: StoryService, storyId?: string, showStatus: boolean = false) {
    try {
        if (!storyId) {
            const stories = storyService.getAllStories();
            if (stories.length === 0) {
                webview.postMessage({
                    command: 'saveResult',
                    success: false,
                    error: 'No story found',
                    showStatus: showStatus
                });
                return;
            }
            storyId = stories[0].id;
        }

        // Write research DIRECTLY to master_context.json (single source of truth)
        logger.info(`Saving research updates for story ${storyId} (${content.length} characters)`);
        
        try {
            const story = storyService.getStory(storyId);
            if (!story) {
                webview.postMessage({
                    command: 'saveResult',
                    success: false,
                    error: 'Story not found',
                    showStatus: showStatus
                });
                return;
            }

            const storyDir = storyService.getStoryDirectory(storyId);
            const masterContextPath = require('path').join(storyDir, 'source', 'master_context.json');
            
            if (!require('fs').existsSync(masterContextPath)) {
                logger.error(`master_context.json not found at ${masterContextPath}`);
                webview.postMessage({
                    command: 'saveResult',
                    success: false,
                    error: 'master_context.json not found',
                    showStatus: showStatus
                });
                return;
            }
            
            // Load, update, and save master_context.json
            const masterContext = JSON.parse(require('fs').readFileSync(masterContextPath, 'utf8'));
            masterContext.research = content;
            masterContext.modifiedAt = new Date().toISOString();
            
            require('fs').writeFileSync(masterContextPath, JSON.stringify(masterContext, null, 2));
            logger.info(`Research saved successfully to master_context.json`);
        } catch (error) {
            logger.error(`Error saving research to master_context.json:`, error);
            webview.postMessage({
                command: 'saveResult',
                success: false,
                error: `Failed to save: ${error}`,
                showStatus: showStatus
            });
            return;
        }

        webview.postMessage({
            command: 'saveResult',
            success: true,
            showStatus: showStatus
        });

        logger.info(`Research content saved for story: ${storyId}`);
    } catch (error) {
        logger.error('Error saving research:', error);
        webview.postMessage({
            command: 'saveResult',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            showStatus: showStatus
        });
    }
}

/**
 * Handle summarizing research content
 */
async function handleSummarizeResearch(fieldId: string, content: string, webview: vscode.Webview, storyService: StoryService, aiService: AIService) {
    try {
        console.log('Summarizing research field:', fieldId, 'content length:', content.length);

        // Define field-specific prompts for research summarization
        const fieldPrompts: {[key: string]: string} = {
            'researchContent': `Please summarize and refine this research content for video production. Make it more concise while preserving all essential information for script generation. Focus on clarity and actionable details for video creation.`
        };

        const prompt = fieldPrompts[fieldId] || 'Please summarize and refine this content.';
        const fullPrompt = `${prompt}\n\nContent to summarize:\n${content}`;

        console.log('Sending to AI service with prompt length:', fullPrompt.length);
        
        // Use the AI service to get summarized content
        const summarizedContent = await aiService.getRawText(fullPrompt);
        
        console.log('Received summarized content, length:', summarizedContent.length);

        webview.postMessage({
            command: 'summarizeResult',
            fieldId: fieldId,
            success: true,
            summarizedContent: summarizedContent
        });

        logger.info(`Research content summarized for field: ${fieldId}`);
    } catch (error) {
        console.error('Error summarizing research field:', error);
        logger.error('Error summarizing research field:', error);
        webview.postMessage({
            command: 'summarizeResult',
            fieldId: fieldId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

/**
 * Get embedded HTML content for Edit Research Results
 */
function getEmbeddedEditResearchHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Research Results</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            color: var(--vscode-foreground);
            margin: 0 0 10px 0;
            font-size: 1.5em;
        }

        .header p {
            color: var(--vscode-descriptionForeground);
            margin: 0;
            font-size: 0.9em;
        }

        .research-section {
            margin-bottom: 25px;
        }

        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10px;
        }

        .section-title {
            color: var(--vscode-foreground);
            font-weight: 600;
            margin: 0;
        }

        .btn-summarize {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border);
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s ease;
        }

        .btn-summarize:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn-summarize:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .research-textarea {
            width: 100%;
            min-height: 200px;
            padding: 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            line-height: 1.5;
            border-radius: 3px;
            resize: vertical;
            box-sizing: border-box;
        }

        .research-textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .status {
            padding: 8px 12px;
            border-radius: 3px;
            margin: 10px 0;
            font-size: 0.9em;
            display: none;
        }

        .status.success {
            background-color: var(--vscode-testing-iconPassed);
            color: var(--vscode-foreground);
        }

        .status.error {
            background-color: var(--vscode-testing-iconFailed);
            color: var(--vscode-foreground);
        }

        .auto-save-status {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 6px 12px;
            border-radius: 3px;
            font-size: 0.8em;
            z-index: 1000;
        }

        .research-info {
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            padding: 12px;
            margin-bottom: 20px;
            border-radius: 3px;
        }

        .research-info h3 {
            margin: 0 0 8px 0;
            color: var(--vscode-foreground);
            font-size: 1em;
        }

        .research-info p {
            margin: 0;
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }

        .original-content {
            margin-top: 15px;
        }

        .original-content h4 {
            color: var(--vscode-foreground);
            margin: 0 0 8px 0;
            font-size: 0.9em;
        }

        .original-text {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 10px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.85em;
            line-height: 1.4;
            max-height: 200px;
            overflow-y: auto;
            color: var(--vscode-foreground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📚 Edit Research Results</h1>
            <p>Review and customize the AI-generated research for this story. Changes will be used in script generation.</p>
        </div>

        <div class="research-info">
            <h3>💡 About Research Editing</h3>
            <p>This research text guides the AI in generating accurate and contextually appropriate video scripts. You can edit the content to better reflect your vision or use the Summarize button to refine it with AI assistance.</p>
        </div>

        <div class="research-section">
            <div class="section-header">
                <h2 class="section-title">Research Content</h2>
                <button class="btn-summarize" data-field="researchContent" onclick="summarizeField('researchContent')">
                    📝 Summarize
                </button>
            </div>
            <textarea 
                id="researchContent" 
                class="research-textarea" 
                placeholder="Research content will appear here after analysis..."
            ></textarea>
        </div>

        <div class="original-content" id="originalContentSection" style="display: none;">
            <h4>Original AI-Generated Research</h4>
            <div id="originalContent" class="original-text"></div>
        </div>

        <div id="status" class="status"></div>
    </div>

    <div id="autoSaveStatus" class="auto-save-status" style="display: none;"></div>

    <script>
        let autoSaveTimeout;
        let currentStoryId = null;

        // Initialize auto-save
        function setupAutoSave() {
            const textarea = document.getElementById('researchContent');
            textarea.addEventListener('input', function() {
                clearTimeout(autoSaveTimeout);
                autoSaveTimeout = setTimeout(() => {
                    saveResearch();
                }, 1000); // 1 second debounce
            });
        }

        function saveResearch(showStatus = false) {
            const content = document.getElementById('researchContent').value;
            
            updateAutoSaveStatus('💾 Saving...');
            
            vscode.postMessage({
                command: 'saveResearch',
                storyId: currentStoryId,
                content: content,
                showStatus: showStatus
            });
        }

        function clearResearch() {
            if (confirm('Are you sure you want to clear all research content?')) {
                document.getElementById('researchContent').value = '';
                updateAutoSaveStatus('Research cleared');
            }
        }

        function summarizeField(fieldId) {
            console.log('Summarize field called for:', fieldId);
            const textarea = document.getElementById(fieldId);
            const content = textarea.value.trim();
            
            if (!content) {
                showStatus('Please enter some content to summarize', 'error');
                return;
            }
            
            // Find the button for this field using data attribute
            const button = document.querySelector('button[data-field="' + fieldId + '"]');
            if (button) {
                button.disabled = true;
                button.textContent = '⏳ Summarizing...';
            }
            
            console.log('Sending summarize request for field:', fieldId, 'content length:', content.length);
            
            // Send to extension for AI processing
            vscode.postMessage({
                command: 'summarizeResearch',
                fieldId: fieldId,
                content: content
            });
        }

        function showStatus(message, type) {
            const statusDiv = document.getElementById('status');
            statusDiv.textContent = message;
            statusDiv.className = \`status \${type}\`;
            statusDiv.style.display = 'block';
            
            setTimeout(() => {
                statusDiv.textContent = '';
                statusDiv.className = 'status';
                statusDiv.style.display = 'none';
            }, 3000);
        }

        function updateAutoSaveStatus(message) {
            const autoSaveDiv = document.getElementById('autoSaveStatus');
            if (autoSaveDiv) {
                autoSaveDiv.textContent = message;
                autoSaveDiv.style.display = 'block';
                
                if (message === '💾 Saving...') {
                    setTimeout(() => {
                        autoSaveDiv.style.display = 'none';
                    }, 2000);
                }
            }
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'loadResearch':
                    currentStoryId = message.storyId;
                    if (message.research) {
                        document.getElementById('researchContent').value = message.research.content || '';
                        
                        // Show original content if it exists and is different
                        if (message.research.originalContent && 
                            message.research.originalContent !== message.research.content) {
                            document.getElementById('originalContent').textContent = message.research.originalContent;
                            document.getElementById('originalContentSection').style.display = 'block';
                        }
                    }
                    setupAutoSave();
                    break;
                    
                case 'saveResult':
                    if (message.showStatus) {
                        if (message.success) {
                            showStatus('Research results saved successfully!', 'success');
                        } else {
                            showStatus('Failed to save research: ' + message.error, 'error');
                        }
                    }
                    updateAutoSaveStatus('✅ Saved');
                    break;
                    
                case 'summarizeResult':
                    // Re-enable the button
                    const button = document.querySelector('button[data-field="' + message.fieldId + '"]');
                    if (button) {
                        button.disabled = false;
                        button.textContent = '📝 Summarize';
                    }
                    
                    if (message.success) {
                        // Update the textarea with the summarized content
                        document.getElementById(message.fieldId).value = message.summarizedContent;
                        showStatus('Research content summarized successfully!', 'success');
                    } else {
                        showStatus('Failed to summarize: ' + message.error, 'error');
                    }
                    break;
            }
        });

        // Initialize
        setupAutoSave();
    </script>
</body>
</html>`;
}

