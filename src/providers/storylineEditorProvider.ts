/**
 * Storyline Editor Provider
 * Manages the professional timeline-based video editing interface
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Story, Segment } from '../models/story';
import { StoryService } from '../services/storyService';
import { OpenAIService } from '../services/openaiService';
import { VideoService } from '../services/videoService';
import { AudioAnalysisService } from '../services/audioAnalysisService';
import { ProgressManager } from '../services/progressManager';
import { ExecutionService } from '../services/executionService';
import { 
    StorylineEditorState, 
    TimelineState, 
    GenerationState,
    GeneratedVideoSegment,
    PlaybackCommand,
    SegmentOperation,
    VideoPlayerState,
    ZOOM_PRESETS,
    TIMELINE_CONSTANTS
} from '../types/storyline';
import { logger } from '../utils/logger';

export class StorylineEditorProvider {
    public static readonly viewType = 'sora.storylineEditor';
    
    // NOTE: State is shared between panel and sidebar view
    // If both are used simultaneously, this could cause conflicts
    // Current architecture prioritizes panel editor over sidebar view
    private _state: StorylineEditorState | null = null;
    private _disposables: vscode.Disposable[] = [];
    private progressManager: ProgressManager;
    private _activePanel?: vscode.WebviewPanel;
    private _activePanelStoryId?: string;
    private _panelDisposables: vscode.Disposable[] = [];
    private _progressSubscription?: any;
    
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext,
        private readonly storyService: StoryService,
        private readonly openaiService: OpenAIService,
        private readonly videoService: VideoService,
        private readonly audioAnalysisService: AudioAnalysisService,
        private readonly executionService: ExecutionService
    ) {
        this.progressManager = ProgressManager.getInstance();
    }
    
    /**
     * Open storyline editor in a panel (main editor area)
     */
    public async openStorylineEditor(storyId: string): Promise<void> {
        const story = this.storyService.getStory(storyId);
        if (!story) {
            throw new Error(`Story not found: ${storyId}`);
        }
        
        // Close existing panel if one is already open
        if (this._activePanel) {
            const existingStoryId = this._activePanelStoryId;
            logger.info(`Closing existing storyline editor for story: ${existingStoryId}`);
            this._activePanel.dispose(); // Triggers onDidDispose which cleans up
        }
        
        // Create and show new panel
        const panel = vscode.window.createWebviewPanel(
            'soraStorylineEditor',
            `Storyline: ${story.name}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(this._extensionUri.fsPath, 'out'))]
            }
        );
        
        // Track active panel
        this._activePanel = panel;
        this._activePanelStoryId = storyId;
        
        // Reset panel-specific disposables
        this._panelDisposables = [];
        
        // Set HTML content
        panel.webview.html = this.getHtmlContent(panel.webview);
        
        // Handle messages from THIS panel's webview
        panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message, panel.webview),
            null,
            this._panelDisposables  // Panel-specific disposables, not shared
        );
        
        // Handle panel disposal
        // Store panel reference to avoid race condition where new panel is opened before disposal completes
        const panelToDispose = panel;
        panel.onDidDispose(() => {
            // Only clean up if THIS panel is still the active one
            if (this._activePanel === panelToDispose) {
                this.cleanupPanelResources();
                logger.info(`Storyline editor panel disposed for story: ${storyId}`);
            } else {
                logger.info(`Storyline editor panel disposed for story: ${storyId} (already replaced by new panel)`);
            }
        }, null, this._disposables);  // Dispose handler itself goes in shared disposables
        
        // Load story data
        await this.loadStoryForPanel(storyId, panel.webview);
        
        // Subscribe to progress updates for THIS story
        this.subscribeToProgress(storyId);
        
        logger.info(`Storyline editor panel opened for story: ${storyId}`);
    }
    
    /**
     * Load story data and send to panel
     */
    private async loadStoryForPanel(storyId: string, webview: vscode.Webview): Promise<void> {
        try {
            const story = this.storyService.getStory(storyId);
            if (!story) {
                throw new Error(`Story not found: ${storyId}`);
            }
            
            // Get story directory
            const storyDir = this.storyService.getStoryDirectory(storyId);
            
            // Load audio analysis if available
            const audioAnalysisPath = path.join(storyDir, 'audio_analysis.json');
            let audioAnalysis = null;
            if (fs.existsSync(audioAnalysisPath)) {
                audioAnalysis = JSON.parse(fs.readFileSync(audioAnalysisPath, 'utf-8'));
                
                // Prepare waveform peaks from energy data
                if (audioAnalysis) {
                    audioAnalysis.waveform = {
                        peaks: this.prepareWaveformPeaks(audioAnalysis)
                    };
                }
            }
            
            // Note: No separate transcription file needed - script.json segments contain all text/timing data
            // Each segment has: .text, .startTime, .duration, .visualPrompt, etc.
            
            // Check for compiled video
            const completedDir = path.join(storyDir, 'completed');
            const compiledVideoPath = path.join(completedDir, `${story.name}.mp4`);
            let compiledVideoUri = null;

            if (fs.existsSync(compiledVideoPath)) {
                compiledVideoUri = webview.asWebviewUri(
                    vscode.Uri.file(compiledVideoPath)
                ).toString();
            }

            // Load segment video URIs
            const segmentsDir = path.join(storyDir, 'segments');
            const segmentVideoUris = new Map<string, string>();

            for (let i = 0; i < story.directorScript.length; i++) {
                const segmentPath = path.join(segmentsDir, `segment_${i + 1}.mp4`);
                if (fs.existsSync(segmentPath)) {
                    const uri = webview.asWebviewUri(
                        vscode.Uri.file(segmentPath)
                    ).toString();
                    segmentVideoUris.set(story.directorScript[i].id, uri);
                }
            }

            // Convert audio path to webview URI if needed
            let audioUri = null;
            if (story.inputType === 'audio' && story.inputSource) {
                audioUri = webview.asWebviewUri(
                    vscode.Uri.file(story.inputSource)
                ).toString();
            }

            // Build state
            const state: StorylineEditorState = {
                story,
                audioPath: audioUri,
                audioAnalysis: audioAnalysis,
                transcription: { words: [] }, // Empty transcript - segments contain the text
                compiledVideoUri: compiledVideoUri,
                segmentVideoUris: segmentVideoUris,
                segments: story.directorScript || [],
                videoSegments: [],
                currentTime: 0,
                currentFrame: 0,
                currentSegmentId: null,
                isPlaying: false,
                playbackRate: 1.0,
                timeline: {
                    zoomLevel: ZOOM_PRESETS.COMFORTABLE,
                    scrollPosition: 0,
                    visibleRange: { start: 0, end: 60 },
                    selectedSegments: [],
                    playheadPosition: 0,
                    snapToGrid: true,
                    snapToBeats: false
                },
                generation: {
                    queue: [],
                    activeSegment: null,
                    progress: new Map()
                }
            };
            
            // Store state for this panel
            this._state = {
                story,
                audioPath: state.audioPath,
                audioAnalysis: state.audioAnalysis,
                transcription: state.transcription,
                compiledVideoUri: state.compiledVideoUri,
                segmentVideoUris: state.segmentVideoUris,
                segments: state.segments,
                videoSegments: state.videoSegments,
                currentTime: state.currentTime,
                currentFrame: state.currentFrame,
                currentSegmentId: state.currentSegmentId,
                isPlaying: state.isPlaying,
                playbackRate: state.playbackRate,
                timeline: state.timeline,
                generation: state.generation
            };
            
            // Restore saved timeline state
            await this.restoreTimelineState(storyId);
            
            // Send initial state to webview
            logger.info(`Story data loaded, segments: ${state.segments.length}, sending to panel: ${storyId}`);
            logger.info(`Segments sample:`, state.segments);
            
            if (!this._state) {
                throw new Error('State not initialized after assignment');
            }
            
            webview.postMessage({
                command: 'update-state',
                state: this.serializeState(this._state)
            });

            logger.info(`Segments serializedsample:`, this._state.segments);
            
            logger.info(`State sent to panel: ${storyId}`);
        } catch (error) {
            logger.error('Failed to load story into panel:', error);
            throw error;
        }
    }
    
    
    
    /**
     * Build list of generated video segments
     */
    private async buildVideoSegmentsList(story: Story): Promise<GeneratedVideoSegment[]> {
        const storyDir = this.storyService.getStoryDirectory(story.id);
        const segmentsDir = path.join(storyDir, 'segments');
        const thumbnailsDir = path.join(storyDir, 'thumbnails');
        const framesDir = path.join(storyDir, 'frames');
        
        const videoSegments: GeneratedVideoSegment[] = [];
        let cumulativeTime = 0;
        
        for (let i = 0; i < story.directorScript.length; i++) {
            const segment = story.directorScript[i];
            const videoPath = path.join(segmentsDir, `segment_${i + 1}.mp4`);
            const thumbnailPath = path.join(thumbnailsDir, `thumb_${i + 1}.jpg`);
            const continuityFramePath = path.join(framesDir, `segment_${i + 1}_last.jpg`);
            
            const exists = fs.existsSync(videoPath);
            
            videoSegments.push({
                id: segment.id,
                videoPath: exists ? videoPath : '',
                thumbnailPath: fs.existsSync(thumbnailPath) ? thumbnailPath : '',
                continuityFramePath: fs.existsSync(continuityFramePath) ? continuityFramePath : undefined,
                status: exists ? (segment.status === 'validated' ? 'validated' : 'complete') : 'pending',
                duration: segment.duration,
                startTime: cumulativeTime,
                endTime: cumulativeTime + segment.duration
            });
            
            cumulativeTime += segment.duration;
        }
        
        return videoSegments;
    }
    
    /**
     * Get default timeline state based on story
     */
    private getDefaultTimelineState(story: Story): TimelineState {
        // Calculate total duration
        const totalDuration = story.directorScript.reduce((sum, seg) => sum + seg.duration, 0);
        
        return {
            zoomLevel: ZOOM_PRESETS.COMFORTABLE,
            scrollPosition: 0,
            visibleRange: {
                start: 0,
                end: Math.max(totalDuration, 60) // At least 60 seconds visible
            },
            selectedSegments: [],
            playheadPosition: 0,
            snapToGrid: true,
            snapToBeats: false
        };
    }
    
    /**
     * Handle messages from webview
     */
    private async handleMessage(message: any, webview?: vscode.Webview): Promise<void> {
        // Determine which webview to use for responses
        const targetWebview = webview;
        if (!targetWebview && message.command !== 'ready') {
            logger.warn('No webview available to handle message');
            return;
        }
        
        switch (message.command) {
            case 'playback':
                await this.handlePlaybackCommand(message.action, message.data);
                break;
            
            case 'segment-operation':
                await this.handleSegmentOperation(message.operation, message.data);
                break;
            
            case 'timeline-zoom':
                this.handleTimelineZoom(message.level);
                break;
            
            case 'timeline-scroll':
                this.handleTimelineScroll(message.position);
                break;
            
            case 'seek':
                this.handleSeek(message.time);
                break;
            
            case 'select-segments':
                this.handleSelectSegments(message.segmentIds);
                break;
            
            case 'generate':
                await this.handleGenerate(message.segmentIds);
                break;
            
            case 'ready':
                logger.info('Webview ready');
                // For panel webviews, we need to send state explicitly
                if (webview && this._state) {
                    webview.postMessage({
                        command: 'update-state',
                        state: this.serializeState(this._state)
                    });
                } else {
                    this.updateWebview();
                }
                break;
            
            default:
                logger.warn(`Unknown command: ${message.command}`);
        }
    }
    
    /**
     * Handle playback commands
     */
    private async handlePlaybackCommand(action: PlaybackCommand, data?: any): Promise<void> {
        if (!this._state) { return; }
        
        logger.info(`Playback command: ${action}`);
        
        switch (action) {
            case 'play':
                this._state.isPlaying = true;
                break;
            
            case 'pause':
                this._state.isPlaying = false;
                break;
            
            case 'toggle-play-pause':
                this._state.isPlaying = !this._state.isPlaying;
                break;
            
            case 'fast-forward':
                this._state.playbackRate = Math.min(8, this._state.playbackRate * 2);
                break;
            
            case 'rewind':
                this._state.playbackRate = Math.min(8, this._state.playbackRate * 2);
                // Negative playback rate for rewind
                break;
            
            case 'first-frame-of-segment':
                this.seekToSegmentBoundary('current', 'start');
                break;
            
            case 'first-frame-of-next-segment':
                this.seekToSegmentBoundary('next', 'start');
                break;
            
            case 'first-frame-of-prev-segment':
                this.seekToSegmentBoundary('previous', 'start');
                break;
            
            case 'first-frame-of-story':
                this._state.currentTime = 0;
                this._state.timeline.playheadPosition = 0;
                break;
            
            case 'last-frame-of-story':
                const totalDuration = this._state.segments.reduce((sum, seg) => sum + seg.duration, 0);
                this._state.currentTime = totalDuration;
                this._state.timeline.playheadPosition = totalDuration;
                break;
            
            case 'seek':
                if (data?.time !== undefined) {
                    this._state.currentTime = data.time;
                    this._state.timeline.playheadPosition = data.time;
                }
                break;
        }
        
        this.updateWebview();
    }
    
    /**
     * Seek to segment boundary
     */
    private seekToSegmentBoundary(which: 'current' | 'next' | 'previous', position: 'start' | 'end'): void {
        if (!this._state) { return; }
        
        const currentTime = this._state.currentTime;
        let targetSegment: GeneratedVideoSegment | null = null;
        
        // Find current segment
        const currentSegmentIndex = this._state.videoSegments.findIndex(
            seg => currentTime >= seg.startTime && currentTime < seg.endTime
        );
        
        if (which === 'current' && currentSegmentIndex >= 0) {
            targetSegment = this._state.videoSegments[currentSegmentIndex];
        } else if (which === 'next' && currentSegmentIndex < this._state.videoSegments.length - 1) {
            targetSegment = this._state.videoSegments[currentSegmentIndex + 1];
        } else if (which === 'previous' && currentSegmentIndex > 0) {
            targetSegment = this._state.videoSegments[currentSegmentIndex - 1];
        }
        
        if (targetSegment) {
            const time = position === 'start' ? targetSegment.startTime : targetSegment.endTime;
            this._state.currentTime = time;
            this._state.timeline.playheadPosition = time;
        }
    }
    
    /**
     * Handle segment operations
     */
    private async handleSegmentOperation(operation: SegmentOperation, data: any): Promise<void> {
        if (!this._state) return;
        
        logger.info(`Segment operation: ${operation}`, data);
        
        try {
            switch (operation) {
                case 'edit':
                    await this.handleSegmentEdit(data);
                    break;
                case 'split':
                    await this.handleSegmentSplit(data);
                    break;
                case 'merge':
                    await this.handleSegmentMerge(data);
                    break;
                case 'duplicate':
                    await this.handleSegmentDuplicate(data);
                    break;
                case 'remove':
                    await this.handleSegmentRemove(data);
                    break;
                default:
                    vscode.window.showWarningMessage(`Operation ${operation} not implemented yet`);
            }
        } catch (error: any) {
            logger.error(`Failed to execute segment operation ${operation}:`, error);
            vscode.window.showErrorMessage(`Failed to ${operation} segment: ${error.message}`);
        }
    }

    /**
     * Handle segment edit operation
     */
    private async handleSegmentEdit(data: { segmentId: string, newPrompt: string }): Promise<void> {
        if (!this._state) return;
        
        const story = this._state.story;
        const segment = story.directorScript.find(s => s.id === data.segmentId);
        
        if (!segment) {
            vscode.window.showWarningMessage('Segment not found');
            return;
        }
        
        // Update prompt
        segment.prompt = data.newPrompt;
        segment.status = 'pending';  // Invalidate video
        
        // Save to story
        this.storyService.updateStory(story.id, {
            directorScript: story.directorScript
        });
        
        await this.storyService.saveDirectorScript(story.id);
        
        // Reload state with proper error handling
        if (!this._activePanel || !this._state) {
            logger.error('No active panel or state available for reload after edit');
            vscode.window.showErrorMessage('Segment edited but editor is not open');
            return;
        }
        
        try {
            await this.loadStoryForPanel(this._state.story.id, this._activePanel.webview);
            vscode.window.showInformationMessage('Segment prompt updated');
        } catch (error: any) {
            logger.error('Failed to refresh after segment edit:', error);
            vscode.window.showErrorMessage('Segment edited but failed to refresh view');
        }
    }

    /**
     * Handle segment split operation
     */
    private async handleSegmentSplit(data: { segmentId: string, splitTime: number }): Promise<void> {
        const story = this._state?.story;
        if (!story) return;
        
        const segmentIndex = story.directorScript.findIndex(s => s.id === data.segmentId);
        const segment = story.directorScript[segmentIndex];
        
        if (!segment) {
            vscode.window.showWarningMessage('Segment not found');
            return;
        }
        
        // Calculate split point
        const relativeTime = data.splitTime - segment.startTime;
        const midDuration = relativeTime;
        const remainingDuration = segment.duration - midDuration;
        
        if (midDuration < 0.5 || remainingDuration < 0.5) {
            vscode.window.showWarningMessage('Segment too small to split (minimum 0.5s per part)');
            return;
        }
        
        // Split transcript at word boundary
        const { firstText, secondText } = this.splitTextAtTime(
            segment.text, 
            segment.startTime, 
            data.splitTime
        );
        
        // Create two new segments
        const segment1 = {
            ...segment,
            id: `${segment.id}_a`,
            duration: midDuration,
            text: firstText,
            status: 'pending' as const // Invalidate
        };
        
        const segment2 = {
            ...segment,
            id: `${segment.id}_b`,
            startTime: segment.startTime + midDuration,
            duration: remainingDuration,
            text: secondText,
            status: 'pending' as const
        };
        
        // Replace in array
        story.directorScript.splice(segmentIndex, 1, segment1, segment2);
        
        // Update all downstream segments' startTimes
        let cumulativeTime = 0;
        for (let j = 0; j < story.directorScript.length; j++) {
            story.directorScript[j].startTime = cumulativeTime;
            cumulativeTime += story.directorScript[j].duration;
        }
        
        // Save and refresh
        this.storyService.updateStory(story.id, { 
            directorScript: story.directorScript,
            progress: {
                ...story.progress,
                totalSegments: story.directorScript.length
            }
        });
        
        await this.storyService.saveDirectorScript(story.id);
        
        // Save and refresh with proper error handling
        if (!this._activePanel || !this._state) {
            logger.error('No active panel or state available for reload after split');
            vscode.window.showErrorMessage('Segment split but editor is not open');
            return;
        }
        
        try {
            await this.loadStoryForPanel(this._state.story.id, this._activePanel.webview);
            vscode.window.showInformationMessage(
                'Segment split successfully. Regenerate both parts to create videos.'
            );
        } catch (error: any) {
            logger.error('Failed to refresh after segment split:', error);
            vscode.window.showErrorMessage('Segment split but failed to refresh view');
        }
    }

    /**
     * Split text at time boundary
     */
    private splitTextAtTime(
        text: string, 
        segmentStart: number, 
        splitTime: number
    ): { firstText: string, secondText: string } {
        // Simple word-based split (enhance with timing_map if available)
        const words = text.split(' ');
        const midPoint = Math.floor(words.length / 2);
        
        return {
            firstText: words.slice(0, midPoint).join(' '),
            secondText: words.slice(midPoint).join(' ')
        };
    }

    /**
     * Handle segment merge operation
     */
    private async handleSegmentMerge(data: { segmentId1: string, segmentId2: string }): Promise<void> {
        // Implementation for merging adjacent segments
        vscode.window.showInformationMessage('Merge operation not implemented yet');
    }

    /**
     * Handle segment duplicate operation
     */
    private async handleSegmentDuplicate(data: { segmentId: string }): Promise<void> {
        // Implementation for duplicating segments
        vscode.window.showInformationMessage('Duplicate operation not implemented yet');
    }

    /**
     * Handle segment remove operation
     */
    private async handleSegmentRemove(data: { segmentId: string }): Promise<void> {
        // Implementation for removing segments
        vscode.window.showInformationMessage('Remove operation not implemented yet');
    }
    
    /**
     * Handle timeline zoom
     */
    private async handleTimelineZoom(level: number): Promise<void> {
        if (!this._state) { return; }
        
        this._state.timeline.zoomLevel = Math.max(
            ZOOM_PRESETS.MIN,
            Math.min(ZOOM_PRESETS.MAX, level)
        );
        
        await this.saveTimelineState(this._state.story.id);
        this.updateWebview();
    }
    
    /**
     * Handle timeline scroll
     */
    private async handleTimelineScroll(position: number): Promise<void> {
        if (!this._state) { return; }
        
        this._state.timeline.scrollPosition = Math.max(0, position);
        await this.saveTimelineState(this._state.story.id);
        this.updateWebview();
    }
    
    /**
     * Handle seek to time
     */
    private handleSeek(time: number): void {
        if (!this._state) { return; }
        
        this._state.currentTime = Math.max(0, time);
        this._state.timeline.playheadPosition = time;
        this.updateWebview();
    }
    
    /**
     * Handle segment selection
     */
    private handleSelectSegments(segmentIds: string[]): void {
        if (!this._state) { return; }
        
        this._state.timeline.selectedSegments = segmentIds;
        this.updateWebview();
    }
    
    /**
     * Handle generation request
     */
    private async handleGenerate(segmentIds: string[]): Promise<void> {
        if (!this._state) return;
        
        const story = this._state.story;
        const segmentIndices = segmentIds.map(id => 
            story.directorScript.findIndex(s => s.id === id)
        ).filter(i => i >= 0);
        
        if (segmentIndices.length === 0) {
            vscode.window.showWarningMessage('No valid segments selected for generation');
            return;
        }
        
        try {
            // Call ExecutionService for each segment
            for (const segmentIndex of segmentIndices) {
                await this.executionService.queueSegmentGeneration(
                    story.id, 
                    segmentIndex,
                    'storyline_editor_task'
                );
            }
            
            // Update queue state
            this._state.generation.queue = segmentIds;
            this._state.generation.activeSegment = segmentIds[0];
            this.updateWebview();
            
            vscode.window.showInformationMessage(
                `Queued ${segmentIndices.length} segment(s) for generation`
            );
        } catch (error: any) {
            logger.error('Failed to queue segment generation:', error);
            vscode.window.showErrorMessage(`Failed to queue generation: ${error.message}`);
        }
    }
    
    /**
     * Update webview with current state
     */
    private updateWebview(): void {
        // Try active panel first, fall back to sidebar view
        const targetWebview = this._activePanel?.webview;
        
        if (!targetWebview || !this._state) {
            return;
        }
        
        targetWebview.postMessage({
            command: 'update-state',
            state: this.serializeState(this._state)
        });
    }
    
    /**
     * Serialize state for webview (convert Maps, etc.)
     */
    private serializeState(state: StorylineEditorState): any {
        return {
            ...state,
            segmentVideoUris: state.segmentVideoUris 
                ? Object.fromEntries(state.segmentVideoUris.entries())
                : {},
            generation: {
                ...state.generation,
                progress: Array.from(state.generation.progress.entries())
            }
        };
    }
    
    /**
     * Get HTML content for webview
     */
    private getHtmlContent(webview: vscode.Webview): string {
        // Get resource URIs with cache busting
        const cacheBuster = Date.now() + Math.random();
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webviews', 'storyline', 'main.js')
        ) + '?v=' + cacheBuster;
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webviews', 'storyline', 'style.css')
        ) + '?v=' + cacheBuster;
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https:; script-src ${webview.cspSource} 'unsafe-eval'; img-src ${webview.cspSource} https: data:; media-src ${webview.cspSource} https:; font-src ${webview.cspSource} https: data:;">
    <link href="${styleUri}" rel="stylesheet">
    <link href="https://microsoft.github.io/vscode-codicons/dist/codicon.css" rel="stylesheet">
    <title>Storyline Editor</title>
</head>
<body>
    <div id="storyline-editor">
        <div id="video-player-container" style="height: 300px;">
            <video id="video-player" controls></video>
            <div id="playback-controls">
                <button id="btn-rewind" class="icon-button" title="Rewind (J)">
                    <i class="codicon codicon-debug-step-back"></i>
                </button>
                <button id="btn-play-pause" class="icon-button" title="Play/Pause (Space)">
                    <i class="codicon codicon-play"></i>
                </button>
                <button id="btn-fast-forward" class="icon-button" title="Fast Forward (L)">
                    <i class="codicon codicon-debug-step-over"></i>
                </button>
                <button id="btn-prev-segment" class="icon-button" title="Previous Segment (Shift+←)">
                    <i class="codicon codicon-chevron-left"></i>
                </button>
                <button id="btn-next-segment" class="icon-button" title="Next Segment (→)">
                    <i class="codicon codicon-chevron-right"></i>
                </button>
                <span id="time-display">00:00 / 00:00</span>
            </div>
        </div>
        
        <div id="resize-handle" class="resize-handle"></div>
        
        <div id="timeline-container">
            <div id="timeline-toolbar">
                <button id="btn-zoom-in" class="icon-button" title="Zoom In">
                    <i class="codicon codicon-zoom-in"></i>
                </button>
                <button id="btn-zoom-out" class="icon-button" title="Zoom Out">
                    <i class="codicon codicon-zoom-out"></i>
                </button>
                <button id="btn-zoom-fit" class="icon-button" title="Fit to Window">
                    <i class="codicon codicon-screen-normal"></i>
                </button>
                <label><input type="checkbox" id="snap-to-grid" checked> Snap to Grid</label>
                <label><input type="checkbox" id="snap-to-beats"> Snap to Beats</label>
            </div>
            
            
            <div id="timeline-layers">
                <div id="layer-audio" class="timeline-layer">
                    <div class="layer-label">Audio</div>
                    <canvas class="layer-canvas"></canvas>
                </div>
                <div class="layer-resizer" data-top="layer-audio" data-bottom="layer-transcript"></div>
                
                <div id="layer-transcript" class="timeline-layer">
                    <div class="layer-label">Transcript</div>
                    <canvas class="layer-canvas"></canvas>
                </div>
                <div class="layer-resizer" data-top="layer-transcript" data-bottom="layer-script"></div>
                
                <div id="layer-script" class="timeline-layer">
                    <div class="layer-label">Script</div>
                    <canvas class="layer-canvas"></canvas>
                </div>
                <div class="layer-resizer" data-top="layer-script" data-bottom="layer-video"></div>
                
                <div id="layer-video" class="timeline-layer">
                    <div class="layer-label">Video Segments</div>
                    <canvas class="layer-canvas"></canvas>
                </div>
            </div>
        </div>
        
        <div id="segment-panel">
            <h3>Segment Editor</h3>
            <div id="segment-details"></div>
        </div>
    </div>
    
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
    
    /**
     * Prepare waveform peaks from energy data
     */
    private prepareWaveformPeaks(audioAnalysis: any): number[] | null {
        if (!audioAnalysis?.energy) return null;
        
        // Convert sparse energy (100 points) to dense peaks (5000 points)
        const energy = audioAnalysis.energy;
        const targetPoints = 5000;
        const peaks = new Array(targetPoints);
        
        for (let i = 0; i < targetPoints; i++) {
            const ratio = i / targetPoints;
            const energyIdx = Math.floor(ratio * energy.length);
            const energyLevel = energy[energyIdx];
            
            // Energy is {time, level} - extract level
            peaks[i] = energyLevel?.level || 0;
        }
        
        return peaks;
    }

    /**
     * Subscribe to progress updates for a specific story
     */
    private subscribeToProgress(storyId: string): void {
        // Unsubscribe previous to prevent leaks
        if (this._progressSubscription) {
            this.progressManager.off('taskUpdated', this._progressSubscription);
            this.progressManager.off('taskCompleted', this._progressSubscription);
            this.progressManager.off('taskFailed', this._progressSubscription);
            this._progressSubscription = null;
        }
        
        // Subscribe with filter
        this._progressSubscription = (event: any) => {
            // Parse task ID: "story_${storyId}_segment_1"
            if (event.id.startsWith(`story_${storyId}_segment_`)) {
                const segmentNumStr = event.id.split('_').pop();
                const segmentNum = parseInt(segmentNumStr || '0', 10);
                
                if (!isNaN(segmentNum) && segmentNum > 0) {
                    this.handleProgressUpdate(segmentNum - 1, event.status, event.progress);
                }
            }
        };
        
        this.progressManager.on('taskUpdated', this._progressSubscription);
        this.progressManager.on('taskCompleted', this._progressSubscription);
        this.progressManager.on('taskFailed', this._progressSubscription);
    }

    /**
     * Handle progress updates
     */
    private handleProgressUpdate(
        segmentIndex: number, 
        status: string, 
        progress?: number
    ): void {
        if (!this._state) return;
        
        // Update segment status
        if (this._state.segments[segmentIndex]) {
            this._state.segments[segmentIndex].status = status as any;
        }
        
        // Update video segment status
        if (this._state.videoSegments[segmentIndex]) {
            this._state.videoSegments[segmentIndex].status = status as any;
        }
        
        // Update generation progress
        if (progress !== undefined) {
            const segmentId = this._state.segments[segmentIndex]?.id;
            if (segmentId) {
                this._state.generation.progress.set(segmentId, {
                    current: progress,
                    total: 100,
                    status: status as any,
                    message: `Generating segment ${segmentIndex + 1}...`
                });
            }
        }
        
        this.updateWebview();
    }

    /**
     * Save timeline state
     */
    private async saveTimelineState(storyId: string): Promise<void> {
        if (!this._state) return;
        
        await this.context.workspaceState.update(
            `storyline_state_${storyId}`, 
            {
                zoomLevel: this._state.timeline.zoomLevel,
                scrollPosition: this._state.timeline.scrollPosition,
                lastViewedTime: Date.now()
            }
        );
    }

    /**
     * Restore timeline state
     */
    private async restoreTimelineState(storyId: string): Promise<void> {
        interface SavedTimelineState {
            zoomLevel: number;
            scrollPosition: number;
            lastViewedTime: number;
        }
        
        const saved = this.context.workspaceState.get<SavedTimelineState>(
            `storyline_state_${storyId}`
        );
        
        if (saved && this._state) {
            this._state.timeline.zoomLevel = saved.zoomLevel;
            this._state.timeline.scrollPosition = saved.scrollPosition;
        }
    }

    /**
     * Clean up progress subscriptions for the active panel
     */
    private cleanupProgressSubscription(): void {
        if (this._progressSubscription) {
            this.progressManager.off('taskUpdated', this._progressSubscription);
            this.progressManager.off('taskCompleted', this._progressSubscription);
            this.progressManager.off('taskFailed', this._progressSubscription);
            this._progressSubscription = null;
        }
    }

    /**
     * Clean up all panel-specific resources
     */
    private cleanupPanelResources(): void {
        // Unsubscribe from progress events
        this.cleanupProgressSubscription();
        
        // Dispose panel-specific listeners
        while (this._panelDisposables.length) {
            const disposable = this._panelDisposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
        
        // Clear state
        this._state = null;
        this._activePanel = undefined;
        this._activePanelStoryId = undefined;
        
        logger.info('Panel resources cleaned up');
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        logger.info('Disposing StorylineEditorProvider...');
        
        // Clean up active panel resources
        this.cleanupPanelResources();
        
        // Dispose active panel if still open
        if (this._activePanel) {
            this._activePanel.dispose();
            this._activePanel = undefined;
        }
        
        // Dispose all shared resources
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
        
        logger.info('StorylineEditorProvider disposed');
    }
}

