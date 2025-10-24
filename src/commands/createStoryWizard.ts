/**
 * Story Creation Wizard
 * Multi-step QuickPick wizard for creating stories from various sources
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StoryService } from '../services/storyService';
import { OpenAIService } from '../services/openaiService';
import { AIService } from '../services/aiService';
import { AudioService } from '../services/audioService';
import { AudioAnalysisService } from '../services/audioAnalysisService';
import { WebResourceService } from '../services/webResourceService';
import { AssetService } from '../services/assetService';
import { ExecutionService } from '../services/executionService';
import { MasterContextFileBuilder } from '../services/masterContextFileBuilder';
import { StoryTreeProvider } from '../providers/storyTreeProvider';
import { Notifications } from '../utils/notifications';
import { logger } from '../utils/logger';
import { ProgressManager } from '../services/progressManager';
import { createMultiStepInput, StepConfig } from '../utils/multiStepInput';
import { Story } from '../models/story';
import { FileManager } from '../utils/fileManager';

interface WizardServices {
    storyService: StoryService;
    openaiService: OpenAIService;
    aiService: AIService;
    audioService: AudioService;
    webResourceService: WebResourceService;
    storyTreeProvider: StoryTreeProvider;
    assetService: AssetService;
    executionService: ExecutionService;
}

export async function createStoryWizard(services: WizardServices): Promise<void> {
    const { storyService, openaiService, aiService, audioService, webResourceService, storyTreeProvider, assetService, executionService } = services;

    try {
        // Show creation method selection
        const selectedOption = await vscode.window.showQuickPick([
            {
                label: '$(add) Create Manually',
                description: 'Start with an empty story and build it step by step',
                detail: 'Perfect for writing original content or importing text later',
                value: 'manual'
            },
            {
                label: '$(file-media) Import from File',
                description: 'Import from audio, video, text, or JSON files',
                detail: 'Supports MP3, MP4, TXT, JSON and more',
                value: 'file'
            },
            {
                label: '$(globe) Import from Web',
                description: 'Import from YouTube, web pages, or audio URLs',
                detail: 'Automatically extracts and transcribes content',
                value: 'web'
            }
        ], {
            placeHolder: 'Choose how you want to create your story',
            title: 'Create New Story'
        });

        if (!selectedOption) {
            return; // User cancelled
        }

        // Handle the selected option
        if (selectedOption.value === 'manual') {
            await handleManualCreation(storyService, storyTreeProvider);
        } else if (selectedOption.value === 'file') {
            await handleFileImport(storyService, openaiService, aiService, audioService, storyTreeProvider, assetService, executionService);
        } else if (selectedOption.value === 'web') {
            await handleWebImport(storyService, openaiService, webResourceService, storyTreeProvider);
        }

    } catch (error) {
        logger.error('Story creation wizard failed:', error);
        Notifications.error('Failed to create story', error);
    }
}

/**
 * Handle manual story creation
 */
async function handleManualCreation(
    storyService: StoryService,
    storyTreeProvider: StoryTreeProvider
): Promise<void> {
    // Get story name
    const name = await vscode.window.showInputBox({
        prompt: 'Enter a name for your story',
        placeHolder: 'My Awesome Story',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Story name is required';
            }
            if (value.length > 100) {
                return 'Story name must be less than 100 characters';
            }
            return undefined;
        }
    });

    if (!name) return;

    // Get description
    const description = await vscode.window.showInputBox({
        prompt: 'Enter a description (optional)',
        placeHolder: 'Brief description of your story...',
        validateInput: (value) => {
            if (value && value.length > 500) {
                return 'Description must be less than 500 characters';
            }
            return undefined;
        }
    });

    // Ask if user wants to add content
    const addContent = await vscode.window.showQuickPick([
        {
            label: '$(add) Add Text Content',
            description: 'Add lyrics, script, or text content now',
            detail: 'You can always add more content later',
            value: true
        },
        {
            label: '$(skip) Skip for Now',
            description: 'Create empty story and add content later',
            detail: 'Perfect for planning and organizing',
            value: false
        }
    ], {
        placeHolder: 'Would you like to add content now or later?',
        title: 'Add Content'
    });

    if (!addContent) return;

    let content = '';
    if (addContent.value) {
        const contentResult = await vscode.window.showInputBox({
            prompt: 'Enter your content',
            placeHolder: 'Paste lyrics, script, poetry, or any text content...',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Content is required';
                }
                return undefined;
            }
        });
        content = contentResult || '';
    }

    // Create the story
    const story = storyService.createStory(name, 'text', '', content);
    
    // Update with additional properties
    storyService.updateStory(story.id, {
        description: description || '',
        importedFrom: 'manual'
    });
    
    storyTreeProvider.refresh();

    Notifications.log(`✅ Story "${name}" created successfully!`, true);
    logger.info(`Created manual story: ${story.id}`);
}

/**
 * Handle file import
 */
async function handleFileImport(
    storyService: StoryService,
    openaiService: OpenAIService,
    aiService: AIService,
    audioService: AudioService,
    storyTreeProvider: StoryTreeProvider,
    assetService: AssetService,
    executionService: ExecutionService
): Promise<void> {
    // Show file picker
    const fileUri = await Notifications.openFile('Select file to import', {
        'All Supported': ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'mov', 'avi', 'mkv', 'txt', 'md', 'json'],
        'Audio Files': ['mp3', 'wav', 'm4a', 'flac', 'ogg'],
        'Video Files': ['mp4', 'mov', 'avi', 'mkv'],
        'Text Files': ['txt', 'md'],
        'JSON Files': ['json']
    });

    if (!fileUri) {
        return;
    }

    const filePath = fileUri.fsPath;
    const fileName = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath).toLowerCase();

    let inputType: 'text' | 'audio' | 'video';
    let content = '';
    let suggestedName = fileName;

    try {
        if (['.mp3', '.wav', '.m4a', '.flac', '.ogg'].includes(ext)) {
            inputType = 'audio';
            content = ''; // Will be transcribed asynchronously in background
            Notifications.log('📁 Audio file imported, transcription will happen in background');
        } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
            inputType = 'video';
            content = ''; // Will be transcribed asynchronously in background
            Notifications.log('📁 Video file imported, extraction and transcription will happen in background');
        } else if (['.txt', '.md'].includes(ext)) {
            inputType = 'text';
            content = fs.readFileSync(filePath, 'utf8');
        } else if (ext === '.json') {
            // Handle JSON import
            const jsonContent = fs.readFileSync(filePath, 'utf8');
            const jsonData = JSON.parse(jsonContent);
            
            try {
                const story = storyService.importStoryFromJSON(jsonData);
                storyTreeProvider.refresh();
                Notifications.log(`✅ Story imported from JSON: "${story.name}"`, true);
                return;
            } catch (error) {
                Notifications.error(`Failed to import JSON: ${error}`);
                return;
            }
        } else {
            Notifications.error(`Unsupported file type: ${ext}`);
            return;
        }

        // Use filename as story name (can be renamed later)
        const storyName = suggestedName;

        // Create the story
        const story = storyService.createStory(storyName, inputType, filePath, content);
        
        // Copy original file immediately
        const storyDir = storyService.getStoryDirectory(story.id);
        const sourceFiles: any = {};
        
        try {
            // Copy original file immediately
            const originalPath = FileManager.copySourceFile(filePath, storyDir, path.basename(filePath));
            sourceFiles.original = originalPath;
        } catch (error) {
            logger.warn('Failed to copy source file:', error);
        }
        
        // Update story with basic info immediately
        storyService.updateStory(story.id, {
            importedFrom: 'file',
            sourceFiles: sourceFiles,
            metadata: {
                originalFilename: path.basename(filePath),
                fileType: ext.substring(1)
            }
        });
        
        // Do heavy processing asynchronously in the background
        if (inputType === 'audio' || inputType === 'video') {
            processAudioAsync(story.id, filePath, storyDir, openaiService, audioService, storyService, assetService, aiService, executionService);
        }
        
        storyTreeProvider.refresh();

        Notifications.log(`✅ Story "${storyName}" created from file!`, true);
        logger.info(`Created story from file: ${story.id}`);

    } catch (error) {
        logger.error('File import failed:', error);
        Notifications.error('Failed to import file', error);
    }
}

/**
 * Handle web resource import
 */
async function handleWebImport(
    storyService: StoryService,
    openaiService: OpenAIService,
    webResourceService: WebResourceService,
    storyTreeProvider: StoryTreeProvider
): Promise<void> {
    const steps: StepConfig[] = [
        {
            title: 'Web Resource Import',
            placeholder: 'Enter the URL to import from',
            inputBox: {
                prompt: 'URL',
                placeholder: 'https://youtube.com/watch?v=... or https://example.com/audio.mp3',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'URL is required';
                    }
                    if (!webResourceService.validateUrl(value)) {
                        return 'Please enter a valid URL';
                    }
                    return undefined;
                }
            }
        }
    ];

    const results = await createMultiStepInput(steps);
    if (!results) return;

    const url = results[0].value;
    const resourceType = webResourceService.detectResourceType(url);

    try {
        let content = '';
        let suggestedName = 'Imported Story';
        let inputType: 'text' | 'audio' | 'video' = 'text';

        await Notifications.withProgress('Fetching web resource...', async (progress) => {
            if (resourceType === 'youtube') {
                progress.report({ message: 'Fetching YouTube metadata...' });
                const metadata = await webResourceService.fetchYouTubeMetadata(url);
                suggestedName = metadata.title;
                content = metadata.description;
                inputType = 'video';
            } else if (resourceType === 'audio') {
                progress.report({ message: 'Downloading audio...' });
                // For now, we'll just extract the filename
                const urlObj = new URL(url);
                suggestedName = path.basename(urlObj.pathname, path.extname(urlObj.pathname));
                inputType = 'audio';
                // Note: In a real implementation, you'd download and transcribe the audio
                content = 'Audio content will be processed...';
            } else if (resourceType === 'webpage') {
                progress.report({ message: 'Fetching web page content...' });
                const pageContent = await webResourceService.fetchWebPageText(url);
                suggestedName = pageContent.title;
                content = pageContent.text;
                inputType = 'text';
            } else {
                throw new Error('Unsupported web resource type');
            }
        });

        // Show preview and confirm name
        const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
        
        const nameResult = await Notifications.input(
            'Confirm Story Name',
            'Edit the story name if needed',
            suggestedName,
            (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Story name is required';
                }
                return undefined;
            }
        );

        if (!nameResult) return;

        // Create the story
        const story = storyService.createStory(nameResult, inputType, url, content);
        
        // Update with additional properties
        storyService.updateStory(story.id, {
            importedFrom: 'web',
            sourceUrl: url,
            metadata: {
                webTitle: suggestedName,
                webDescription: content.length > 500 ? content.substring(0, 500) + '...' : content
            }
        });
        
        storyTreeProvider.refresh();

        Notifications.log(`✅ Story "${nameResult}" created from web resource!`, true);
        logger.info(`Created story from web: ${story.id}`);

    } catch (error) {
        logger.error('Web import failed:', error);
        Notifications.error('Failed to import from web resource', error);
    }
}

/**
 * Process audio/video files asynchronously in the background
 * NOTE: This now delegates to DirectorScriptGeneratorService for the complete pipeline
 */
async function processAudioAsync(
    storyId: string, 
    filePath: string, 
    storyDir: string, 
    openaiService: OpenAIService, 
    audioService: AudioService, 
    storyService: StoryService,
    assetService: AssetService,
    aiService: AIService,
    executionService: ExecutionService
): Promise<void> {
    // Use the new unified DirectorScriptGeneratorService for the complete pipeline
    const { DirectorScriptGeneratorService } = await import('../services/directorScriptGeneratorService');
    const scriptGenerator = new DirectorScriptGeneratorService(
        storyService,
        audioService,
        assetService,
        openaiService,
        executionService,
        aiService
    );
    
    try {
        await scriptGenerator.generateScript(storyId);
    } catch (error) {
        logger.error('Script generation failed in processAudioAsync:', error);
        Notifications.error(`Failed to generate script: ${error}`);
    }
}
