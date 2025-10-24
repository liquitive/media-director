import * as vscode from 'vscode';
import { AssetService } from '../services/assetService';
import { logger } from '../utils/logger';

export class AssetEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'sora.assetEditor';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly assetService: AssetService
    ) {}

    public static register(context: vscode.ExtensionContext, assetService: AssetService): vscode.Disposable {
        const provider = new AssetEditorProvider(context, assetService);
        return vscode.window.registerCustomEditorProvider(
            AssetEditorProvider.viewType,
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
        // Extract asset ID from document URI
        const assetId = this.extractAssetIdFromUri(document.uri);
        if (!assetId) {
            vscode.window.showErrorMessage('Invalid asset document');
            return;
        }

        // Get asset data
        const asset = this.assetService.getAsset(assetId);
        if (!asset) {
            vscode.window.showErrorMessage(`Asset ${assetId} not found`);
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
                    case 'requestAssetData':
                        webviewPanel.webview.postMessage({
                            type: 'loadAsset',
                            asset: asset
                        });
                        break;

                    case 'saveAsset':
                        this.saveAsset(assetId, message.asset, document);
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
                // Document was changed externally, reload asset data
                const updatedAsset = this.assetService.getAsset(assetId);
                if (updatedAsset) {
                    webviewPanel.webview.postMessage({
                        type: 'loadAsset',
                        asset: updatedAsset
                    });
                }
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private extractAssetIdFromUri(uri: vscode.Uri): string | undefined {
        // URI format: file:///path/to/.sora/assets/asset_{id}.json
        const match = uri.path.match(/asset_([^\.]+)\.json$/);
        return match ? match[1] : undefined;
    }

    private async saveAsset(assetId: string, assetData: any, document: vscode.TextDocument): Promise<void> {
        try {
            // Update asset with new data
            await this.assetService.updateAsset(assetId, assetData);

            // Update the document content
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                document.uri,
                new vscode.Range(0, 0, document.lineCount, 0),
                JSON.stringify(assetData, null, 2)
            );
            
            await vscode.workspace.applyEdit(edit);
            await document.save();

            vscode.window.showInformationMessage('Asset saved successfully');
            logger.info(`Asset ${assetId} updated`);

        } catch (error) {
            logger.error('Failed to save asset:', error);
            vscode.window.showErrorMessage(`Failed to save asset: ${error}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Asset Editor</title>
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
                        min-height: 100px;
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
                    <h1 id="assetName">Asset Editor</h1>
                </div>

                <div class="form-group">
                    <label for="name">Asset Name</label>
                    <input type="text" id="name" placeholder="Enter asset name">
                </div>

                <div class="form-group">
                    <label for="type">Asset Type</label>
                    <select id="type">
                        <option value="character">Character</option>
                        <option value="location">Location</option>
                        <option value="item">Item</option>
                        <option value="vehicle">Vehicle</option>
                        <option value="animal">Animal</option>
                        <option value="other">Other</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="description">Description</label>
                    <textarea id="description" placeholder="Describe this asset in detail"></textarea>
                </div>

                <div class="button-group">
                    <button class="btn btn-primary" id="saveBtn">Save Changes</button>
                    <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    // Load asset data
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'loadAsset':
                                loadAssetData(message.asset);
                                break;
                        }
                    });

                    function loadAssetData(asset) {
                        document.getElementById('assetName').textContent = asset.name || 'Unnamed Asset';
                        document.getElementById('name').value = asset.name || '';
                        document.getElementById('type').value = asset.type || 'other';
                        document.getElementById('description').value = asset.description || '';
                    }

                    // Save asset
                    document.getElementById('saveBtn').addEventListener('click', () => {
                        const assetData = {
                            name: document.getElementById('name').value,
                            type: document.getElementById('type').value,
                            description: document.getElementById('description').value
                        };

                        vscode.postMessage({
                            type: 'saveAsset',
                            asset: assetData
                        });
                    });

                    // Cancel
                    document.getElementById('cancelBtn').addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'cancel'
                        });
                    });

                    // Request asset data on load
                    vscode.postMessage({
                        type: 'requestAssetData'
                    });
                </script>
            </body>
            </html>
        `;
    }
}





















































