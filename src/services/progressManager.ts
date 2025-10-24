/**
 * Progress Manager Service
 * Manages task progress tracking using a tree provider
 */

import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface ProgressTask {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'success' | 'failed';
    message?: string;
    parentId?: string;
    startTime: number;
    endTime?: number;
    children: ProgressTask[];
    progress?: number; // Percentage (0-100)
    totalSegments?: number; // For overall story progress
    completedSegments?: number; // For overall story progress
}

export class ProgressManager extends EventEmitter {
    private static instance: ProgressManager;
    private context: vscode.ExtensionContext | undefined;
    private webviewPanel: vscode.WebviewPanel | undefined;
    private autoOpenWebview: boolean = true;
    private isPaused: boolean = false;
    private pauseResolvers: Array<() => void> = [];
    private tasks = new Map<string, ProgressTask>();

    private constructor() {
        super();
    }

    public static getInstance(): ProgressManager {
        if (!ProgressManager.instance) {
            ProgressManager.instance = new ProgressManager();
        }
        return ProgressManager.instance;
    }

    /**
     * Remove any Codicon $(icon) sequences from a string
     */
    private stripCodicons(text: string | undefined): string | undefined {
        if (!text) return text;
        return text.replace(/\$\([a-z0-9-]+\)\s*/gi, '');
    }

    /**
     * Initialize the progress manager with tree view
     */
    public initialize(context: vscode.ExtensionContext): void {
        logger.info('ProgressManager: Starting initialization with tree provider...');
        this.context = context;
        
        // Progress is now handled in the dev panel, no tree view needed
        
        logger.info('ProgressManager: Tree view registered successfully');
    }


    /**
     * Show progress panel in editor area
     */
    public showProgressPanel(): void {
        this.openWebviewPanel();
    }

    /**
     * Open or focus the webview panel in editor area
     */
    private openWebviewPanel(): void {
        if (this.webviewPanel) {
            this.webviewPanel.reveal(vscode.ViewColumn.One);
            return;
        }

        this.webviewPanel = vscode.window.createWebviewPanel(
            'soraProgressPanel',
            'Sora Progress',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context!.extensionUri),
                    vscode.Uri.joinPath(this.context!.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
                ]
            }
        );

        // Get codicon URI after panel is created
        const panel = this.webviewPanel;
        const codiconUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context!.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
        );
        
        panel.webview.html = this.getWebviewContent(codiconUri);

        // Handle messages from webview
        panel.webview.onDidReceiveMessage((message) => {
            if (message.type === 'pause') {
                this.pause();
            } else if (message.type === 'resume') {
                this.resume();
            }
        });

        // Handle disposal
        this.webviewPanel.onDidDispose(() => {
            this.webviewPanel = undefined;
        });

        // Update webview content
        this.updateWebview();
    }

    /**
     * Get HTML content for the webview
     */
    private getWebviewContent(codiconUri: vscode.Uri): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sora Progress</title>
    <link href="${codiconUri}" rel="stylesheet" />
    <style>
        .codicon {
            font-size: 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .codicon-sync.spinning {
            animation: spin 1s linear infinite;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 8px;
            margin: 0;
        }
        .task-item {
            display: flex;
            align-items: center;
            padding: 4px 8px;
            cursor: pointer;
            user-select: none;
        }
        .task-item.running {
            font-weight: 500;
        }
        .task-indent {
            width: 16px;
            flex-shrink: 0;
        }
        .expand-icon {
            width: 16px;
            height: 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            font-size: 10px;
            opacity: 0.7;
        }
        .expand-icon.no-children {
            opacity: 0;
        }
        .status-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            margin: 0 6px;
            flex-shrink: 0;
        }
        .status-icon.running {
            animation: spin 1s linear infinite;
        }
        .task-label {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .task-label .codicon {
            margin-right: 4px;
            vertical-align: middle;
        }
        .task-message {
            margin-left: 8px;
            font-size: 0.9em;
            opacity: 0.65;
        }
        .task-children {
            display: block;
        }
        .task-children.collapsed {
            display: none;
        }
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }
        .control-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-sideBar-background);
        }
        .control-button {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
        }
        .control-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .control-button.paused {
            background-color: var(--vscode-editorWarning-foreground);
        }
        .pause-indicator {
            display: none;
            align-items: center;
            gap: 6px;
            color: var(--vscode-editorWarning-foreground);
            font-size: 13px;
            margin-left: 8px;
        }
        .pause-indicator.visible {
            display: flex;
        }
        .progress-container {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: 8px;
            flex-shrink: 0;
        }
        .progress-bar {
            width: 60px;
            height: 4px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 2px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-foreground);
            transition: width 0.3s ease;
        }
        .progress-text {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            min-width: 30px;
            text-align: right;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="control-bar">
        <button id="pause-resume-btn" class="control-button" title="Pause/Resume processing">
            <i class="codicon codicon-debug-pause"></i>
            <span id="pause-resume-text">Pause</span>
        </button>
        <div id="pause-indicator" class="pause-indicator">
            <i class="codicon codicon-warning"></i>
            <span>Processing Paused</span>
        </div>
    </div>
    <div id="progress-container">
        <div class="empty-state">
            <div class="empty-state-icon"><i class="codicon codicon-check-all"></i></div>
            <div>No active tasks</div>
            <div style="font-size: 0.9em; margin-top: 8px;">Progress will appear here when tasks are running</div>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const expandedState = new Set();
        
        function renderTasks(tasks) {
            const container = document.getElementById('progress-container');
            
            if (!tasks || tasks.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon"><i class="codicon codicon-check-all"></i></div>
                        <div>No active tasks</div>
                        <div style="font-size: 0.9em; margin-top: 8px;">Progress will appear here when tasks are running</div>
                    </div>
                \`;
                return;
            }
            
            container.innerHTML = tasks.map(task => renderTask(task, 0)).join('');
            attachEventListeners();
            scrollToLatestRunning();
        }
        
        function findLatestRunningTask(tasks, latest = null) {
            for (const task of tasks) {
                if (task.status === 'running') {
                    if (!latest || task.startTime > latest.startTime) {
                        latest = task;
                    }
                }
                if (task.children && task.children.length > 0) {
                    latest = findLatestRunningTask(task.children, latest);
                }
            }
            return latest;
        }
        
        function scrollToLatestRunning() {
            const tasks = Array.from(document.querySelectorAll('.task-item'));
            if (tasks.length === 0) return;
            
            // Find all running tasks
            const runningTasks = tasks.filter(el => {
                const icon = el.querySelector('.status-icon .codicon-sync');
                return icon !== null;
            });
            
            if (runningTasks.length > 0) {
                // Scroll to the last running task (most recent)
                const latestRunning = runningTasks[runningTasks.length - 1];
                latestRunning.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Strip any $(icon) occurrences from text (clean fallback when icons don't render)
        function stripCodicons(text) {
            if (!text || typeof text !== 'string') return '';
            return text.replace(/\$\([a-z0-9-]+\)\s*/gi, '');
        }
        
        // NEW: split icon at start of name
        function splitIconAndText(name) {
            const match = name.match(/^\$\(([a-z0-9-]+)\)\s*/i);
            if (match) {
                return { icon: match[1], text: name.substring(match[0].length) };
            }
            return { icon: null, text: name };
        }
        
        function renderTask(task, depth) {
            // Use VS Code codicons
            const statusIcons = {
                pending: 'codicon-watch',
                running: 'codicon-sync spinning',
                success: 'codicon-check',
                failed: 'codicon-error'
            };
            
            const iconClass = statusIcons[task.status] || 'codicon-watch';
            const hasChildren = task.children && task.children.length > 0;
            
            // Keep failed tasks expanded, auto-collapse only successful tasks
            let isExpanded = false;
            if (task.status === 'running') {
                isExpanded = true;
            } else if (task.status === 'success') {
                expandedState.delete(task.id); // Auto-collapse successful tasks
                isExpanded = false;
            } else if (task.status === 'failed') {
                isExpanded = true; // Keep failed tasks expanded
            } else {
                isExpanded = expandedState.has(task.id);
            }
            
            const expandIconClass = hasChildren ? (isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right') : '';
            const expandClass = hasChildren ? (isExpanded ? 'expanded' : '') : 'no-children';
            const childrenClass = isExpanded ? '' : 'collapsed';
            
            const indents = Array(depth).fill('<span class="task-indent"></span>').join('');
            
            const children = hasChildren 
                ? \`<div class="task-children \${childrenClass}" data-parent="\${task.id}">
                    \${task.children.map(child => renderTask(child, depth + 1)).join('')}
                   </div>\`
                : '';
            
            const statusClass = task.status === 'running' ? 'running' : '';
            const itemClass = task.status === 'running' ? 'task-item running' : 'task-item';
            
            // Build label with optional leading icon and codiconized message text
            let displayMessage = '';
            if (task.message) {
                displayMessage = ' - ' + escapeHtml(stripCodicons(task.message));
            }
            const { text: lblText } = splitIconAndText(task.name);
            const iconHtml = '';
            
            // Add percentage progress if available
            let progressDisplay = '';
            if (task.progress !== undefined && task.progress !== null) {
                const progressBar = \`
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: \${task.progress}%"></div>
                    </div>
                    <span class="progress-text">\${task.progress}%</span>
                \`;
                progressDisplay = \`<div class="progress-container">\${progressBar}</div>\`;
            }
            
            const taskLabelParts = iconHtml + escapeHtml(stripCodicons(lblText)) + displayMessage;
            
            return \`
                <div>
                    <div class="\${itemClass}" data-task-id="\${task.id}">
                        \${indents}
                        <span class="expand-icon \${expandClass}"><i class="codicon \${expandIconClass}"></i></span>
                        <span class="status-icon \${statusClass}"><i class="codicon \${iconClass}"></i></span>
                        <span class="task-label">\${taskLabelParts}</span>
                        \${progressDisplay}
                    </div>
                    \${children}
                </div>
            \`;
        }
        
        function attachEventListeners() {
            document.querySelectorAll('.task-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    const taskId = item.getAttribute('data-task-id');
                    const childrenEl = document.querySelector(\`.task-children[data-parent="\${taskId}"]\`);
                    const expandIcon = item.querySelector('.expand-icon');
                    const expandCodeicon = expandIcon ? expandIcon.querySelector('.codicon') : null;
                    
                    if (childrenEl && expandCodeicon) {
                        const isCollapsed = childrenEl.classList.contains('collapsed');
                        if (isCollapsed) {
                            childrenEl.classList.remove('collapsed');
                            expandIcon.classList.add('expanded');
                            expandCodeicon.classList.remove('codicon-chevron-right');
                            expandCodeicon.classList.add('codicon-chevron-down');
                            expandedState.add(taskId);
                        } else {
                            childrenEl.classList.add('collapsed');
                            expandIcon.classList.remove('expanded');
                            expandCodeicon.classList.remove('codicon-chevron-down');
                            expandCodeicon.classList.add('codicon-chevron-right');
                            expandedState.delete(taskId);
                        }
                    }
                });
            });
        }
        
        // Pause/Resume button handler
        const pauseResumeBtn = document.getElementById('pause-resume-btn');
        const pauseResumeText = document.getElementById('pause-resume-text');
        const pauseResumeIcon = pauseResumeBtn.querySelector('.codicon');
        const pauseIndicator = document.getElementById('pause-indicator');
        
        let isPaused = false;
        
        pauseResumeBtn.addEventListener('click', () => {
            vscode.postMessage({
                type: isPaused ? 'resume' : 'pause'
            });
        });
        
        function updatePauseState(paused) {
            isPaused = paused;
            if (paused) {
                pauseResumeBtn.classList.add('paused');
                pauseResumeIcon.classList.remove('codicon-debug-pause');
                pauseResumeIcon.classList.add('codicon-debug-continue');
                pauseResumeText.textContent = 'Resume';
                pauseIndicator.classList.add('visible');
            } else {
                pauseResumeBtn.classList.remove('paused');
                pauseResumeIcon.classList.remove('codicon-debug-continue');
                pauseResumeIcon.classList.add('codicon-debug-pause');
                pauseResumeText.textContent = 'Pause';
                pauseIndicator.classList.remove('visible');
            }
        }
        
        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                renderTasks(message.tasks);
                if (message.isPaused !== undefined) {
                    updatePauseState(message.isPaused);
                }
            }
        });
    </script>
</body>
</html>`;
    }

    /**
     * Update webview content with current tasks
     */
    private updateWebview(): void {
        if (!this.webviewPanel) {
            return;
        }

        const tasks = this.getTasksTree();
        this.webviewPanel.webview.postMessage({
            type: 'update',
            tasks: tasks,
            isPaused: this.isPaused
        });
    }

    /**
     * Get tasks tree structure for webview rendering
     */
    private getTasksTree(): ProgressTask[] {
        // Return only root tasks (without parents)
        return Array.from(this.tasks.values())
            .filter(task => !task.parentId)
            .sort((a, b) => a.startTime - b.startTime);
    }

    /**
     * Test the progress panel with dummy data
     */
    public testProgressPanel(): void {
        // Add test tasks
        this.startTask('test1', '🎬 Test Story Generation');
        this.startTask('test1_transcribe', '🎤 Transcribing Audio', 'test1');

        setTimeout(() => {
            this.updateTask('test1_transcribe', 'running', 'Processing audio file...');
            setTimeout(() => {
                this.completeTask('test1_transcribe', 'Transcription complete');
                this.startTask('test1_script', '📝 Generating Script', 'test1');
                setTimeout(() => {
                    this.updateTask('test1_script', 'running', 'AI is analyzing content...');
                    setTimeout(() => {
                        this.completeTask('test1_script', 'Script generated successfully');
                        this.completeTask('test1', 'Story creation complete!');
                    }, 1500);
                }, 1000);
            }, 1000);
        }, 500);
    }

    /**
     * Start a new task
     */
    public startTask(id: string, name: string, parentId?: string): void {
        const cleanName = this.stripCodicons(name) as string;
        
        const task: ProgressTask = {
            id,
            name: cleanName,
            status: 'running',
            message: '',
            parentId,
            startTime: Date.now(),
            children: []
        };
        
        this.tasks.set(id, task);
        
        // Add to parent if specified
        if (parentId) {
            const parent = this.tasks.get(parentId);
            if (parent) {
                parent.children.push(task);
            }
        }
        
        this.emit('taskStarted', { id, name, parentId });
        
        // Auto-open webview on first task if enabled
        if (this.autoOpenWebview && !this.webviewPanel) {
            this.openWebviewPanel();
        } else {
            this.updateWebview();
        }
    }

    /**
     * Update task status
     */
    public updateTask(id: string, status: 'pending' | 'running' | 'success' | 'failed', message?: string, progress?: number): void {
        const cleanMessage = this.stripCodicons(message);
        const task = this.tasks.get(id);
        if (task) {
            task.status = status;
            if (cleanMessage) {
                task.message = cleanMessage;
            }
            if (progress !== undefined) {
                task.progress = Math.max(0, Math.min(100, progress));
            }
        }
        this.emit('taskUpdated', { id, status, message: cleanMessage, progress });
        this.updateWebview();
    }

    /**
     * Update task progress percentage
     */
    public updateTaskProgress(id: string, progress: number, message?: string): void {
        const cleanMessage = this.stripCodicons(message);
        const task = this.tasks.get(id);
        if (task) {
            task.progress = Math.max(0, Math.min(100, progress));
            if (cleanMessage) {
                task.message = cleanMessage;
            }
        }
        this.emit('taskProgress', { id, progress, message: cleanMessage });
        this.updateWebview();
    }

    /**
     * Complete a task
     */
    public completeTask(id: string, message?: string): void {
        const cleanMessage = this.stripCodicons(message);
        const task = this.tasks.get(id);
        if (task) {
            task.status = 'success';
            task.endTime = Date.now();
            if (cleanMessage) {
                task.message = cleanMessage;
            }
        }
        this.emit('taskCompleted', { id, message: cleanMessage });
        this.updateWebview();
    }

    /**
     * Fail a task
     */
    public failTask(id: string, error: string): void {
        const cleanError = this.stripCodicons(error) as string;
        const task = this.tasks.get(id);
        if (task) {
            task.status = 'failed';
            task.endTime = Date.now();
            task.message = cleanError;
        }
        this.emit('taskFailed', { id, error: cleanError });
        this.updateWebview();
    }

    /**
     * Clear all tasks
     */
    public clearTasks(): void {
        this.tasks.clear();
        this.updateWebview();
    }

    /**
     * Clear completed tasks only
     */
    public clearCompletedTasks(): void {
        const completed = Array.from(this.tasks.entries())
            .filter(([_, task]) => task.status === 'success' && !task.parentId);
        
        completed.forEach(([id]) => this.tasks.delete(id));
        this.updateWebview();
    }

    /**
     * Pause all progress operations
     */
    public pause(): void {
        this.isPaused = true;
        logger.info('ProgressManager: Paused');
        this.updateWebview();
    }

    /**
     * Resume all progress operations
     */
    public resume(): void {
        this.isPaused = false;
        logger.info('ProgressManager: Resumed');
        // Resolve all waiting promises
        this.pauseResolvers.forEach(resolve => resolve());
        this.pauseResolvers = [];
        this.updateWebview();
    }

    /**
     * Check if paused and wait if necessary
     * Call this in long-running operations to allow pausing
     */
    public async checkPause(): Promise<void> {
        if (this.isPaused) {
            logger.info('ProgressManager: Operation paused, waiting for resume...');
            await new Promise<void>(resolve => {
                this.pauseResolvers.push(resolve);
            });
        }
    }

    /**
     * Check if currently paused
     */
    public isPausedState(): boolean {
        return this.isPaused;
    }
}
