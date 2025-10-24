import * as vscode from 'vscode';
import { StoryService } from '../services/storyService';
import { logger } from '../utils/logger';

export class SegmentEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'sora.segmentEditor';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly storyService: StoryService
    ) {}

    public static register(context: vscode.ExtensionContext, storyService: StoryService): vscode.Disposable {
        const provider = new SegmentEditorProvider(context, storyService);
        return vscode.window.registerCustomEditorProvider(
            SegmentEditorProvider.viewType,
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
        console.log('📝 resolveCustomTextEditor called for:', document.uri.path);
        
        // Extract story ID and segment index from document URI
        const { storyId, segmentIndex } = this.extractStoryAndSegmentFromUri(document.uri);
        console.log('📝 Extracted parameters:', { storyId, segmentIndex });
        
        if (!storyId || segmentIndex === undefined) {
            console.error('📝 Invalid parameters extracted:', { storyId, segmentIndex });
            vscode.window.showErrorMessage('Invalid segment document');
            return;
        }

        // Get story and segment data
        const story = this.storyService.getStory(storyId);
        if (!story) {
            vscode.window.showErrorMessage(`Story ${storyId} not found`);
            return;
        }

        const segment = story.directorScript[segmentIndex];
        if (!segment) {
            vscode.window.showErrorMessage(`Segment ${segmentIndex} not found`);
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
                console.log('📨 Message received:', message.type);
                console.log('📨 Current storyId:', storyId, 'type:', typeof storyId);
                console.log('📨 Current segmentIndex:', segmentIndex, 'type:', typeof segmentIndex);
                
                switch (message.type) {
                    case 'requestSegmentData':
                        webviewPanel.webview.postMessage({
                            type: 'loadSegment',
                            segment: segment,
                            story: story
                        });
                        break;

                    case 'saveSegment':
                        this.saveSegment(storyId, segmentIndex, message.segment, document);
                        break;

                    case 'generateVideo':
                        // Re-extract parameters to ensure we have the correct values
                        const { storyId: currentStoryId, segmentIndex: currentSegmentIndex } = this.extractStoryAndSegmentFromUri(document.uri);
                        console.log('🎬 Re-extracted parameters:', { currentStoryId, currentSegmentIndex });
                        if (currentStoryId && currentSegmentIndex !== undefined) {
                            this.regenerateSegment(currentStoryId, currentSegmentIndex);
                        } else {
                            console.error('🎬 Invalid parameters after re-extraction:', { currentStoryId, currentSegmentIndex });
                        }
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
                // Document was changed externally, reload segment data
                const updatedStory = this.storyService.getStory(storyId);
                if (updatedStory && updatedStory.directorScript[segmentIndex]) {
                    webviewPanel.webview.postMessage({
                        type: 'loadSegment',
                        segment: updatedStory.directorScript[segmentIndex],
                        story: updatedStory
                    });
                }
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private extractStoryAndSegmentFromUri(uri: vscode.Uri): { storyId: string | undefined, segmentIndex: number | undefined } {
        console.log('🔍 Extracting from URI:', uri.path);
        
        // URI format: file:///path/to/.sora/stories/story_123/segments/segment_1.json
        // or: file:///path/to/sora-output/stories/story_name/segments/segment_1.json
        const match = uri.path.match(/stories\/([^\/]+)\/segments\/segment_(\d+)\.json$/);
        console.log('🔍 Regex match result:', match);
        
        if (match) {
            const storyId = match[1];
            const segmentIndex = parseInt(match[2]) - 1;
            console.log('🔍 Extracted from URI:', { storyId, segmentIndex });
            return { storyId, segmentIndex };
        }
        
        // If no match, try to extract from the segment JSON file content
        console.log('🔍 No regex match, trying to read file content...');
        try {
            const fs = require('fs');
            const content = fs.readFileSync(uri.fsPath, 'utf8');
            const segmentData = JSON.parse(content);
            console.log('🔍 Extracted from file content:', { 
                storyId: segmentData.storyId, 
                segmentIndex: segmentData.segmentIndex 
            });
            return {
                storyId: segmentData.storyId,
                segmentIndex: segmentData.segmentIndex
            };
        } catch (error) {
            console.error('🔍 Failed to read segment file:', error);
            return { storyId: undefined, segmentIndex: undefined };
        }
    }

    private async saveSegment(storyId: string, segmentIndex: number, segmentData: any, document: vscode.TextDocument): Promise<void> {
        try {
            // Update segment in story
            const story = this.storyService.getStory(storyId);
            if (story && story.directorScript[segmentIndex]) {
                story.directorScript[segmentIndex] = {
                    ...story.directorScript[segmentIndex],
                    ...segmentData
                };

                // Update the document content
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(0, 0, document.lineCount, 0),
                    JSON.stringify(segmentData, null, 2)
                );
                
                await vscode.workspace.applyEdit(edit);
                await document.save();

                vscode.window.showInformationMessage('Segment saved successfully');
                logger.info(`Segment ${segmentIndex + 1} updated for story ${storyId}`);

            } else {
                throw new Error('Story or segment not found');
            }

        } catch (error) {
            logger.error('Failed to save segment:', error);
            vscode.window.showErrorMessage(`Failed to save segment: ${error}`);
        }
    }

    private async regenerateSegment(storyId: string, segmentIndex: number): Promise<void> {
        try {
            console.log('🔄 regenerateSegment called with:', { storyId, segmentIndex });
            
            // Get the story to access its data
            const story = this.storyService.getStory(storyId);
            if (!story) {
                vscode.window.showErrorMessage(`Story ${storyId} not found`);
                return;
            }

            // Show progress notification
            vscode.window.showInformationMessage(`🔄 Regenerating segment ${segmentIndex + 1}...`);

            // Use the same flow as Regenerate Script but filter to only update the specific segment
            await vscode.commands.executeCommand('sora.regenerateScript', storyId, segmentIndex);
            
            logger.info(`Segment ${segmentIndex + 1} regeneration triggered for story ${storyId}`);

        } catch (error) {
            logger.error('Failed to regenerate segment:', error);
            vscode.window.showErrorMessage(`Failed to regenerate segment: ${error}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Segment Editor</title>
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
                        display: flex;
                        align-items: center;
                        gap: 15px;
                    }
                    .segment-number {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        padding: 4px 12px;
                        border-radius: 4px;
                        font-size: 14px;
                        font-weight: 500;
                    }
                    .status-badge {
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 12px;
                        font-weight: 500;
                        text-transform: uppercase;
                    }
                    .status-pending { background-color: #6c757d; color: white; }
                    .status-generating { background-color: #007acc; color: white; }
                    .status-completed { background-color: #28a745; color: white; }
                    .status-failed { background-color: #dc3545; color: white; }
                    .tabs {
                        display: flex;
                        border-bottom: 1px solid var(--vscode-panel-border);
                        margin-bottom: 20px;
                    }
                    .tab {
                        padding: 10px 20px;
                        cursor: pointer;
                        border-bottom: 2px solid transparent;
                        transition: all 0.2s;
                    }
                    .tab.active {
                        border-bottom-color: var(--vscode-button-background);
                        color: var(--vscode-button-background);
                    }
                    .tab:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }
                    .tab-content {
                        display: none;
                    }
                    .tab-content.active {
                        display: block;
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
                        min-height: 120px;
                        resize: vertical;
                    }
                    .form-group input[type="checkbox"] {
                        width: auto;
                        margin-right: 8px;
                    }
                    .checkbox-group {
                        display: flex;
                        align-items: center;
                        margin-bottom: 10px;
                    }
                    .duration-controls {
                        display: flex;
                        align-items: center;
                        gap: 15px;
                    }
                    .duration-slider {
                        flex: 1;
                        height: 6px;
                        background-color: var(--vscode-progressBar-background);
                        border-radius: 3px;
                        cursor: pointer;
                        position: relative;
                    }
                    .duration-fill {
                        height: 100%;
                        background-color: var(--vscode-button-background);
                        border-radius: 3px;
                        transition: width 0.1s;
                    }
                    .duration-value {
                        min-width: 60px;
                        text-align: center;
                        font-weight: 500;
                    }
                    .style-override {
                        background-color: var(--vscode-panel-background);
                        padding: 15px;
                        border-radius: 6px;
                        margin-bottom: 20px;
                        border-left: 4px solid var(--vscode-button-background);
                    }
                    .style-override h3 {
                        margin: 0 0 10px 0;
                        color: var(--vscode-foreground);
                        font-size: 14px;
                    }
                    .inherited-style {
                        background-color: var(--vscode-panel-background);
                        padding: 15px;
                        border-radius: 6px;
                        margin-bottom: 20px;
                        border-left: 4px solid var(--vscode-descriptionForeground);
                    }
                    .inherited-style h3 {
                        margin: 0 0 10px 0;
                        color: var(--vscode-foreground);
                        font-size: 14px;
                    }
                    .style-info {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 10px;
                    }
                    .preview-section {
                        background-color: var(--vscode-panel-background);
                        padding: 20px;
                        border-radius: 6px;
                        margin-bottom: 20px;
                    }
                    .preview-section h3 {
                        margin: 0 0 15px 0;
                        color: var(--vscode-foreground);
                    }
                    .video-preview {
                        width: 100%;
                        max-width: 500px;
                        border-radius: 4px;
                        background-color: #000;
                    }
                    .preview-placeholder {
                        text-align: center;
                        color: var(--vscode-descriptionForeground);
                        font-style: italic;
                        padding: 40px;
                        border: 2px dashed var(--vscode-panel-border);
                        border-radius: 4px;
                    }
                    .assets-section {
                        background-color: var(--vscode-panel-background);
                        padding: 15px;
                        border-radius: 6px;
                        margin-bottom: 20px;
                    }
                    .assets-section h3 {
                        margin: 0 0 10px 0;
                        color: var(--vscode-foreground);
                        font-size: 14px;
                    }
                    .asset-list {
                        list-style: none;
                        padding: 0;
                        margin: 0;
                    }
                    .asset-item {
                        padding: 8px 12px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        margin-bottom: 5px;
                        background-color: var(--vscode-list-background);
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    .asset-name {
                        font-weight: 500;
                    }
                    .asset-type {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                    }
                    .button-group {
                        display: flex;
                        gap: 10px;
                        margin-top: 30px;
                        padding-top: 20px;
                        border-top: 1px solid var(--vscode-panel-border);
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
                    .btn-success {
                        background-color: #28a745;
                        color: white;
                    }
                    .btn-success:hover {
                        background-color: #218838;
                    }
                    .btn:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }
                    .grid-3 {
                        display: grid;
                        grid-template-columns: 1fr 1fr 1fr;
                        gap: 15px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>
                        <span class="segment-number" id="segmentNumber">Segment 1</span>
                        <span class="status-badge" id="statusBadge">Pending</span>
                    </h1>
                    <div class="style-info" id="styleInfo">
                        Inheriting story style: <strong id="inheritedStyle">Naturalistic</strong>
                    </div>
                </div>

                <div class="tabs">
                    <div class="tab active" data-tab="content">Content</div>
                    <div class="tab" data-tab="visual">Visual</div>
                    <div class="tab" data-tab="preview">Preview</div>
                    <div class="tab" data-tab="assets">Assets</div>
                </div>

                <div class="tab-content active" id="content">
                    <div class="form-group">
                        <label for="text">Text/Narration</label>
                        <textarea id="text" placeholder="Enter the narration or text for this segment"></textarea>
                    </div>

                    <div class="form-group">
                        <label for="duration">Duration</label>
                        <div class="duration-controls">
                            <input type="range" id="duration" min="2" max="12" value="4" step="1">
                            <span class="duration-value" id="durationValue">4s</span>
                        </div>
                    </div>
                </div>

                <div class="tab-content" id="visual">
                    <div class="form-group">
                        <label for="visualPrompt">Visual Prompt</label>
                        <textarea id="visualPrompt" placeholder="Describe the visual content for this segment"></textarea>
                    </div>

                    <div class="grid-3">
                        <div class="form-group">
                            <label for="cameraWork">Camera Work</label>
                            <select id="cameraWork">
                                <option value="">Select camera work...</option>
                                <option value="wide-shot">Wide Shot</option>
                                <option value="medium-shot">Medium Shot</option>
                                <option value="close-up">Close-up</option>
                                <option value="extreme-close-up">Extreme Close-up</option>
                                <option value="pan-left">Pan Left</option>
                                <option value="pan-right">Pan Right</option>
                                <option value="tilt-up">Tilt Up</option>
                                <option value="tilt-down">Tilt Down</option>
                                <option value="zoom-in">Zoom In</option>
                                <option value="zoom-out">Zoom Out</option>
                                <option value="dolly-in">Dolly In</option>
                                <option value="dolly-out">Dolly Out</option>
                                <option value="tracking-shot">Tracking Shot</option>
                                <option value="handheld">Handheld</option>
                                <option value="aerial">Aerial</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="lighting">Lighting</label>
                            <select id="lighting">
                                <option value="">Select lighting...</option>
                                <option value="natural">Natural</option>
                                <option value="soft">Soft</option>
                                <option value="dramatic">Dramatic</option>
                                <option value="harsh">Harsh</option>
                                <option value="warm">Warm</option>
                                <option value="cool">Cool</option>
                                <option value="golden-hour">Golden Hour</option>
                                <option value="blue-hour">Blue Hour</option>
                                <option value="studio">Studio</option>
                                <option value="low-key">Low Key</option>
                                <option value="high-key">High Key</option>
                                <option value="rim-lighting">Rim Lighting</option>
                                <option value="backlighting">Backlighting</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="mood">Mood/Tone</label>
                            <select id="mood">
                                <option value="">Select mood...</option>
                                <option value="happy">Happy</option>
                                <option value="sad">Sad</option>
                                <option value="mysterious">Mysterious</option>
                                <option value="dramatic">Dramatic</option>
                                <option value="peaceful">Peaceful</option>
                                <option value="tense">Tense</option>
                                <option value="romantic">Romantic</option>
                                <option value="melancholic">Melancholic</option>
                                <option value="energetic">Energetic</option>
                                <option value="contemplative">Contemplative</option>
                                <option value="nostalgic">Nostalgic</option>
                                <option value="hopeful">Hopeful</option>
                                <option value="ominous">Ominous</option>
                            </select>
                        </div>
                    </div>

                    <div class="inherited-style">
                        <h3>Inherited Story Style</h3>
                        <div class="style-info">
                            This segment inherits the visual style from the story configuration.
                        </div>
                        <div id="inheritedStyleDetails">
                            <strong>Style:</strong> <span id="storyStyle">Naturalistic</span><br>
                            <strong>Model:</strong> <span id="storyModel">Sora</span><br>
                            <strong>Quality:</strong> <span id="storyQuality">Medium</span>
                        </div>
                    </div>

                    <div class="style-override">
                        <h3>Style Override (Optional)</h3>
                        <div class="checkbox-group">
                            <input type="checkbox" id="overrideStyle">
                            <label for="overrideStyle">Override story style for this segment only</label>
                        </div>
                        <div id="overrideControls" style="display: none;">
                            <div class="form-group">
                                <label for="customStyle">Custom Style Description</label>
                                <textarea id="customStyle" placeholder="Enter custom visual style for this segment"></textarea>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="tab-content" id="preview">
                    <div class="preview-section">
                        <h3>Video Preview</h3>
                        <div id="videoPreview">
                            <div class="preview-placeholder">
                                No video generated yet
                            </div>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="previewNotes">Preview Notes</label>
                        <textarea id="previewNotes" placeholder="Add notes about the visual representation"></textarea>
                    </div>
                </div>

                <div class="tab-content" id="assets">
                    <div class="assets-section">
                        <h3>Used Assets</h3>
                        <ul class="asset-list" id="assetList">
                            <li class="asset-item">
                                <div>
                                    <div class="asset-name">No assets used</div>
                                    <div class="asset-type">This segment doesn't reference any specific assets</div>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>

                <div class="button-group">
                    <button class="btn btn-success" id="generateBtn" disabled>Generate Video</button>
                    <button class="btn btn-primary" id="saveBtn">Save Changes</button>
                    <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    // Tab switching
                    document.querySelectorAll('.tab').forEach(tab => {
                        tab.addEventListener('click', () => {
                            const tabId = tab.dataset.tab;
                            
                            // Update tab appearance
                            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                            tab.classList.add('active');
                            
                            // Update content
                            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                            document.getElementById(tabId).classList.add('active');
                        });
                    });

                    // Duration slider
                    const durationSlider = document.getElementById('duration');
                    const durationValue = document.getElementById('durationValue');

                    durationSlider.addEventListener('input', (e) => {
                        durationValue.textContent = \`\${e.target.value}s\`;
                    });

                    // Style override toggle
                    const overrideStyle = document.getElementById('overrideStyle');
                    const overrideControls = document.getElementById('overrideControls');

                    overrideStyle.addEventListener('change', () => {
                        overrideControls.style.display = overrideStyle.checked ? 'block' : 'none';
                    });

                    // Load segment data
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'loadSegment':
                                loadSegmentData(message.segment, message.story);
                                break;
                        }
                    });

                    function loadSegmentData(segment, story) {
                        // Update header
                        document.getElementById('segmentNumber').textContent = \`Segment \${segment.id || '1'}\`;
                        document.getElementById('statusBadge').textContent = segment.status || 'pending';
                        document.getElementById('statusBadge').className = \`status-badge status-\${segment.status || 'pending'}\`;
                        
                        // Load content
                        document.getElementById('text').value = segment.text || '';
                        document.getElementById('duration').value = segment.duration || 4;
                        document.getElementById('durationValue').textContent = \`\${segment.duration || 4}s\`;
                        
                        // Load visual properties
                        document.getElementById('visualPrompt').value = segment.visualPrompt || '';
                        document.getElementById('cameraWork').value = segment.cameraWork || '';
                        document.getElementById('lighting').value = segment.lighting || '';
                        document.getElementById('mood').value = segment.mood || '';
                        
                        // Load story style info
                        if (story && story.generationConfig) {
                            const config = story.generationConfig;
                            document.getElementById('inheritedStyle').textContent = config.visualStyle || 'Naturalistic';
                            document.getElementById('storyStyle').textContent = config.visualStyle || 'Naturalistic';
                            document.getElementById('storyModel').textContent = config.model || 'Sora';
                            document.getElementById('storyQuality').textContent = config.quality || 'Medium';
                        }
                        
                        // Load custom style override
                        if (segment.customStyle) {
                            document.getElementById('overrideStyle').checked = true;
                            document.getElementById('customStyle').value = segment.customStyle;
                            overrideControls.style.display = 'block';
                        }
                        
                        // Load preview
                        if (segment.videoPath) {
                            const videoPreview = document.getElementById('videoPreview');
                            videoPreview.innerHTML = \`
                                <video class="video-preview" controls>
                                    <source src="\${segment.videoPath}" type="video/mp4">
                                    Your browser does not support the video element.
                                </video>
                            \`;
                        }
                        
                        // Load assets
                        if (segment.usedAssets && segment.usedAssets.length > 0) {
                            const assetList = document.getElementById('assetList');
                            assetList.innerHTML = segment.usedAssets.map(asset => \`
                                <li class="asset-item">
                                    <div>
                                        <div class="asset-name">\${asset.name}</div>
                                        <div class="asset-type">\${asset.type}</div>
                                    </div>
                                </li>
                            \`).join('');
                        }
                        
                        // Update generate button
                        const generateBtn = document.getElementById('generateBtn');
                        if (segment.status === 'pending' || segment.status === 'failed') {
                            generateBtn.disabled = false;
                            generateBtn.textContent = segment.status === 'failed' ? 'Retry Generation' : 'Generate Video';
                        } else if (segment.status === 'generating') {
                            generateBtn.disabled = true;
                            generateBtn.textContent = 'Generating...';
                        } else if (segment.status === 'completed') {
                            generateBtn.disabled = false;
                            generateBtn.textContent = 'Regenerate';
                        }
                    }

                    // Save segment
                    document.getElementById('saveBtn').addEventListener('click', () => {
                        const segmentData = {
                            text: document.getElementById('text').value,
                            visualPrompt: document.getElementById('visualPrompt').value,
                            duration: parseInt(document.getElementById('duration').value),
                            cameraWork: document.getElementById('cameraWork').value,
                            lighting: document.getElementById('lighting').value,
                            mood: document.getElementById('mood').value,
                            customStyle: document.getElementById('overrideStyle').checked ? 
                                document.getElementById('customStyle').value : undefined
                        };

                        vscode.postMessage({
                            type: 'saveSegment',
                            segment: segmentData
                        });
                    });

                    // Generate video
                    document.getElementById('generateBtn').addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'generateVideo'
                        });
                    });

                    // Cancel
                    document.getElementById('cancelBtn').addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'cancel'
                        });
                    });

                    // Request segment data on load
                    vscode.postMessage({
                        type: 'requestSegmentData'
                    });
                </script>
            </body>
            </html>
        `;
    }
}





















































