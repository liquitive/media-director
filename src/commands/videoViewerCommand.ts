/**
 * Video Viewer Command
 * Opens a video in a webview panel with segment navigation
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StoryService } from '../services/storyService';
import { logger } from '../utils/logger';

export class VideoViewerCommand {
    private static currentPanel: vscode.WebviewPanel | undefined;
    private static currentStoryId: string | undefined;
    private static currentSegmentIndex: number | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private storyService: StoryService
    ) {}

    public static register(context: vscode.ExtensionContext, storyService: StoryService): vscode.Disposable[] {
        const command = new VideoViewerCommand(context, storyService);
        
        return [
            vscode.commands.registerCommand('sora.openVideoViewer', 
                (storyId: string, segmentIndex: number, videoPath: string) => 
                    command.openVideoViewer(storyId, segmentIndex, videoPath)
            )
        ];
    }

    public async openVideoViewer(storyId: string, segmentIndex: number, videoPath: string): Promise<void> {
        // Close existing panel if any
        if (VideoViewerCommand.currentPanel) {
            VideoViewerCommand.currentPanel.dispose();
        }

        // Store current context
        VideoViewerCommand.currentStoryId = storyId;
        VideoViewerCommand.currentSegmentIndex = segmentIndex;

        // Get story to access all segments
        const story = this.storyService.getStory(storyId);
        if (!story) {
            vscode.window.showErrorMessage(`Story ${storyId} not found`);
            return;
        }

        const segment = story.directorScript?.[segmentIndex];
        if (!segment) {
            vscode.window.showErrorMessage(`Segment ${segmentIndex} not found`);
            return;
        }

        // Create panel
        const panel = vscode.window.createWebviewPanel(
            'soraVideoViewer',
            `Video Viewer - Segment ${segmentIndex + 1}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    this.context.extensionUri,
                    vscode.Uri.file(path.dirname(videoPath))
                ],
                retainContextWhenHidden: true
            }
        );

        VideoViewerCommand.currentPanel = panel;

        // Set HTML content
        panel.webview.html = this.getHtmlForWebview(panel.webview, videoPath, story, segmentIndex);

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'navigateSegment':
                        await this.navigateToSegment(message.direction);
                        break;
                    case 'ready':
                        // Webview is ready, send initial data
                        this.sendVideoData(panel.webview, storyId, segmentIndex);
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        // Handle panel disposal
        panel.onDidDispose(() => {
            VideoViewerCommand.currentPanel = undefined;
            VideoViewerCommand.currentStoryId = undefined;
            VideoViewerCommand.currentSegmentIndex = undefined;
        });
    }

    private async navigateToSegment(direction: 'previous' | 'next'): Promise<void> {
        if (!VideoViewerCommand.currentStoryId || VideoViewerCommand.currentSegmentIndex === undefined) {
            return;
        }

        const story = this.storyService.getStory(VideoViewerCommand.currentStoryId);
        if (!story || !story.directorScript) {
            return;
        }

        const newIndex = direction === 'previous' 
            ? VideoViewerCommand.currentSegmentIndex - 1
            : VideoViewerCommand.currentSegmentIndex + 1;

        // Check if new index is valid and has video
        if (newIndex < 0 || newIndex >= story.directorScript.length) {
            return;
        }

        const newSegment = story.directorScript[newIndex];
        if (!newSegment.videoPath || !fs.existsSync(newSegment.videoPath)) {
            vscode.window.showWarningMessage(`Segment ${newIndex + 1} does not have a video yet`);
            return;
        }

        // Navigate to new segment
        await this.openVideoViewer(VideoViewerCommand.currentStoryId, newIndex, newSegment.videoPath);
    }

    private sendVideoData(webview: vscode.Webview, storyId: string, segmentIndex: number): void {
        const story = this.storyService.getStory(storyId);
        if (!story || !story.directorScript) {
            return;
        }

        const segment = story.directorScript[segmentIndex];
        const videoPath = segment.videoPath;

        if (!videoPath || !fs.existsSync(videoPath)) {
            return;
        }

        // Check previous/next availability
        const prevSegment = segmentIndex > 0 ? story.directorScript[segmentIndex - 1] : null;
        const hasPrevious = prevSegment?.videoPath ? fs.existsSync(prevSegment.videoPath) : false;

        const nextSegment = segmentIndex < story.directorScript.length - 1 ? story.directorScript[segmentIndex + 1] : null;
        const hasNext = nextSegment?.videoPath ? fs.existsSync(nextSegment.videoPath) : false;

        // Convert video path to webview URI
        const videoUri = webview.asWebviewUri(vscode.Uri.file(videoPath));

        webview.postMessage({
            type: 'loadVideo',
            data: {
                videoSrc: videoUri.toString(),
                segmentIndex: segmentIndex,
                segmentText: segment.text,
                segmentDuration: segment.duration,
                hasPrevious,
                hasNext,
                totalSegments: story.directorScript.length
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview, videoPath: string, story: any, segmentIndex: number): string {
        const segment = story.directorScript[segmentIndex];
        const videoUri = webview.asWebviewUri(vscode.Uri.file(videoPath));

        // Check navigation availability
        const hasPrevious = segmentIndex > 0 && 
            story.directorScript[segmentIndex - 1]?.videoPath &&
            fs.existsSync(story.directorScript[segmentIndex - 1].videoPath);

        const hasNext = segmentIndex < story.directorScript.length - 1 &&
            story.directorScript[segmentIndex + 1]?.videoPath &&
            fs.existsSync(story.directorScript[segmentIndex + 1].videoPath);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>Video Viewer - Segment ${segmentIndex + 1}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            height: 100vh;
            box-sizing: border-box;
        }

        .video-container {
            width: 95%;
            height: calc(95vh - 120px);
            background-color: #000;
            border-radius: 8px;
            overflow: hidden;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        video {
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: auto;
        }

        .segment-info {
            width: 95%;
            padding: 15px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 15px;
            text-align: center;
        }

        .segment-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }

        .segment-text {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .navigation-bar {
            width: 95%;
            display: flex;
            gap: 15px;
            justify-content: center;
            align-items: center;
        }

        .nav-button {
            padding: 10px 20px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-family: var(--vscode-font-family);
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background-color 0.2s;
        }

        .nav-button:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }

        .nav-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .nav-button.hidden {
            visibility: hidden;
        }

        .codicon {
            font-size: 16px;
        }

        /* VS Code Codicons via inline SVG */
        .icon-chevron-left::before {
            content: "◀";
        }

        .icon-chevron-right::before {
            content: "▶";
        }
    </style>
</head>
<body>
    <div class="segment-info">
        <div class="segment-title">Segment ${segmentIndex + 1} of ${story.directorScript.length}</div>
        <div class="segment-text">${segment.text || 'No description'}</div>
    </div>

    <div class="video-container">
        <video id="videoPlayer" controls autoplay>
            <source src="${videoUri}" type="video/mp4">
            Your browser does not support the video tag.
        </video>
    </div>

    <div class="navigation-bar">
        <button id="prevButton" class="nav-button ${!hasPrevious ? 'hidden' : ''}" ${!hasPrevious ? 'disabled' : ''}>
            <span class="icon-chevron-left"></span>
            Previous Segment
        </button>
        <button id="nextButton" class="nav-button ${!hasNext ? 'hidden' : ''}" ${!hasNext ? 'disabled' : ''}>
            Next Segment
            <span class="icon-chevron-right"></span>
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const videoPlayer = document.getElementById('videoPlayer');
        const prevButton = document.getElementById('prevButton');
        const nextButton = document.getElementById('nextButton');

        // Navigation handlers
        prevButton.addEventListener('click', () => {
            vscode.postMessage({
                type: 'navigateSegment',
                direction: 'previous'
            });
        });

        nextButton.addEventListener('click', () => {
            vscode.postMessage({
                type: 'navigateSegment',
                direction: 'next'
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' && !prevButton.disabled) {
                e.preventDefault();
                prevButton.click();
            } else if (e.key === 'ArrowRight' && !nextButton.disabled) {
                e.preventDefault();
                nextButton.click();
            } else if (e.key === ' ') {
                e.preventDefault();
                if (videoPlayer.paused) {
                    videoPlayer.play();
                } else {
                    videoPlayer.pause();
                }
            }
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'loadVideo':
                    // Update video and navigation
                    const data = message.data;
                    videoPlayer.src = data.videoSrc;
                    videoPlayer.load();
                    videoPlayer.play();
                    
                    // Update buttons
                    prevButton.disabled = !data.hasPrevious;
                    prevButton.classList.toggle('hidden', !data.hasPrevious);
                    nextButton.disabled = !data.hasNext;
                    nextButton.classList.toggle('hidden', !data.hasNext);
                    break;
            }
        });

        // Notify extension that webview is ready
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }
}

