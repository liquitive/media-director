/**
 * Progress Tree Provider
 * Shows task progress in a tree view (more reliable than WebviewViewProvider)
 */

import * as vscode from 'vscode';
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
}

class ProgressTreeItem extends vscode.TreeItem {
    constructor(
        public readonly task: ProgressTask,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(task.name, collapsibleState);
        
        // Set icon based on status
        this.iconPath = new vscode.ThemeIcon(
            task.status === 'running' ? 'sync~spin' :
            task.status === 'success' ? 'check' :
            task.status === 'failed' ? 'error' :
            'clock'
        );
        
        // Set description
        if (task.message) {
            this.description = task.message;
        }
        
        // Set tooltip
        const duration = task.endTime ? 
            `${((task.endTime - task.startTime) / 1000).toFixed(1)}s` : 
            'running...';
        this.tooltip = `${task.name}\nStatus: ${task.status}\nDuration: ${duration}`;
        
        // Set context value for right-click menus
        this.contextValue = `progressTask_${task.status}`;
    }
}

export class ProgressTreeProvider implements vscode.TreeDataProvider<ProgressTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ProgressTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    private tasks = new Map<string, ProgressTask>();
    
    constructor() {
        logger.info('ProgressTreeProvider initialized');
    }
    
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
    
    getTreeItem(element: ProgressTreeItem): vscode.TreeItem {
        return element;
    }
    
    getChildren(element?: ProgressTreeItem): Thenable<ProgressTreeItem[]> {
        if (!element) {
            // Root level - show all tasks without parents
            const rootTasks = Array.from(this.tasks.values())
                .filter(task => !task.parentId);
            
            if (rootTasks.length === 0) {
                return Promise.resolve([]);
            }
            
            return Promise.resolve(
                rootTasks.map(task => 
                    new ProgressTreeItem(
                        task,
                        task.children.length > 0 ? 
                            vscode.TreeItemCollapsibleState.Expanded : 
                            vscode.TreeItemCollapsibleState.None
                    )
                )
            );
        } else {
            // Show children
            return Promise.resolve(
                element.task.children.map(child => 
                    new ProgressTreeItem(
                        child,
                        child.children.length > 0 ? 
                            vscode.TreeItemCollapsibleState.Expanded : 
                            vscode.TreeItemCollapsibleState.None
                    )
                )
            );
        }
    }
    
    // Task management methods
    public startTask(id: string, name: string, parentId?: string): void {
        const task: ProgressTask = {
            id,
            name,
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
        
        logger.info(`Task started: ${name} (${id})`);
        this.refresh();
    }
    
    public updateTask(id: string, status: 'pending' | 'running' | 'success' | 'failed', message?: string): void {
        const task = this.tasks.get(id);
        if (task) {
            task.status = status;
            if (message) {
                task.message = message;
            }
            logger.info(`Task updated: ${task.name} - ${status}${message ? ': ' + message : ''}`);
            this.refresh();
        }
    }
    
    public completeTask(id: string, message?: string): void {
        const task = this.tasks.get(id);
        if (task) {
            task.status = 'success';
            task.endTime = Date.now();
            if (message) {
                task.message = message;
            }
            logger.info(`Task completed: ${task.name}${message ? ': ' + message : ''}`);
            this.refresh();
        }
    }
    
    public failTask(id: string, error: string): void {
        const task = this.tasks.get(id);
        if (task) {
            task.status = 'failed';
            task.endTime = Date.now();
            task.message = error;
            logger.error(`Task failed: ${task.name}: ${error}`);
            this.refresh();
        }
    }
    
    public clearTasks(): void {
        this.tasks.clear();
        logger.info('All tasks cleared');
        this.refresh();
    }
    
    public clearCompletedTasks(): void {
        const completed = Array.from(this.tasks.entries())
            .filter(([_, task]) => task.status === 'success' && !task.parentId);
        
        completed.forEach(([id]) => this.tasks.delete(id));
        
        logger.info(`Cleared ${completed.length} completed tasks`);
        this.refresh();
    }
    
    /**
     * Get tasks tree structure for webview rendering
     */
    public getTasksTree(): ProgressTask[] {
        // Return only root tasks (without parents)
        return Array.from(this.tasks.values())
            .filter(task => !task.parentId)
            .sort((a, b) => a.startTime - b.startTime);
    }
}
































