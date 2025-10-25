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

interface TreeViewState {
    expandedNodes: string[];
    selectedSegment?: {
        storyId: string;
        segmentIndex: number;
        videoPath?: string;
    };
    lastOpenedItem?: {
        nodeId: string;  // e.g., "video:story_123:5", "script:story_123", "file:story_123:segment_1.json"
        type: TreeItemType;
        storyId: string;
        segmentIndex?: number;
        filePath?: string;
    };
    wasViewVisible?: boolean;  // Track if ANY Sora view was visible when last saved
    activeView?: 'soraStories' | 'soraAssets';  // Track which specific Sora view was active
}

export class StoryTreeProvider implements vscode.TreeDataProvider<StoryTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<StoryTreeItem | undefined | null | void> = new vscode.EventEmitter<StoryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StoryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private treeView?: vscode.TreeView<StoryTreeItem>;
    private context?: vscode.ExtensionContext;
    private treeItemCache: Map<string, StoryTreeItem> = new Map();

    constructor(private storyService: StoryService) {}

    public setTreeView(treeView: vscode.TreeView<StoryTreeItem>, context: vscode.ExtensionContext): void {
        this.treeView = treeView;
        this.context = context;

        // Listen to tree view expansion/collapse events
        treeView.onDidExpandElement(e => {
            this.saveExpandedState(e.element, true);
        });

        treeView.onDidCollapseElement(e => {
            this.saveExpandedState(e.element, false);
        });

        // Restore previous state
        this.restoreTreeViewState();
    }

    private getNodeId(element: StoryTreeItem): string {
        // Create unique ID for tree nodes
        if (element.type === 'story') {
            return `story:${element.story?.id}`;
        } else if (element.type === 'segments') {
            return `segments:${element.story?.id}`;
        } else if (element.type === 'segment') {
            return `segment:${element.story?.id}:${element.segmentIndex}`;
        } else if (element.type === 'video') {
            return `video:${element.story?.id}:${element.segmentIndex}`;
        } else if (element.type === 'source' || element.type === 'completed' || element.type === 'assets') {
            return `${element.type}:${element.story?.id}`;
        }
        return `unknown:${Date.now()}`;
    }

    private saveExpandedState(element: StoryTreeItem, expanded: boolean): void {
        if (!this.context) return;

        const state = this.getTreeViewState();
        const nodeId = this.getNodeId(element);

        if (expanded) {
            if (!state.expandedNodes.includes(nodeId)) {
                state.expandedNodes.push(nodeId);
                logger.info(`💾 Saved expanded node: ${nodeId}`);
            }
        } else {
            state.expandedNodes = state.expandedNodes.filter(id => id !== nodeId);
            logger.info(`💾 Saved collapsed node: ${nodeId}`);
        }

        this.context.workspaceState.update('storyTreeViewState', state);
    }

    private getTreeViewState(): TreeViewState {
        if (!this.context) {
            return { expandedNodes: [] };
        }
        return this.context.workspaceState.get<TreeViewState>('storyTreeViewState', { expandedNodes: [] });
    }

    public saveLastOpenedItem(type: TreeItemType, storyId: string, segmentIndex?: number, filePath?: string): void {
        if (!this.context) {
            logger.warn('⚠️ Cannot save last opened item - context not initialized');
            return;
        }

        // Build the node ID
        let nodeId = '';
        if (type === 'video' && segmentIndex !== undefined) {
            nodeId = `video:${storyId}:${segmentIndex}`;
        } else if (type === 'segment' && segmentIndex !== undefined) {
            nodeId = `segment:${storyId}:${segmentIndex}`;
        } else if (type === 'script') {
            nodeId = `script:${storyId}`;
        } else if (type === 'file' && filePath) {
            nodeId = `file:${storyId}:${filePath}`;
        } else {
            nodeId = `${type}:${storyId}`;
        }

        const state = this.getTreeViewState();
        state.lastOpenedItem = {
            nodeId,
            type,
            storyId,
            segmentIndex,
            filePath
        };
        // Don't automatically mark view as active - let visibility listener handle it
        
        this.context.workspaceState.update('storyTreeViewState', state);
        logger.info(`💾 Saved last opened item: ${type} (${nodeId})`);
    }

    private async restoreTreeViewState(): Promise<void> {
        if (!this.treeView || !this.context) return;

        const state = this.getTreeViewState();
        
        logger.info(`Restoring tree view state: ${state.expandedNodes.length} expanded nodes, selected segment: ${state.selectedSegment ? `${state.selectedSegment.storyId}:${state.selectedSegment.segmentIndex}` : 'none'}, last opened item: ${state.lastOpenedItem ? state.lastOpenedItem.nodeId : 'none'}, was visible: ${state.wasViewVisible}, active view: ${state.activeView || 'none'}`);

        // Only restore sidebar view if it was actually visible when saved
        if (state.wasViewVisible) {
            if (state.activeView === 'soraStories') {
                logger.info('🎯 Restoring Sora Stories view in sidebar (it was active before)');
                try {
                    await vscode.commands.executeCommand('soraStories.focus');
                } catch (error) {
                    logger.warn('⚠️ Could not focus Sora Stories view:', error);
                }
            } else if (state.activeView === 'soraAssets') {
                logger.info('🎯 Restoring Sora Assets view in sidebar (it was active before)');
                try {
                    await vscode.commands.executeCommand('soraAssets.focus');
                } catch (error) {
                    logger.warn('⚠️ Could not focus Sora Assets view:', error);
                }
            }
        } else {
            logger.info('ℹ️ Sora views were not visible before - not forcing them open');
        }

        // Short delay to ensure tree is fully initialized
        await new Promise(resolve => setTimeout(resolve, 500));

        // Sort node IDs by hierarchy depth (story -> segments -> segment -> video)
        const sortedNodeIds = state.expandedNodes.sort((a, b) => {
            const depthA = (a.match(/:/g) || []).length;
            const depthB = (b.match(/:/g) || []).length;
            return depthA - depthB;
        });

        // Restore expanded nodes in hierarchical order
        for (const nodeId of sortedNodeIds) {
            const element = await this.findElementByNodeId(nodeId);
            if (element) {
                try {
                    await this.treeView.reveal(element, { expand: true, select: false, focus: false });
                    // Small delay between expansions to allow tree to update
                    await new Promise(resolve => setTimeout(resolve, 50));
                } catch (error) {
                    logger.warn(`Failed to reveal node ${nodeId}:`, error);
                }
            }
        }

        // Restore selected segment video last (after all parents are expanded)
        if (state.selectedSegment) {
            const { storyId, segmentIndex, videoPath } = state.selectedSegment;
            logger.info(`📍 Attempting to restore selected segment: ${storyId}:${segmentIndex}, videoPath: ${videoPath}`);
            if (videoPath) {
                try {
                    // Add delay to ensure all parent nodes are expanded
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                    // Directly find and reveal the video node
                    const videoNodeId = `video:${storyId}:${segmentIndex}`;
                    const videoElement = await this.findElementByNodeId(videoNodeId);
                    
                    if (videoElement && this.treeView) {
                        await this.treeView.reveal(videoElement, {
                            select: true,
                            focus: true,
                            expand: true
                        });
                        logger.info(`✅ Restored selected video: ${storyId}:${segmentIndex}`);
                    } else {
                        logger.warn(`⚠️ Video element not found for: ${videoNodeId}`);
                    }
                } catch (error) {
                    logger.warn('Failed to restore selected segment:', error);
                }
            } else {
                logger.warn('⚠️ No videoPath in selected segment state');
            }
        } else {
            logger.info('📍 No selected segment to restore');
        }

        // Restore last opened item
        if (state.lastOpenedItem) {
            const { type, nodeId, storyId, segmentIndex, filePath } = state.lastOpenedItem;
            logger.info(`📂 Attempting to restore last opened item: ${type} (${nodeId})`);
            
            try {
                // Add delay to ensure tree is fully restored
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const story = this.storyService.getStory(storyId);
                if (!story) {
                    logger.warn(`⚠️ Could not find story: ${storyId}`);
                    return;
                }

                switch (type) {
                    case 'video':
                        if (segmentIndex !== undefined && story.directorScript && story.directorScript[segmentIndex]) {
                            const segment = story.directorScript[segmentIndex];
                            if (segment.videoPath && fs.existsSync(segment.videoPath)) {
                                await vscode.commands.executeCommand('sora.openVideoViewer', storyId, segmentIndex, segment.videoPath);
                                logger.info(`✅ Restored video viewer: ${storyId}:${segmentIndex}`);
                            } else {
                                logger.warn(`⚠️ Video file not found for segment ${segmentIndex}`);
                            }
                        }
                        break;

                    case 'segment':
                        if (segmentIndex !== undefined) {
                            // filePath is stored in the state, use it if available, otherwise construct it
                            const segmentPath = filePath || path.join(this.storyService.getStoryDirectory(storyId), 'segments', `segment_${segmentIndex + 1}.json`);
                            logger.info(`🔍 Looking for segment file: ${segmentPath} (index: ${segmentIndex})`);
                            if (fs.existsSync(segmentPath)) {
                                const uri = vscode.Uri.file(segmentPath);
                                await vscode.commands.executeCommand('vscode.open', uri);
                                logger.info(`✅ Restored segment file: segment_${segmentIndex + 1}.json at ${segmentPath}`);
                            } else {
                                logger.warn(`⚠️ Segment file not found: ${segmentPath}`);
                            }
                        } else {
                            logger.warn(`⚠️ No segmentIndex for segment restoration`);
                        }
                        break;

                    case 'script':
                        // Open script editor
                        await vscode.commands.executeCommand('sora.openScript', storyId);
                        logger.info(`✅ Restored script editor for story: ${storyId}`);
                        break;

                    case 'file':
                        if (filePath && fs.existsSync(filePath)) {
                            const uri = vscode.Uri.file(filePath);
                            await vscode.commands.executeCommand('vscode.open', uri);
                            logger.info(`✅ Restored file: ${filePath}`);
                        } else {
                            logger.warn(`⚠️ File not found: ${filePath}`);
                        }
                        break;

                    default:
                        logger.info(`ℹ️ No restoration handler for type: ${type}`);
                }
            } catch (error) {
                logger.warn(`❌ Failed to restore ${type}:`, error);
            }
        } else {
            logger.info('📂 No last opened item to restore');
        }
    }

    private async findElementByNodeId(nodeId: string): Promise<StoryTreeItem | undefined> {
        // First check if we already have this item in cache
        const cachedItem = this.treeItemCache.get(nodeId);
        if (cachedItem) {
            return cachedItem;
        }

        // If not in cache, build the tree path to create and cache the item
        const [type, ...parts] = nodeId.split(':');
        
        if (type === 'story') {
            const storyId = parts[0];
            // Trigger tree building by getting root stories
            await this.getRootStories();
            return this.treeItemCache.get(nodeId);
        } else if (type === 'segments' || type === 'source' || type === 'completed' || type === 'assets' || type === 'script') {
            const storyId = parts[0];
            const story = this.storyService.getStory(storyId);
            if (story) {
                // Build parent first
                const storyNodeId = `story:${storyId}`;
                await this.findElementByNodeId(storyNodeId);
                // Then build this level
                await this.getStoryChildren(story);
                return this.treeItemCache.get(nodeId);
            }
        } else if (type === 'segment') {
            const storyId = parts[0];
            const story = this.storyService.getStory(storyId);
            if (story) {
                // Build parent chain first
                const segmentsNodeId = `segments:${storyId}`;
                await this.findElementByNodeId(segmentsNodeId);
                // Then build segments
                await this.getSegmentChildren(story);
                return this.treeItemCache.get(nodeId);
            }
        } else if (type === 'video') {
            const storyId = parts[0];
            const segmentIndex = parseInt(parts[1], 10);
            const story = this.storyService.getStory(storyId);
            if (story && story.directorScript && story.directorScript[segmentIndex]) {
                // Build parent chain first
                const segmentNodeId = `segment:${storyId}:${segmentIndex}`;
                await this.findElementByNodeId(segmentNodeId);
                // Then build video children
                await this.getSegmentVideoChildren(story, story.directorScript[segmentIndex], segmentIndex);
                return this.treeItemCache.get(nodeId);
            }
        }

        return undefined;
    }

    refresh(): void {
        // Clear cache on refresh
        this.treeItemCache.clear();
        this._onDidChangeTreeData.fire();
        logger.info('Story tree refreshed');
    }

    public async revealSegmentVideo(storyId: string, segmentIndex: number): Promise<void> {
        if (!this.treeView) {
            logger.warn('Tree view not initialized, cannot reveal segment');
            return;
        }

        const story = this.storyService.getStory(storyId);
        if (!story || !story.directorScript) {
            logger.warn(`Story ${storyId} not found, cannot reveal segment`);
            return;
        }

        const segment = story.directorScript[segmentIndex];
        if (!segment || !segment.videoPath) {
            logger.warn(`Segment ${segmentIndex} has no video, cannot reveal`);
            return;
        }

        // Use findElementByNodeId to get the cached tree item
        const videoNodeId = `video:${storyId}:${segmentIndex}`;
        const videoItem = await this.findElementByNodeId(videoNodeId);
        
        if (!videoItem) {
            logger.warn(`Could not find video item in cache for ${videoNodeId}`);
            return;
        }

        try {
            // Reveal the video item in the tree with focus and selection
            await this.treeView.reveal(videoItem, {
                select: true,
                focus: true,
                expand: true
            });
            
            // Save the selected segment to state
            if (this.context) {
                const state = this.getTreeViewState();
                state.selectedSegment = {
                    storyId,
                    segmentIndex,
                    videoPath: segment.videoPath
                };
                this.context.workspaceState.update('storyTreeViewState', state);
                logger.info(`💾 Saved selected segment: ${storyId}:${segmentIndex}`);
            }
            
            logger.info(`✅ Revealed segment ${segmentIndex} video in tree view`);
        } catch (error) {
            logger.warn(`Failed to reveal segment video in tree:`, error);
        }
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
        
        return Promise.resolve(validStories.map(story => {
            const nodeId = `story:${story.id}`;
            let item = this.treeItemCache.get(nodeId);
            if (!item) {
                item = new StoryTreeItem(story, 'story', this.storyService);
                this.treeItemCache.set(nodeId, item);
            }
            return item;
        }));
    }

    private getStoryChildren(story: Story): Thenable<StoryTreeItem[]> {
        const children: StoryTreeItem[] = [];
        
        const childTypes: Array<'script' | 'segments' | 'completed' | 'source' | 'assets'> = 
            ['script', 'segments', 'completed', 'source', 'assets'];
        
        for (const type of childTypes) {
            const nodeId = `${type}:${story.id}`;
            let item = this.treeItemCache.get(nodeId);
            if (!item) {
                item = new StoryTreeItem(story, type, this.storyService);
                this.treeItemCache.set(nodeId, item);
            }
            children.push(item);
        }
        
        console.log('🔍 StoryTreeProvider: Created', children.length, 'child elements for story:', story.name);
        
        return Promise.resolve(children);
    }

    private getSegmentChildren(story: Story): Thenable<StoryTreeItem[]> {
        const children: StoryTreeItem[] = [];
        
        if (story.directorScript && story.directorScript.length > 0) {
            story.directorScript.forEach((segment, index) => {
                const nodeId = `segment:${story.id}:${index}`;
                let item = this.treeItemCache.get(nodeId);
                if (!item) {
                    item = new StoryTreeItem(story, 'segment', this.storyService, segment, index);
                    this.treeItemCache.set(nodeId, item);
                }
                children.push(item);
            });
        }
        
        console.log('🔍 StoryTreeProvider: Found', children.length, 'segments for story:', story.name);
        
        return Promise.resolve(children);
    }

    private getSegmentVideoChildren(story: Story, segment: any, segmentIndex?: number): Thenable<StoryTreeItem[]> {
        const children: StoryTreeItem[] = [];
        
        // If segment has a videoPath, add it as a child
        if (segment?.videoPath && fs.existsSync(segment.videoPath)) {
            const nodeId = `video:${story.id}:${segmentIndex}`;
            let item = this.treeItemCache.get(nodeId);
            if (!item) {
                item = new StoryTreeItem(story, 'video', this.storyService, segment, segmentIndex, segment.videoPath);
                this.treeItemCache.set(nodeId, item);
            }
            children.push(item);
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
                // Clicking segment opens segment editor panel
                if (this.segment && this.story?.id && this.segmentIndex !== undefined) {
                    return {
                        command: 'sora.openSegmentEditorPanel',
                        title: 'Open Segment Editor',
                        arguments: [this.story.id, this.segmentIndex]
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
