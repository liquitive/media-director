/**
 * Asset Commands - Commands for managing assets in the asset library
 */

import * as vscode from 'vscode';
import { AssetService, AssetType } from '../services/assetService';
import { AssetTreeProvider } from '../providers/assetTreeProvider';
import { Asset } from '../models/story';
import { Notifications } from '../utils/notifications';
import { logger } from '../utils/logger';

export function registerAssetCommands(
    context: vscode.ExtensionContext,
    assetService: AssetService,
    assetTreeProvider: AssetTreeProvider
): void {
    // View asset details
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.viewAsset', async (assetId: string) => {
            await viewAssetDetails(assetId, assetService);
        })
    );

    // Create new asset manually
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.createAsset', async () => {
            await createAssetWizard(assetService, assetTreeProvider);
        })
    );

    // Edit asset
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.editAsset', async (assetId: string) => {
            await editAsset(assetId, assetService, assetTreeProvider);
        })
    );

    // Delete asset
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.deleteAsset', async (assetId: string) => {
            await deleteAsset(assetId, assetService, assetTreeProvider);
        })
    );

    // Search assets
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.searchAssets', async () => {
            await searchAssetsCommand(assetService);
        })
    );

    // Refresh asset library
    context.subscriptions.push(
        vscode.commands.registerCommand('sora.refreshAssets', () => {
            assetTreeProvider.refresh();
            Notifications.log('🔄 Asset library refreshed');
        })
    );

    logger.info('Asset commands registered successfully');
}

/**
 * View asset details in a quickpick
 */
async function viewAssetDetails(assetId: string, assetService: AssetService): Promise<void> {
    const asset = await assetService.getAsset(assetId);
    if (!asset) {
        Notifications.error('Asset not found');
        return;
    }

    // Show asset details in a webview or information message
    const message = formatAssetDetails(asset);
    
    const action = await vscode.window.showInformationMessage(
        message,
        'Edit',
        'Delete',
        'Duplicate'
    );

    if (action === 'Edit') {
        await editAsset(assetId, assetService, undefined);
    } else if (action === 'Delete') {
        await deleteAsset(assetId, assetService, undefined);
    } else if (action === 'Duplicate') {
        await duplicateAsset(assetId, assetService);
    }
}

/**
 * Format asset details for display
 */
function formatAssetDetails(asset: Asset): string {
    let details = `${asset.name} (${asset.type})\n\n`;
    details += `${asset.description}\n\n`;
    
    if (asset.visual_attributes && Object.keys(asset.visual_attributes).length > 0) {
        details += 'Visual Attributes:\n';
        for (const [key, value] of Object.entries(asset.visual_attributes)) {
            if (value) {
                details += `  • ${key}: ${value}\n`;
            }
        }
        details += '\n';
    }
    
    if (asset.tags && asset.tags.length > 0) {
        details += `Tags: ${asset.tags.join(', ')}\n`;
    }
    
    if (asset.usage_count) {
        details += `Used in ${asset.usage_count} ${asset.usage_count === 1 ? 'story' : 'stories'}\n`;
    }
    
    return details;
}

/**
 * Create new asset wizard
 */
async function createAssetWizard(
    assetService: AssetService,
    assetTreeProvider?: AssetTreeProvider
): Promise<void> {
    try {
        // Step 1: Asset name
        const name = await vscode.window.showInputBox({
            prompt: 'Enter asset name',
            placeHolder: 'e.g., "John the Apostle", "Ancient Temple", "Sword of Light"',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Asset name is required';
                }
                return undefined;
            }
        });

        if (!name) return;

        // Step 2: Asset type
        const typeOptions: { label: string; value: AssetType }[] = [
            { label: 'Character', value: 'character' },
            { label: 'Location', value: 'location' },
            { label: 'Item', value: 'item' },
            { label: 'Vehicle', value: 'vehicle' },
            { label: 'Animal', value: 'animal' },
            { label: 'Other', value: 'other' }
        ];

        const selectedType = await vscode.window.showQuickPick(typeOptions, {
            placeHolder: 'Select asset type'
        });

        if (!selectedType) return;

        // Step 3: Description
        const description = await vscode.window.showInputBox({
            prompt: 'Enter a description',
            placeHolder: 'Brief description of the asset...',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Description is required';
                }
                return undefined;
            }
        });

        if (!description) return;

        // Step 4: Tags (optional)
        const tagsInput = await vscode.window.showInputBox({
            prompt: 'Enter tags (comma-separated, optional)',
            placeHolder: 'e.g., biblical, ancient, protagonist'
        });

        const tags = tagsInput
            ? tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0)
            : [];

        // Create the asset
        await assetService.createAsset({
            name,
            type: selectedType.value,
            description,
            tags
        });

        if (assetTreeProvider) {
            assetTreeProvider.refresh();
        }

        Notifications.log(`✅ Asset "${name}" created successfully!`);
        logger.info(`Created asset: ${name} (${selectedType.value})`);
    } catch (error) {
        logger.error('Failed to create asset:', error);
        Notifications.error('Failed to create asset', error);
    }
}

/**
 * Edit an existing asset
 */
async function editAsset(
    assetId: string,
    assetService: AssetService,
    assetTreeProvider?: AssetTreeProvider
): Promise<void> {
    const asset = await assetService.getAsset(assetId);
    if (!asset) {
        Notifications.error('Asset not found');
        return;
    }

    try {
        // Edit name
        const newName = await vscode.window.showInputBox({
            prompt: 'Edit asset name',
            value: asset.name,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Asset name is required';
                }
                return undefined;
            }
        });

        if (!newName) return;

        // Edit description
        const newDescription = await vscode.window.showInputBox({
            prompt: 'Edit description',
            value: asset.description,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Description is required';
                }
                return undefined;
            }
        });

        if (!newDescription) return;

        // Edit tags
        const newTagsInput = await vscode.window.showInputBox({
            prompt: 'Edit tags (comma-separated)',
            value: asset.tags?.join(', ') || ''
        });

        const newTags = newTagsInput
            ? newTagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0)
            : [];

        // Update the asset
        await assetService.updateAsset(assetId, {
            name: newName,
            description: newDescription,
            tags: newTags
        });

        if (assetTreeProvider) {
            assetTreeProvider.refresh();
        }

        Notifications.log(`✅ Asset "${newName}" updated successfully!`);
        logger.info(`Updated asset: ${assetId}`);
    } catch (error) {
        logger.error('Failed to edit asset:', error);
        Notifications.error('Failed to edit asset', error);
    }
}

/**
 * Delete an asset
 */
async function deleteAsset(
    assetId: string,
    assetService: AssetService,
    assetTreeProvider?: AssetTreeProvider
): Promise<void> {
    const asset = await assetService.getAsset(assetId);
    if (!asset) {
        Notifications.error('Asset not found');
        return;
    }

    const confirmed = await Notifications.confirm(
        `Are you sure you want to delete "${asset.name}"? This action cannot be undone.`,
        'Delete',
        'Cancel'
    );

    if (!confirmed) {
        return;
    }

    try {
        await assetService.deleteAsset(assetId);

        if (assetTreeProvider) {
            assetTreeProvider.refresh();
        }

        Notifications.log(`🗑️ Asset "${asset.name}" deleted successfully`);
        logger.info(`Deleted asset: ${assetId}`);
    } catch (error) {
        logger.error('Failed to delete asset:', error);
        Notifications.error('Failed to delete asset', error);
    }
}

/**
 * Duplicate an asset
 */
async function duplicateAsset(
    assetId: string,
    assetService: AssetService
): Promise<void> {
    const asset = await assetService.getAsset(assetId);
    if (!asset) {
        Notifications.error('Asset not found');
        return;
    }

    try {
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter name for the duplicate',
            value: `Copy of ${asset.name}`,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Name is required';
                }
                return undefined;
            }
        });

        if (!newName) return;

        await assetService.duplicateAsset(assetId, newName);
        Notifications.log(`✅ Asset duplicated as "${newName}"`);
        logger.info(`Duplicated asset: ${assetId} -> ${newName}`);
    } catch (error) {
        logger.error('Failed to duplicate asset:', error);
        Notifications.error('Failed to duplicate asset', error);
    }
}

/**
 * Search assets command
 */
async function searchAssetsCommand(assetService: AssetService): Promise<void> {
    const query = await vscode.window.showInputBox({
        prompt: 'Search assets by name or description',
        placeHolder: 'Enter search term...'
    });

    if (!query) return;

    try {
        const results = await assetService.searchAssets({ query });

        if (results.length === 0) {
            Notifications.log(`🔍 No assets found matching "${query}"`, true);
            return;
        }

        // Show results in quickpick
        const items = results.map(asset => ({
            label: asset.name,
            description: asset.type,
            detail: asset.description,
            asset: asset
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Found ${results.length} ${results.length === 1 ? 'asset' : 'assets'}`
        });

        if (selected) {
            await viewAssetDetails(selected.asset.id, assetService);
        }
    } catch (error) {
        logger.error('Asset search failed:', error);
        Notifications.error('Asset search failed', error);
    }
}

