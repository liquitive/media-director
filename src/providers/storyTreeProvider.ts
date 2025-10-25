/**
 * Story Tree Provider
 * Provides tree view for stories in the sidebar
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Story } from '../models/story';
import { StoryService } from '../services/storyService';
import { ProgressManager } from '../services/progressManager';
import { logger } from '../utils/logger';

type TreeItemType = 'story' | 'script' | 'segments' | 'segment' | 'completed' | 'video' | 'source' | 'file' | 'assets' | 'asset';

export class StoryTreeProvider implements vscode.TreeDataProvider<StoryTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<StoryTreeItem | undefined | null | void> = new vscode.EventEmitter<StoryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StoryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private storyService: StoryService) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
        logger.info('Story tree refreshed');
    }

    getTreeItem(element: StoryTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: StoryTreeItem): Thenable<StoryTreeItem[]> {
        if (!element) {
            // Root level - show all stories
            return this.getRootStories();
        }
        
        switch (element.type) {
            case 'story':
                return this.getStoryChildren(element.story);
            case 'segments':
                return this.getSegmentChildren(element.story);
            case 'segment':
                return this.getSegmentVideoChildren(element.story, element.segment, element.segmentIndex);
            case 'completed':
                return this.getCompletedChildren(element.story);
            case 'source':
                return this.getSourceChildren(element.story);
            case 'assets':
                return this.getAssetsChildren(element.story);
            default:
                return Promise.resolve([]);
        }
    }

    private getRootStories(): Thenable<StoryTreeItem[]> {
        const stories = this.storyService.getAllStories();
        
        console.log('🔍 StoryTreeProvider: getAllStories returned:', stories.length, 'stories');
        
        // Filter out invalid stories
        const validStories = stories.filter(story => story?.id && story?.name);
        
        console.log('🔍 StoryTreeProvider: Valid stories after filtering:', validStories.length);
        
        return Promise.resolve(validStories.map(story => new StoryTreeItem(story, 'story', this.storyService)));
    }

    private getStoryChildren(story: Story): Thenable<StoryTreeItem[]> {
        const children: StoryTreeItem[] = [];
        
        // Add Script element
        children.push(new StoryTreeItem(story, 'script', this.storyService));
        
        // Add Segments folder
        children.push(new StoryTreeItem(story, 'segments', this.storyService));
        
        // Add Completed folder
        children.push(new StoryTreeItem(story, 'completed', this.storyService));
        
        // Add Source folder
        children.push(new StoryTreeItem(story, 'source', this.storyService));
        
        // Add Assets folder
        children.push(new StoryTreeItem(story, 'assets', this.storyService));
        
        console.log('🔍 StoryTreeProvider: Created', children.length, 'child elements for story:', story.name);
        
        return Promise.resolve(children);
    }

    private getSegmentChildren(story: Story): Thenable<StoryTreeItem[]> {
        const children: StoryTreeItem[] = [];
        
        if (story.directorScript && story.directorScript.length > 0) {
            story.directorScript.forEach((segment, index) => {
                children.push(new StoryTreeItem(story, 'segment', this.storyService, segment, index));
            });
        }
        
        console.log('🔍 StoryTreeProvider: Found', children.length, 'segments for story:', story.name);
        
        return Promise.resolve(children);
    }

    private getSegmentVideoChildren(story: Story, segment: any, segmentIndex?: number): Thenable<StoryTreeItem[]> {
        const children: StoryTreeItem[] = [];
        
        // If segment has a videoPath, add it as a child
        if (segment?.videoPath && fs.existsSync(segment.videoPath)) {
            children.push(new StoryTreeItem(story, 'video', this.storyService, segment, segmentIndex, segment.videoPath));
        }
        
        console.log('🔍 StoryTreeProvider: Segment', segmentIndex, 'has', children.length, 'video(s)');
        
        return Promise.resolve(children);
    }

    private getCompletedChildren(story: Story): Thenable<StoryTreeItem[]> {
        const children: StoryTreeItem[] = [];
        
        try {
            const storyDir = this.storyService.getStoryDirectory(story.id);
            const completedDir = path.join(storyDir, 'completed');
            
            if (fs.existsSync(completedDir)) {
                const files = fs.readdirSync(completedDir);
                files.forEach(file => {
                    const filePath = path.join(completedDir, file);
                    const stats = fs.statSync(filePath);
                    
                    if (stats.isFile()) {
                        children.push(new StoryTreeItem(story, 'video', this.storyService, undefined, undefined, filePath));
                    }
                });
            }
        } catch (error) {
            console.error('Error reading completed directory:', error);
        }
        
        console.log('🔍 StoryTreeProvider: Found', children.length, 'completed videos for story:', story.name);
        
        return Promise.resolve(children);
    }

    private getSourceChildren(story: Story): Thenable<StoryTreeItem[]> {
        const children: StoryTreeItem[] = [];
        
        try {
            const storyDir = this.storyService.getStoryDirectory(story.id);
            const sourceDir = path.join(storyDir, 'source');
            
            if (fs.existsSync(sourceDir)) {
                const files = fs.readdirSync(sourceDir);
                files.forEach(file => {
                    const filePath = path.join(sourceDir, file);
                    const stats = fs.statSync(filePath);
                    
                    // Skip directories (like chunks/)
                    if (stats.isFile()) {
                        children.push(new StoryTreeItem(story, 'file', this.storyService, undefined, undefined, filePath));
                    }
                });
            }
        } catch (error) {
            console.error('Error reading source directory:', error);
        }
        
        console.log('🔍 StoryTreeProvider: Found', children.length, 'source files for story:', story.name);
        
        return Promise.resolve(children);
    }

    private getAssetsChildren(story: Story): Thenable<StoryTreeItem[]> {
        const children: StoryTreeItem[] = [];
        
        try {
            const storyDir = this.storyService.getStoryDirectory(story.id);
            const assetsFile = path.join(storyDir, 'assets', 'extracted_assets.json');
            
            if (fs.existsSync(assetsFile)) {
                const content = fs.readFileSync(assetsFile, 'utf-8');
                const data = JSON.parse(content);
                
                if (data.assets && Array.isArray(data.assets)) {
                    data.assets.forEach((asset: any) => {
                        children.push(new StoryTreeItem(story, 'asset', this.storyService, undefined, undefined, undefined, asset));
                    });
                }
            }
        } catch (error) {
            console.error('Error reading assets file:', error);
        }
        
        console.log('🔍 StoryTreeProvider: Found', children.length, 'assets for story:', story.name);
        
        return Promise.resolve(children);
    }

    getParent(element: StoryTreeItem): vscode.ProviderResult<StoryTreeItem> {
        return null;
    }
}

export class StoryTreeItem extends vscode.TreeItem {
    public readonly type: TreeItemType;
    public readonly story: Story;
    public readonly segment?: any;
    public readonly segmentIndex?: number;
    public readonly filePath?: string;
    public readonly asset?: any;

    constructor(
        story: Story,
        type: TreeItemType,
        private storyService: StoryService,
        segment?: any,
        segmentIndex?: number,
        filePath?: string,
        asset?: any
    ) {
        const label = StoryTreeItem.getLabel(story, type, segment, segmentIndex, filePath, asset);
        const collapsibleState = StoryTreeItem.getCollapsibleState(type, segment);
        
        super(label, collapsibleState);
        
        this.type = type;
        this.story = story;
        this.segment = segment;
        this.segmentIndex = segmentIndex;
        this.filePath = filePath;
        this.asset = asset;
        
        this.tooltip = this.getTooltip();
        this.description = this.getDescription();
        this.iconPath = this.getIcon();
        this.contextValue = type;
        this.command = this.getCommand();
        
        console.log('🔍 StoryTreeItem: Created item:', {
            label,
            type,
            collapsible: collapsibleState,
            hasVideo: segment?.videoPath ? 'yes' : 'no'
        });
    }

    private static getLabel(story: Story, type: TreeItemType, segment?: any, segmentIndex?: number, filePath?: string, asset?: any): string {
        switch (type) {
            case 'story':
                return story.name;
            case 'script':
                return 'Script';
            case 'segments':
                const segmentCount = story.directorScript?.length || 0;
                const completedCount = story.directorScript?.filter(s => s.status === 'completed').length || 0;
                return `Segments (${completedCount}/${segmentCount})`;
            case 'segment':
                const statusIcon = segment?.status === 'completed' ? '✅' : 
                                   segment?.status === 'generating' ? '🎬' : '⏳';
                const segmentName = segment?.text?.substring(0, 40) || `Segment ${(segmentIndex || 0) + 1}`;
                return `${statusIcon} ${segmentName}${segment?.text?.length > 40 ? '...' : ''}`;
            case 'completed':
                return 'Completed Videos';
            case 'video':
                return path.basename(filePath || 'video.mp4');
            case 'source':
                return 'Source Files';
            case 'file':
                return path.basename(filePath || 'file');
            case 'assets':
                return 'Assets';
            case 'asset':
                return asset?.name || 'Unknown Asset';
            default:
                return 'Unknown';
        }
    }

    private static getCollapsibleState(type: TreeItemType, segment?: any): vscode.TreeItemCollapsibleState {
        switch (type) {
            case 'story':
            case 'segments':
            case 'completed':
            case 'source':
            case 'assets':
                return vscode.TreeItemCollapsibleState.Collapsed;
            case 'segment':
                // Segments are collapsible if they have a video
                return segment?.videoPath ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
            default:
                return vscode.TreeItemCollapsibleState.None;
        }
    }

    private getTooltip(): string {
        switch (this.type) {
            case 'story':
                return `${this.story.name}\nStatus: ${this.story.status}\nCreated: ${new Date(this.story.createdAt).toLocaleDateString()}`;
            case 'script':
                return 'Director\'s script with scene breakdowns';
            case 'segments':
                return 'Individual video segments';
            case 'segment':
                return this.segment?.visualPrompt || this.segment?.text || 'Video segment';
            case 'completed':
                return 'Final compiled videos';
            case 'video':
                return `Video file: ${path.basename(this.filePath || '')}`;
            case 'source':
                return 'Original source files and transcriptions';
            case 'file':
                return `File: ${path.basename(this.filePath || '')}`;
            case 'assets':
                return 'Assets extracted from this story';
            case 'asset':
                return this.asset?.description || this.asset?.name || 'Asset';
            default:
                return '';
        }
    }

    private getDescription(): string {
        switch (this.type) {
            case 'story':
                return this.getStatusLabel();
            case 'segment':
                return `${this.segment?.duration || 0}s`;
            case 'video':
            case 'file':
                try {
                    if (this.filePath && fs.existsSync(this.filePath)) {
                        const stats = fs.statSync(this.filePath);
                        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                        return `${sizeMB} MB`;
                    }
                } catch (e) {
                    // Ignore
                }
                return '';
            case 'asset':
                return this.asset?.type || '';
            default:
                return '';
        }
    }

    private getStatusLabel(): string {
        const statusLabels: Record<Story['status'], string> = {
            'draft': '✏️ Draft',
            'analyzing': '🔍 Analyzing',
            'generating': '🎬 Generating',
            'compiling': '🎞️ Compiling',
            'completed': '✅ Completed',
            'error': '❌ Error'
        };

        return statusLabels[this.story.status] || this.story.status;
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.type) {
            case 'story':
                const iconMap: Record<Story['status'], string> = {
                    'draft': 'edit',
                    'analyzing': 'search',
                    'generating': 'play',
                    'compiling': 'package',
                    'completed': 'check',
                    'error': 'error'
                };
                return new vscode.ThemeIcon(iconMap[this.story.status] || 'file');
            
            case 'script':
                return new vscode.ThemeIcon('book');
            
            case 'segments':
                return new vscode.ThemeIcon('list-tree');
            
            case 'segment':
                return new vscode.ThemeIcon('symbol-snippet');
            
            case 'completed':
                return new vscode.ThemeIcon('folder');
            
            case 'video':
                return new vscode.ThemeIcon('play-circle');
            
            case 'source':
                return new vscode.ThemeIcon('folder-library');
            
            case 'file':
                const ext = path.extname(this.filePath || '').toLowerCase();
                if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
                    return new vscode.ThemeIcon('device-camera-video');
                } else if (['.mp3', '.wav', '.m4a', '.flac'].includes(ext)) {
                    return new vscode.ThemeIcon('unmute');
                } else if (['.txt', '.md', '.json'].includes(ext)) {
                    return new vscode.ThemeIcon('file-text');
                }
                return new vscode.ThemeIcon('file');
            
            case 'assets':
                return new vscode.ThemeIcon('library');
            
            case 'asset':
                const assetType = this.asset?.type;
                if (assetType === 'character') {
                    return new vscode.ThemeIcon('person');
                } else if (assetType === 'location') {
                    return new vscode.ThemeIcon('location');
                } else if (assetType === 'item') {
                    return new vscode.ThemeIcon('package');
                } else if (assetType === 'vehicle') {
                    return new vscode.ThemeIcon('rocket');
                } else if (assetType === 'animal') {
                    return new vscode.ThemeIcon('bug');
                }
                return new vscode.ThemeIcon('symbol-misc');
            
            default:
                return new vscode.ThemeIcon('file');
        }
    }

    private getCommand(): vscode.Command | undefined {
        switch (this.type) {
            case 'story':
                // Clicking story opens the Storyline Editor
                if (this.story?.id) {
                    return {
                        command: 'sora.openStorylineEditor',
                        title: 'Open Storyline Editor',
                        arguments: [this.story.id]
                    };
                }
                break;
            
            case 'script':
                // Clicking script opens the script editor
                if (this.story?.id) {
                    return {
                        command: 'sora.openScript',
                        title: 'Open Script',
                        arguments: [this.story.id]
                    };
                }
                break;
            
            case 'segment':
                // Clicking segment opens segment editor
                if (this.segment && this.story?.id) {
                    // Open the segment JSON file directly with the custom editor
                    const segmentPath = path.join(
                        this.storyService.getStoryDirectory(this.story.id),
                        'segments',
                        `segment_${(this.segmentIndex || 0) + 1}.json`
                    );
                    return {
                        command: 'vscode.open',
                        title: 'Open Segment Editor',
                        arguments: [vscode.Uri.file(segmentPath)]
                    };
                }
                break;
            
            case 'video':
                // Double-clicking video opens in video viewer with navigation
                if (this.filePath && this.story?.id && this.segmentIndex !== undefined) {
                    return {
                        command: 'sora.openVideoViewer',
                        title: 'Open Video Viewer',
                        arguments: [this.story.id, this.segmentIndex, this.filePath]
                    };
                }
                break;
            
            case 'file':
                // Clicking file opens with appropriate editor based on extension
                if (this.filePath) {
                    const ext = path.extname(this.filePath).toLowerCase();
                    if (['.mp3', '.wav', '.m4a', '.ogg'].includes(ext)) {
                        return {
                            command: 'vscode.openWith',
                            title: 'Open with Audio Player',
                            arguments: [vscode.Uri.file(this.filePath), 'sora.audioPlayer']
                        };
                    } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
                        return {
                            command: 'vscode.openWith',
                            title: 'Open with Video Player',
                            arguments: [vscode.Uri.file(this.filePath), 'sora.videoPlayer']
                        };
                    } else {
                        return {
                            command: 'vscode.open',
                            title: 'Open File',
                            arguments: [vscode.Uri.file(this.filePath)]
                        };
                    }
                }
                break;
            
            case 'asset':
                // Clicking asset opens asset editor
                if (this.asset?.id) {
                    return {
                        command: 'sora.openAsset',
                        title: 'Open Asset Editor',
                        arguments: [this.asset.id]
                    };
                }
                break;
        }
        
        return undefined;
    }
}
