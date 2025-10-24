import * as vscode from 'vscode';
import { StoryService } from '../services/storyService';
import { logger } from '../utils/logger';

export class StoryConfigEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'sora.storyConfigEditor';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly storyService: StoryService
    ) {}

    public static register(context: vscode.ExtensionContext, storyService: StoryService): vscode.Disposable {
        const provider = new StoryConfigEditorProvider(context, storyService);
        return vscode.window.registerCustomEditorProvider(
            StoryConfigEditorProvider.viewType,
            provider,
            {
                supportsMultipleEditorsPerDocument: false
            }
        );
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Extract story ID from document URI
        const storyId = this.extractStoryIdFromUri(document.uri);
        if (!storyId) {
            vscode.window.showErrorMessage('Invalid story configuration document');
            return;
        }

        // Get story data
        const story = this.storyService.getStory(storyId);
        if (!story) {
            vscode.window.showErrorMessage(`Story ${storyId} not found`);
            return;
        }

        // Set up webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'requestStoryData':
                        webviewPanel.webview.postMessage({
                            type: 'loadStory',
                            story: story
                        });
                        break;

                    case 'saveConfig':
                        this.saveConfiguration(storyId, message.config, document);
                        break;

                    case 'cancel':
                        webviewPanel.dispose();
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        // Handle document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                // Document was changed externally, reload story data
                const updatedStory = this.storyService.getStory(storyId);
                if (updatedStory) {
                    webviewPanel.webview.postMessage({
                        type: 'loadStory',
                        story: updatedStory
                    });
                }
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private extractStoryIdFromUri(uri: vscode.Uri): string | undefined {
        // URI format: sora://story/{storyId}/config
        const match = uri.path.match(/\/story\/([^\/]+)\/config$/);
        return match ? match[1] : undefined;
    }

    private async saveConfiguration(storyId: string, config: any, document: vscode.TextDocument): Promise<void> {
        try {
            // Update story with new configuration
            this.storyService.updateStory(storyId, {
                generationConfig: config
            });

            // Update the document content
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                document.uri,
                new vscode.Range(0, 0, document.lineCount, 0),
                JSON.stringify(config, null, 2)
            );
            
            await vscode.workspace.applyEdit(edit);
            await document.save();

            vscode.window.showInformationMessage('Story configuration saved successfully');
            logger.info(`Story configuration updated for story ${storyId}`);

        } catch (error) {
            logger.error('Failed to save story configuration:', error);
            vscode.window.showErrorMessage(`Failed to save configuration: ${error}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Story Configuration</title>
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
                    .header {
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding-bottom: 20px;
                        margin-bottom: 30px;
                    }
                    .header h1 {
                        margin: 0 0 10px 0;
                        color: var(--vscode-foreground);
                    }
                    .section {
                        margin-bottom: 30px;
                        padding: 20px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 6px;
                        background-color: var(--vscode-editor-background);
                    }
                    .section h2 {
                        margin: 0 0 15px 0;
                        color: var(--vscode-foreground);
                        font-size: 16px;
                    }
                    .form-group {
                        margin-bottom: 20px;
                    }
                    .form-group label {
                        display: block;
                        margin-bottom: 5px;
                        font-weight: 500;
                        color: var(--vscode-foreground);
                    }
                    .form-group input,
                    .form-group select,
                    .form-group textarea {
                        width: 100%;
                        padding: 8px 12px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        font-family: inherit;
                        font-size: inherit;
                    }
                    .form-group textarea {
                        min-height: 80px;
                        resize: vertical;
                    }
                    .btn {
                        padding: 10px 20px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 500;
                        transition: all 0.2s;
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
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Story Configuration</h1>
                    <p>Configure video generation settings for this story.</p>
                </div>

                <div class="section">
                    <h2>Basic Information</h2>
                    <div class="form-group">
                        <label for="storyName">Story Name</label>
                        <input type="text" id="storyName" placeholder="Enter story name">
                    </div>
                    <div class="form-group">
                        <label for="storyDescription">Description</label>
                        <textarea id="storyDescription" placeholder="Brief description of the story"></textarea>
                    </div>
                </div>

                <div class="section">
                    <h2>Video Generation Settings</h2>
                    <div class="form-group">
                        <label for="model">Generation Model</label>
                        <select id="model">
                            <option value="sora">Sora (High Quality)</option>
                            <option value="sora-turbo">Sora Turbo (Faster, Lower Quality)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="visualStyle">Visual Style</label>
                        <select id="visualStyle">
                            <option value="naturalistic">Naturalistic</option>
                            <option value="cinematic">Cinematic</option>
                            <option value="photorealistic">Photorealistic</option>
                            <option value="cartoon">Cartoon/Animated</option>
                            <option value="anime">Anime</option>
                            <option value="sci-fi">Sci-Fi/Futuristic</option>
                            <option value="fantasy">Fantasy</option>
                            <option value="retro">Retro/Vintage</option>
                        </select>
                    </div>
                </div>

                <div class="button-group">
                    <button class="btn btn-primary" id="saveBtn">Save Configuration</button>
                    <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    // Load story data
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'loadStory':
                                loadStoryData(message.story);
                                break;
                        }
                    });

                    function loadStoryData(story) {
                        document.getElementById('storyName').value = story.name || '';
                        document.getElementById('storyDescription').value = story.description || '';
                        
                        if (story.generationConfig) {
                            const config = story.generationConfig;
                            document.getElementById('model').value = config.model || 'sora';
                            document.getElementById('visualStyle').value = config.visualStyle || 'naturalistic';
                        }
                    }

                    // Save configuration
                    document.getElementById('saveBtn').addEventListener('click', () => {
                        const config = {
                            model: document.getElementById('model').value,
                            visualStyle: document.getElementById('visualStyle').value,
                            defaultDuration: 4,
                            quality: 'medium',
                            aspectRatio: '16:9',
                            audioSettings: {
                                enableMusic: true,
                                enableNarration: true,
                                musicVolume: 50,
                                narrationVolume: 80
                            },
                            preferredAssets: []
                        };

                        vscode.postMessage({
                            type: 'saveConfig',
                            config: config
                        });
                    });

                    // Cancel
                    document.getElementById('cancelBtn').addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'cancel'
                        });
                    });

                    // Request story data on load
                    vscode.postMessage({
                        type: 'requestStoryData'
                    });
                </script>
            </body>
            </html>
        `;
    }
}





















































