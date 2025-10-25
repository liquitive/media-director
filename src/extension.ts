/**
 * VS Code Extension Entry Point
 * Sora Video Director
 */

import * as vscode from 'vscode';
import { StoryTreeProvider } from './providers/storyTreeProvider';
import { ScriptEditorProvider } from './providers/scriptEditorProvider';
import { AssetTreeProvider } from './providers/assetTreeProvider';
import { StorylineEditorProvider } from './providers/storylineEditorProvider';
import { StoryService } from './services/storyService';
import { AIService } from './services/aiService';
import { OpenAIService } from './services/openaiService';
import { VideoService } from './services/videoService';
import { AudioService } from './services/audioService';
import { AudioAnalysisService } from './services/audioAnalysisService';
import { ExecutionService } from './services/executionService';
import { WebResourceService } from './services/webResourceService';
import { AssetService } from './services/assetService';
import { SegmentValidationService } from './services/segmentValidationService';
import { AssistantsAPIOneShotGenerator } from './services/assistantsAPIOneShotGenerator';
import { ExplicitErrorLogger } from './utils/explicitErrorLogger';
import { SegmentCorrectionParticipant } from './chat/segmentCorrectionParticipant';
import { logger } from './utils/logger';
import { Notifications } from './utils/notifications';
import { ProgressManager } from './services/progressManager';
import { StoryConfigEditorProvider } from './providers/storyConfigEditorProvider';
import { AssetEditorProvider } from './providers/assetEditorProvider';
import { VideoPlayerProvider } from './providers/videoPlayerProvider';
import { SegmentEditorProvider } from './providers/segmentEditorProvider';
import { PythonDependencyService } from './services/pythonDependencyService';
import { registerCommands } from './commands';
import { registerAssetCommands } from './commands/assetCommands';

let storyService: StoryService;
let aiService: AIService;
let openaiService: OpenAIService;
let videoService: VideoService;
let audioService: AudioService;
let audioAnalysisService: AudioAnalysisService;
let executionService: ExecutionService;
let webResourceService: WebResourceService;
let assetService: AssetService;
let validationService: SegmentValidationService;
let chatParticipant: SegmentCorrectionParticipant;
let storyTreeProvider: StoryTreeProvider;
let assetTreeProvider: AssetTreeProvider;
let progressManager: ProgressManager;
let storylineEditorProvider: StorylineEditorProvider;

export async function activate(context: vscode.ExtensionContext) {
    logger.info('Sora Video Director extension activating...');
    
    // Log initialization (uses shared output channel from logger)
    Notifications.log('Sora Video Director initialized', true);

    // Check if workspace folder exists
    if (!vscode.workspace.workspaceFolders) {
        // Register empty tree views to prevent "no data provider" errors
        registerEmptyTreeViews(context);
        
        vscode.window.showWarningMessage(
            'Sora Director requires a workspace folder. Please open a folder first.',
            'Open Folder'
        ).then(selection => {
            if (selection === 'Open Folder') {
                vscode.commands.executeCommand('vscode.openFolder');
            }
        });
        return;
    }

    try {
        // Initialize progress manager
        logger.info('Creating ProgressManager instance...');
        progressManager = ProgressManager.getInstance();
        logger.info('Initializing ProgressManager...');
        progressManager.initialize(context);
        logger.info('ProgressManager initialization complete');

        // Initialize services
        await initializeServices(context);

        // Register chat participant for segment validation
        registerChatParticipant(context);

        // Initialize tree view provider FIRST (needed by registerCommands)
        storyTreeProvider = new StoryTreeProvider(storyService);
        logger.info('Story tree provider initialized');
        
        // Initialize storyline editor provider BEFORE registering commands
        // This ensures the provider is available when commands reference it
        storylineEditorProvider = new StorylineEditorProvider(
            context.extensionUri,
            context,
            storyService,
            openaiService,
            videoService,
            audioAnalysisService,
            executionService
        );
        logger.info('Storyline editor provider initialized');


        // Register commands (now both providers are available)
        registerCommands(context, {
            storyService,
            openaiService: aiService.getOpenAIService(), // Get actual OpenAI service for Sora, Whisper, DALL-E
            aiService,
            videoService,
            audioService,
            executionService,
            storyTreeProvider,
            webResourceService,
            assetService,
            progressManager,
            storylineEditorProvider
        });
        
        // Register tree view UI (tree provider already initialized)
        // This ensures commands exist when tree items reference them
        registerTreeView(context);
        
        // Check and install Python dependencies (async, non-blocking)
        checkPythonDependencies(context);

        // Register configuration change handler
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(handleConfigurationChange)
        );

        // Show status bar item
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarItem.text = '$(film) Sora';
        statusBarItem.tooltip = 'Sora Video Director';
        statusBarItem.command = 'sora.showProgress';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);

        logger.info('Sora Video Director extension activated successfully');
        Notifications.log('✅ Sora Video Director is ready!', true);
    } catch (error) {
        logger.error('Error activating extension', error);
        Notifications.error('Failed to activate Sora Video Director', error);
    }
}

async function initializeServices(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('sora');

    // Get API key - ALWAYS REQUIRED for Whisper, Sora, DALL-E
    const apiKey = config.get<string>('apiKey') || '';
    logger.info(`API Key configured: ${apiKey ? 'Yes (length: ' + apiKey.length + ')' : 'No'}`);
    
    if (!apiKey) {
        const result = await Notifications.warn(
            'OpenAI API key is required for Whisper (transcription), Sora (video), and DALL-E (images).',
            'Open Settings'
        );

        if (result === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'sora.apiKey');
        }
        
        // Allow extension to load, but AI features won't work
        logger.warn('Extension loaded without API key - AI features will be disabled');
    }

    // Get FFmpeg path
    const ffmpegPath = config.get<string>('ffmpegPath') || 'ffmpeg';

    // Get max parallel stories
    const maxParallelStories = config.get<number>('maxParallelStories') || 3;

    // Initialize services
    storyService = new StoryService(context);
    await storyService.initialize();

    // Set story service in logger for resolving story IDs to names
    logger.setStoryService(storyService);

    // Initialize AI Service (will try IDE AI for text, always use OpenAI for media)
    aiService = new AIService(apiKey || 'dummy-key'); // Use dummy key if none provided
    await aiService.initialize();
    
    const providerInfo = aiService.getProviderInfo();
    Notifications.log(`✅ Text AI: ${providerInfo.textProvider}`);
    Notifications.log(`✅ Media AI: ${providerInfo.mediaProvider}`);
    logger.info(`AI Services: Text=${providerInfo.textProvider}, Media=${providerInfo.mediaProvider}`);
    
    // Get OpenAI service for direct media operations (Sora, Whisper, DALL-E)
    openaiService = aiService.getOpenAIService();
    
    videoService = new VideoService(ffmpegPath);
    audioService = new AudioService(ffmpegPath);
    audioAnalysisService = new AudioAnalysisService(ffmpegPath);
    webResourceService = new WebResourceService();
    
    executionService = new ExecutionService(
        storyService,
        aiService,
        assetService,
        videoService,
        aiService.getOpenAIService(), // Use OpenAI service directly for video generation (Sora API)
        progressManager,
        null as any // Will be set after workspaceRoot is available
    );

    // ExecutionService already has all services injected via constructor

    // Initialize Asset Service
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
        // Initialize error logger and assistants generator now that workspaceRoot is available
        const errorLogger = new ExplicitErrorLogger(workspaceRoot);
        const assistantsGenerator = new AssistantsAPIOneShotGenerator(apiKey || 'dummy-key', context, errorLogger);
        
        // Update execution service with the assistants generator
        (executionService as any).assistantsGenerator = assistantsGenerator;
        
        assetService = new AssetService(workspaceRoot);
        await assetService.initialize();
        
        // Clean up orphaned assets on startup
        try {
            const cleanupResult = await assetService.cleanupOrphanedAssets();
            if (cleanupResult.removed.length > 0) {
                logger.info(`Cleaned up ${cleanupResult.removed.length} orphaned assets on startup`);
            }
        } catch (error) {
            logger.warn('Asset cleanup on startup failed:', error);
        }
        
        const stats = assetService.getAssetStatistics();
        logger.info(`Asset service initialized with ${stats.total_assets} assets`);
        Notifications.log(`✅ Asset Library: ${stats.total_assets} assets`);
    }

    // Initialize Validation Service
    validationService = new SegmentValidationService(aiService);
    logger.info('Segment validation service initialized');

    // Initialize Chat Participant
    chatParticipant = new SegmentCorrectionParticipant(
        aiService,
        storyService,
        executionService,
        validationService,
        assetService,
        openaiService
    );
    logger.info('Segment correction chat participant initialized');

    logger.info('Services initialized successfully');
}

function registerEmptyTreeViews(context: vscode.ExtensionContext): void {
    // Create empty tree data providers to prevent "no data provider" errors
    class EmptyTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
        getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
            return element;
        }
        
        getChildren(): vscode.TreeItem[] {
            return [{
                label: 'No workspace folder open',
                iconPath: new vscode.ThemeIcon('warning'),
                contextValue: 'empty'
            }];
        }
    }
    
    const emptyStoryProvider = new EmptyTreeProvider();
    const emptyAssetProvider = new EmptyTreeProvider();
    
    const storyTreeView = vscode.window.createTreeView('soraStories', {
        treeDataProvider: emptyStoryProvider
    });
    
    const assetTreeView = vscode.window.createTreeView('soraAssets', {
        treeDataProvider: emptyAssetProvider
    });
    
    context.subscriptions.push(storyTreeView, assetTreeView);
    
    // Initialize progress manager even without workspace
    progressManager = ProgressManager.getInstance();
    progressManager.initialize(context);
    
    logger.info('Empty tree views registered (no workspace)');
}

function registerTreeView(context: vscode.ExtensionContext): void {
    // Note: storyTreeProvider is already initialized in activate()
    // Just register the tree view UI here
    const treeView = vscode.window.createTreeView('soraStories', {
        treeDataProvider: storyTreeProvider,
        showCollapseAll: false
    });

    // Pass tree view reference and context to provider so it can reveal items and persist state
    storyTreeProvider.setTreeView(treeView, context);

    // Periodically save the current visibility state (every 2 seconds when visible)
    const saveVisibilityState = () => {
        const state = context.workspaceState.get<any>('storyTreeViewState', { expandedNodes: [] });
        const isVisible = treeView.visible;
        
        if (isVisible) {
            state.wasViewVisible = true;
            state.activeView = 'soraStories';
            context.workspaceState.update('storyTreeViewState', state);
        }
    };

    const visibilityTimer = setInterval(saveVisibilityState, 2000);
    context.subscriptions.push({ dispose: () => clearInterval(visibilityTimer) });

    // Track when the Sora Stories view becomes visible
    context.subscriptions.push(
        treeView.onDidChangeVisibility(e => {
            const state = context.workspaceState.get<any>('storyTreeViewState', { expandedNodes: [] });
            if (e.visible) {
                logger.info('👁️ Sora Stories view became visible');
                state.wasViewVisible = true;
                state.activeView = 'soraStories';
            } else {
                logger.info('👁️ Sora Stories view became hidden');
                state.wasViewVisible = false;
            }
            context.workspaceState.update('storyTreeViewState', state);
        })
    );

    // Listen for editor changes to track what's open
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && storyService) {
                const filePath = editor.document.uri.fsPath;
                logger.info(`📝 Editor changed to: ${filePath}`);
                
                // Check if it's a segment file
                const segmentMatch = filePath.match(/segments[/\\]segment_(\d+)\.json$/);
                if (segmentMatch) {
                    const segmentIndex = parseInt(segmentMatch[1], 10) - 1; // segment_1.json = index 0
                    logger.info(`🔍 Detected segment file: segment_${segmentIndex + 1}.json`);
                    
                    // Find which story this belongs to
                    const stories = storyService.getAllStories();
                    for (const story of stories) {
                        const storyDir = storyService.getStoryDirectory(story.id);
                        if (filePath.startsWith(storyDir)) {
                            logger.info(`💾 Saving segment state: ${story.id}:${segmentIndex}`);
                            storyTreeProvider.saveLastOpenedItem('segment', story.id, segmentIndex, filePath);
                            break;
                        }
                    }
                }
                
                // Check if it's master_context.json or other story files
                const masterContextMatch = filePath.match(/master_context\.json$/);
                if (masterContextMatch) {
                    const stories = storyService.getAllStories();
                    for (const story of stories) {
                        const storyDir = storyService.getStoryDirectory(story.id);
                        if (filePath.startsWith(storyDir)) {
                            logger.info(`💾 Saving file state: ${filePath}`);
                            storyTreeProvider.saveLastOpenedItem('file', story.id, undefined, filePath);
                            break;
                        }
                    }
                }
            }
        })
    );

    // Add tree provider to subscriptions so it gets disposed properly
    context.subscriptions.push(treeView);
    
    // Register asset tree view
    if (assetService) {
        assetTreeProvider = new AssetTreeProvider(assetService);
        
        const assetTreeView = vscode.window.createTreeView('soraAssets', {
            treeDataProvider: assetTreeProvider,
            showCollapseAll: true
        });

        // Periodically save the current visibility state for Assets view
        const saveAssetVisibilityState = () => {
            const state = context.workspaceState.get<any>('storyTreeViewState', { expandedNodes: [] });
            const isVisible = assetTreeView.visible;
            
            if (isVisible) {
                state.wasViewVisible = true;
                state.activeView = 'soraAssets';
                context.workspaceState.update('storyTreeViewState', state);
            }
        };

        const assetVisibilityTimer = setInterval(saveAssetVisibilityState, 2000);
        context.subscriptions.push({ dispose: () => clearInterval(assetVisibilityTimer) });

        // Track when the Sora Assets view becomes visible
        context.subscriptions.push(
            assetTreeView.onDidChangeVisibility(e => {
                const state = context.workspaceState.get<any>('storyTreeViewState', { expandedNodes: [] });
                if (e.visible) {
                    logger.info('👁️ Sora Assets view became visible');
                    state.wasViewVisible = true;
                    state.activeView = 'soraAssets';
                } else {
                    logger.info('👁️ Sora Assets view became hidden');
                    state.wasViewVisible = false;
                }
                context.workspaceState.update('storyTreeViewState', state);
            })
        );

        context.subscriptions.push(assetTreeView);
        
        // Register asset commands
        registerAssetCommands(context, assetService, assetTreeProvider);
        
        logger.info('Asset tree view and commands registered');
    }

    
    
    // Register custom script editor
    const scriptEditorProvider = new ScriptEditorProvider(context);
    const scriptEditorRegistration = vscode.window.registerCustomEditorProvider(
        ScriptEditorProvider.viewType,
        scriptEditorProvider,
        {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }
    );
    
    context.subscriptions.push(scriptEditorRegistration);
    
    // Register story configuration editor
    const storyConfigEditorRegistration = StoryConfigEditorProvider.register(context, storyService);
    context.subscriptions.push(storyConfigEditorRegistration);
    
    // Register asset editor
    const assetEditorRegistration = AssetEditorProvider.register(context, assetService);
    context.subscriptions.push(assetEditorRegistration);
    
    // Register video player
    const videoPlayerRegistration = VideoPlayerProvider.register(context, videoService);
    context.subscriptions.push(videoPlayerRegistration);
    
    // Register segment editor
    const segmentEditorRegistration = SegmentEditorProvider.register(context, storyService);
    context.subscriptions.push(segmentEditorRegistration);
    
    // Note: storylineEditorProvider is now initialized earlier in activate()
    // before commands are registered to prevent race condition
    
    logger.info('Story tree view, script editor, and custom editors registered');
}

function registerChatParticipant(context: vscode.ExtensionContext): void {
    try {
        // Check if chat API is available (dynamic check for newer VS Code versions)
        const vscodeAny = vscode as any;
        if (!vscodeAny.chat || typeof vscodeAny.chat.createChatParticipant !== 'function') {
            logger.warn('VS Code Chat API not available - segment validation chat will be disabled');
            Notifications.log('⚠️  Chat API unavailable - validation will still work but without interactive chat');
            return;
        }

        // Register the chat participant
        const participantDisposable = vscodeAny.chat.createChatParticipant(
            'sora-segment-validator',
            chatParticipant.handleChatRequest.bind(chatParticipant)
        );

        // Set participant metadata
        participantDisposable.iconPath = new vscode.ThemeIcon('check');
        participantDisposable.fullName = 'Sora Segment Validator';

        context.subscriptions.push(participantDisposable);

        logger.info('Chat participant registered: @sora-segment-validator');
        Notifications.log('✅ Segment Validation Chat: @sora-segment-validator');
    } catch (error) {
        logger.error('Failed to register chat participant:', error);
        Notifications.log('⚠️  Chat participant registration failed - validation will work but without chat');
    }
}

function handleConfigurationChange(event: vscode.ConfigurationChangeEvent): void {
    if (event.affectsConfiguration('sora.apiKey')) {
        const apiKey = vscode.workspace.getConfiguration('sora').get<string>('apiKey') || '';
        // Re-initialize AI service with new API key
        aiService = new AIService(apiKey);
        aiService.initialize().then(() => {
            const providerInfo = aiService.getProviderInfo();
            logger.info(`API key updated. Text=${providerInfo.textProvider}, Media=${providerInfo.mediaProvider}`);
            Notifications.log(`✅ AI providers updated: Text=${providerInfo.textProvider}`);
        });
    }

    if (event.affectsConfiguration('sora.ffmpegPath')) {
        const ffmpegPath = vscode.workspace.getConfiguration('sora').get<string>('ffmpegPath') || 'ffmpeg';
        videoService.updateFfmpegPath(ffmpegPath);
        audioService.updateFfmpegPath(ffmpegPath);
        logger.info('FFmpeg path updated');
    }

    if (event.affectsConfiguration('sora.maxParallelStories')) {
        const maxParallelStories = vscode.workspace.getConfiguration('sora').get<number>('maxParallelStories') || 3;
        // Configuration change handling - max workers not currently implemented
        logger.info(`Max parallel stories configuration changed to ${maxParallelStories}`);
    }
}

async function checkPythonDependencies(context: vscode.ExtensionContext): Promise<void> {
    try {
        const pythonService = PythonDependencyService.getInstance(context.extensionPath);
        
        // Check in background (non-blocking)
        setTimeout(async () => {
            try {
                await pythonService.promptInstallIfNeeded();
                
                // Configure audio analysis service with the found Python path
                const pythonPath = pythonService.getFoundPythonPath();
                if (pythonPath && audioAnalysisService) {
                    await audioAnalysisService.configurePythonPath(pythonPath);
                }
            } catch (error) {
                logger.error('Failed to check/install Python dependencies:', error);
                // Don't block extension activation on Python dependency errors
            }
        }, 2000); // Wait 2 seconds after activation to avoid blocking
        
    } catch (error) {
        logger.error('Failed to initialize Python dependency service:', error);
    }
}

export function deactivate() {
    logger.info('Sora Video Director extension deactivating...');
    
    // Clean up storyline editor provider
    if (storylineEditorProvider) {
        storylineEditorProvider.dispose();
    }
    
    // Note: Other providers (storyTreeProvider, assetTreeProvider) 
    // are disposed automatically via context.subscriptions
    
    logger.info('Sora Video Director extension deactivated');
}

// Export services for testing
export function getServices() {
    return {
        storyService,
        aiService,
        videoService,
        audioService,
        executionService,
        webResourceService,
        storyTreeProvider,
        progressManager
    };
}

