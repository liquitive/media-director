/**
 * Asset Tree Provider - VSCode tree view for browsing and managing assets
 */

import * as vscode from 'vscode';
import { AssetService, AssetType } from '../services/assetService';
import { Asset } from '../models/story';
import { ProgressManager } from '../services/progressManager';

type AssetTreeItemType = 'category' | 'asset';

export class AssetTreeProvider implements vscode.TreeDataProvider<AssetTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AssetTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<AssetTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AssetTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;
    private progressManager: ProgressManager;

    constructor(private assetService: AssetService) {
        this.progressManager = ProgressManager.getInstance();
        this.setupAutoRefresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    private setupAutoRefresh(): void {
        // Listen for asset extraction completion
        this.progressManager.on('taskCompleted', (data) => {
            const { taskType } = data;
            if (taskType === 'assets') {
                // Refresh tree when assets are extracted
                this.refresh();
            }
        });
    }

    getTreeItem(element: AssetTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AssetTreeItem): Promise<AssetTreeItem[]> {
        if (!element) {
            // Root level: show categories
            return this.getCategoryNodes();
        } else if (element.itemType === 'category' && element.category) {
            // Category level: show assets
            return this.getAssetNodes(element.category);
        }
        return [];
    }

    /**
     * Get category nodes (Characters, Locations, etc.)
     */
    private async getCategoryNodes(): Promise<AssetTreeItem[]> {
        const stats = this.assetService.getAssetStatistics();
        const categories = AssetService.getCategories();
        
        return categories.map(category => {
            const count = stats.by_category[category];
            const displayName = AssetService.getCategoryDisplayName(category);
            
            return new AssetTreeItem(
                `${displayName} (${count})`,
                'category',
                vscode.TreeItemCollapsibleState.Collapsed,
                this.assetService,
                category,
                undefined
            );
        });
    }

    /**
     * Get asset nodes for a specific category
     */
    private async getAssetNodes(category: AssetType): Promise<AssetTreeItem[]> {
        const assets = await this.assetService.getAllAssets(category);
        
        return assets.map(asset => 
            new AssetTreeItem(
                asset.name,
                'asset',
                vscode.TreeItemCollapsibleState.None,
                this.assetService,
                undefined,
                asset
            )
        );
    }

    getParent(element: AssetTreeItem): vscode.ProviderResult<AssetTreeItem> {
        // Simple two-level hierarchy, no parent tracking needed
        return null;
    }
}

export class AssetTreeItem extends vscode.TreeItem {
    public readonly itemType: AssetTreeItemType;
    public readonly category?: AssetType;
    public readonly asset?: Asset;
    private readonly assetService: AssetService;

    constructor(
        label: string,
        itemType: AssetTreeItemType,
        collapsibleState: vscode.TreeItemCollapsibleState,
        assetService: AssetService,
        category?: AssetType,
        asset?: Asset
    ) {
        super(label, collapsibleState);
        
        this.itemType = itemType;
        this.category = category;
        this.asset = asset;
        this.assetService = assetService;
        
        // Set context value for menu filtering
        if (itemType === 'asset') {
            this.contextValue = 'asset';
            this.iconPath = this.getAssetIcon();
            this.description = this.getAssetDescription();
            this.tooltip = this.getAssetTooltip();
            
            // Set command to open asset file with custom editor
            if (asset) {
                this.command = {
                    command: 'vscode.open',
                    title: 'Open Asset Editor',
                    arguments: [vscode.Uri.file(this.getAssetFilePath(asset))]
                };
            }
        } else {
            this.contextValue = 'category';
            this.iconPath = this.getCategoryIcon();
        }
    }

    private getAssetIcon(): vscode.ThemeIcon {
        if (!this.asset) {
            return new vscode.ThemeIcon('file');
        }
        
        switch (this.asset.type) {
            case 'character':
                return new vscode.ThemeIcon('person');
            case 'location':
                return new vscode.ThemeIcon('location');
            case 'item':
                return new vscode.ThemeIcon('package');
            case 'vehicle':
                return new vscode.ThemeIcon('rocket');
            case 'animal':
                return new vscode.ThemeIcon('bug');
            default:
                return new vscode.ThemeIcon('symbol-misc');
        }
    }

    private getCategoryIcon(): vscode.ThemeIcon {
        if (!this.category) {
            return new vscode.ThemeIcon('folder');
        }
        
        switch (this.category) {
            case 'character':
                return new vscode.ThemeIcon('person');
            case 'location':
                return new vscode.ThemeIcon('location');
            case 'item':
                return new vscode.ThemeIcon('package');
            case 'vehicle':
                return new vscode.ThemeIcon('rocket');
            case 'animal':
                return new vscode.ThemeIcon('bug');
            default:
                return new vscode.ThemeIcon('folder');
        }
    }

    private getAssetDescription(): string {
        if (!this.asset) {
            return '';
        }
        
        const parts: string[] = [];
        
        // Add usage count
        if (this.asset.usage_count && this.asset.usage_count > 0) {
            parts.push(`${this.asset.usage_count} ${this.asset.usage_count === 1 ? 'story' : 'stories'}`);
        }
        
        // Add tag count
        if (this.asset.tags && this.asset.tags.length > 0) {
            parts.push(`${this.asset.tags.length} ${this.asset.tags.length === 1 ? 'tag' : 'tags'}`);
        }
        
        return parts.join(' • ');
    }

    private getAssetTooltip(): string {
        if (!this.asset) {
            return '';
        }
        
        let tooltip = `**${this.asset.name}**\n\n`;
        tooltip += `Type: ${this.asset.type}\n`;
        tooltip += `Description: ${this.asset.description}\n\n`;
        
        if (this.asset.tags && this.asset.tags.length > 0) {
            tooltip += `Tags: ${this.asset.tags.join(', ')}\n`;
        }
        
        if (this.asset.usage_count) {
            tooltip += `Used in ${this.asset.usage_count} ${this.asset.usage_count === 1 ? 'story' : 'stories'}\n`;
        }
        
        tooltip += `\nCreated: ${new Date(this.asset.created_at).toLocaleDateString()}`;
        
        if (this.asset.modified_at !== this.asset.created_at) {
            tooltip += `\nModified: ${new Date(this.asset.modified_at).toLocaleDateString()}`;
        }
        
        return tooltip;
    }

    private getAssetFilePath(asset: Asset): string {
        return this.assetService.getAssetFilePath(asset.id, asset.type);
    }
}

