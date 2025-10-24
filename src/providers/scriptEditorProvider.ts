/**
 * Script Editor Provider
 * Custom editor for Sora script JSON files with side-by-side JSON and rendered views
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ScriptEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'sora.scriptEditor';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Set up the webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webviews')
            ]
        };

        // Set initial HTML
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document);

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'updateScript':
                        this.updateScript(document, message.script);
                        return;
                    case 'getScript':
                        this.sendScriptToWebview(webviewPanel.webview, document);
                        return;
                }
            },
            undefined,
            this.context.subscriptions
        );

        // Handle document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                this.sendScriptToWebview(webviewPanel.webview, document);
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private getHtmlForWebview(webview: vscode.Webview, document: vscode.TextDocument): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webviews', 'scriptRenderer.html')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sora Script Editor</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .container {
            display: flex;
            height: 100vh;
        }
        .json-panel {
            flex: 1;
            border-right: 1px solid var(--vscode-panel-border);
            padding: 10px;
        }
        .render-panel {
            flex: 1;
            padding: 10px;
            overflow-y: auto;
        }
        .json-editor {
            width: 100%;
            height: calc(100vh - 40px);
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            padding: 10px;
            resize: none;
            outline: none;
        }
        .script-content {
            max-width: 100%;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="json-panel">
            <h3>Script JSON</h3>
            <textarea id="jsonEditor" class="json-editor" placeholder="Loading script..."></textarea>
        </div>
        <div class="render-panel">
            <h3>Rendered View</h3>
            <div id="scriptContent" class="script-content">
                <p>Loading script visualization...</p>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Load initial script
        vscode.postMessage({ type: 'getScript' });
        
        // Handle JSON editor changes
        const jsonEditor = document.getElementById('jsonEditor');
        jsonEditor.addEventListener('input', (e) => {
            try {
                const script = JSON.parse(e.target.value);
                vscode.postMessage({ type: 'updateScript', script: script });
                renderScript(script);
            } catch (error) {
                // Invalid JSON, don't update
            }
        });
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'scriptData':
                    jsonEditor.value = JSON.stringify(message.script, null, 2);
                    renderScript(message.script);
                    break;
            }
        });
        
        function renderScript(script) {
            const container = document.getElementById('scriptContent');
            
            if (!script || !script.segments || !Array.isArray(script.segments)) {
                container.innerHTML = '<p>No script data available</p>';
                return;
            }
            
            let html = \`
                <div class="script-header">
                    <h2>\${script.storyName || 'Untitled Story'}</h2>
                    <p>Story ID: \${script.storyId || 'Unknown'}</p>
                    <p>Created: \${script.createdAt ? new Date(script.createdAt).toLocaleString() : 'Unknown'}</p>
                </div>
                <div class="script-timeline">
            \`;
            
            script.segments.forEach((segment, index) => {
                const statusClass = segment.status || 'pending';
                const duration = segment.duration || 4;
                
                html += \`
                    <div class="segment-card \${statusClass}">
                        <div class="segment-header">
                            <span class="segment-number">Segment \${index + 1}</span>
                            <span class="segment-duration">\${duration}s</span>
                            <span class="segment-status \${statusClass}">\${statusClass}</span>
                        </div>
                        <div class="segment-content">
                            <div class="segment-text">
                                <strong>Text:</strong> \${segment.text || 'No text'}
                            </div>
                            <div class="segment-prompt">
                                <strong>Visual Prompt:</strong> \${segment.visualPrompt || 'No prompt'}
                            </div>
                            \${segment.cameraWork ? \`<div class="segment-camera"><strong>Camera:</strong> \${segment.cameraWork}</div>\` : ''}
                            \${segment.lighting ? \`<div class="segment-lighting"><strong>Lighting:</strong> \${segment.lighting}</div>\` : ''}
                            \${segment.mood ? \`<div class="segment-mood"><strong>Mood:</strong> \${segment.mood}</div>\` : ''}
                        </div>
                    </div>
                \`;
            });
            
            html += '</div>';
            container.innerHTML = html;
        }
    </script>
</body>
</html>`;
    }

    private updateScript(document: vscode.TextDocument, script: any): void {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(script, null, 2)
        );
        
        vscode.workspace.applyEdit(edit);
    }

    private sendScriptToWebview(webview: vscode.Webview, document: vscode.TextDocument): void {
        try {
            const script = JSON.parse(document.getText());
            webview.postMessage({
                type: 'scriptData',
                script: script
            });
        } catch (error) {
            // Invalid JSON, don't send
        }
    }
}









