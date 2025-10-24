/**
 * Asset Service - Core module for managing preset assets and characters
 * Handles CRUD operations, indexing, and asset library management
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { Asset } from '../models/story';
import { logger } from '../utils/logger';

// Asset index structure
interface AssetIndex {
    version: string;
    last_updated: string;
    total_assets: number;
    categories: {
        character: number;
        location: number;
        item: number;
        vehicle: number;
        animal: number;
        other: number;
    };
    assets: {
        [id: string]: {
            name: string;
            type: string;
            file: string;
            tags: string[];
        };
    };
}

export type AssetType = 'character' | 'location' | 'item' | 'vehicle' | 'animal' | 'other';

export class AssetService {
    private assetsDir: string;
    private indexFile: string;
    private index: AssetIndex;
    
    // Asset categories (singular forms for consistency with API)
    private static readonly CATEGORIES: AssetType[] = [
        'character', 'location', 'item', 'vehicle', 'animal', 'other'
    ];
    
    // Category to directory mapping (plural form for file system)
    private static readonly CATEGORY_DIRS: { [key in AssetType]: string } = {
        'character': 'characters',
        'location': 'locations',
        'item': 'items',
        'vehicle': 'vehicles',
        'animal': 'animals',
        'other': 'other'
    };
    
    constructor(workspaceRoot: string) {
        this.assetsDir = path.join(workspaceRoot, 'sora-output', 'assets');
        this.indexFile = path.join(this.assetsDir, 'index.json');
        this.index = this.createEmptyIndex();
    }
    
    /**
     * Initialize the asset service
     */
    async initialize(): Promise<void> {
        await this.ensureDirectories();
        this.index = await this.loadIndex();
        logger.info(`Asset Service initialized with ${this.index.total_assets} assets`);
    }
    
    /**
     * Ensure all asset directories exist
     */
    private async ensureDirectories(): Promise<void> {
        // Create main assets directory
        await fsPromises.mkdir(this.assetsDir, { recursive: true });
        
        // Create category directories
        for (const categoryDir of Object.values(AssetService.CATEGORY_DIRS)) {
            const dir = path.join(this.assetsDir, categoryDir);
            await fsPromises.mkdir(dir, { recursive: true });
        }
    }
    
    /**
     * Create an empty index structure
     */
    private createEmptyIndex(): AssetIndex {
        return {
            version: '1.0',
            last_updated: new Date().toISOString(),
            total_assets: 0,
            categories: {
                character: 0,
                location: 0,
                item: 0,
                vehicle: 0,
                animal: 0,
                other: 0
            },
            assets: {}
        };
    }
    
    /**
     * Load the asset index from disk
     */
    private async loadIndex(): Promise<AssetIndex> {
        try {
            if (!fs.existsSync(this.indexFile)) {
                const index = this.createEmptyIndex();
                await this.saveIndex(index);
                return index;
            }
            
            const content = await fsPromises.readFile(this.indexFile, 'utf-8');
            return JSON.parse(content) as AssetIndex;
        } catch (error) {
            logger.error('Error loading asset index:', error);
            throw error;
        }
    }
    
    /**
     * Save the asset index to disk
     */
    private async saveIndex(index?: AssetIndex): Promise<void> {
        const indexToSave = index || this.index;
        indexToSave.last_updated = new Date().toISOString();
        
        try {
            // Ensure the assets directory exists before writing
            await fsPromises.mkdir(this.assetsDir, { recursive: true });
            
            await fsPromises.writeFile(
                this.indexFile,
                JSON.stringify(indexToSave, null, 2),
                'utf-8'
            );
        } catch (error) {
            logger.error('Error saving asset index:', error);
            throw error;
        }
    }
    
    /**
     * Generate a unique asset ID from name and type
     */
    private generateAssetId(name: string, assetType: AssetType): string {
        // Convert name to snake_case
        let cleanName = name.toLowerCase().replace(/[^\w\s-]/g, '');
        cleanName = cleanName.replace(/[-\s]+/g, '_');
        
        let baseId = `${assetType}_${cleanName}`;
        
        // Ensure uniqueness
        let assetId = baseId;
        let counter = 1;
        while (assetId in this.index.assets) {
            assetId = `${baseId}_${counter}`;
            counter++;
        }
        
        return assetId;
    }
    
    /**
     * Get the file path for an asset
     */
    public getAssetFilePath(assetId: string, assetType: AssetType): string {
        const categoryDir = AssetService.CATEGORY_DIRS[assetType];
        return path.join(this.assetsDir, categoryDir, `${assetId}.json`);
    }
    
    /**
     * Normalize numbered descriptions to avoid DALL-E counting issues
     * Converts specific counts to general quantities for visual attributes
     */
    private normalizeNumberedDescriptions(visualAttributes: any): any {
        if (!visualAttributes) {
            return visualAttributes;
        }
        
        const normalized = { ...visualAttributes };
        
        // Common number words to rephrase
        const numberPatterns = [
            { pattern: /\b(one|1)\s+(\w+)/gi, replacement: 'a single $2' },
            { pattern: /\b(two|2)\s+(\w+)/gi, replacement: 'a pair of $2' },
            { pattern: /\b(three|3)\s+(\w+)/gi, replacement: 'several $2' },
            { pattern: /\b(four|4)\s+(\w+)/gi, replacement: 'multiple $2' },
            { pattern: /\b(five|5)\s+(\w+)/gi, replacement: 'multiple $2' },
            { pattern: /\b(six|6)\s+(\w+)/gi, replacement: 'multiple $2' },
            { pattern: /\b(seven|7)\s+(\w+)/gi, replacement: 'a group of $2' },
            { pattern: /\b(eight|8)\s+(\w+)/gi, replacement: 'a group of $2' },
            { pattern: /\b(nine|9)\s+(\w+)/gi, replacement: 'a collection of $2' },
            { pattern: /\b(ten|10)\s+(\w+)/gi, replacement: 'a collection of $2' },
            { pattern: /\b(twelve|12)\s+(\w+)/gi, replacement: 'a collection of $2' },
            { pattern: /\b(twenty|20|24)\s+(\w+)/gi, replacement: 'many $2' }
        ];
        
        // Apply normalization to all string fields
        for (const key in normalized) {
            if (typeof normalized[key] === 'string') {
                let text = normalized[key];
                
                // Apply each pattern
                for (const { pattern, replacement } of numberPatterns) {
                    text = text.replace(pattern, replacement);
                }
                
                normalized[key] = text;
            }
        }
        
        return normalized;
    }
    
    /**
     * Create a new asset
     */
    async createAsset(data: {
        name: string;
        type: AssetType;
        description: string;
        visual_attributes?: Record<string, any>; // Flexible structure supporting extended attributes
        references?: string[];
        tags?: string[];
        indexed_in?: string[];
        storyId?: string;
    }): Promise<Asset> {
        if (!AssetService.CATEGORIES.includes(data.type)) {
            throw new Error(`Invalid asset type: ${data.type}. Must be one of ${AssetService.CATEGORIES.join(', ')}`);
        }
        
        // Generate unique ID
        const assetId = this.generateAssetId(data.name, data.type);
        
        // Normalize numbered descriptions in visual attributes for DALL-E compatibility
        const normalizedVisualAttributes = this.normalizeNumberedDescriptions(data.visual_attributes || {});
        
        // Create asset data
        const now = new Date().toISOString();
        const asset: Asset = {
            id: assetId,
            name: data.name,
            type: data.type,
            description: data.description,
            visual_attributes: normalizedVisualAttributes,
            references: data.references || [],
            tags: data.tags || [],
            indexed_in: data.indexed_in || [],
            created_at: now,
            modified_at: now,
            usage_count: 0,
            stories: data.storyId ? [data.storyId] : []
        };
        
        // Save asset to file
        const assetFile = this.getAssetFilePath(assetId, data.type);
        
        // Ensure the directory exists before writing
        const assetDir = path.dirname(assetFile);
        await fsPromises.mkdir(assetDir, { recursive: true });
        
        await fsPromises.writeFile(
            assetFile,
            JSON.stringify(asset, null, 2),
            'utf-8'
        );
        
        // Update index
        const categoryDir = AssetService.CATEGORY_DIRS[data.type];
        this.index.assets[assetId] = {
            name: data.name,
            type: data.type,
            file: `${categoryDir}/${assetId}.json`,
            tags: data.tags || []
        };
        this.index.total_assets++;
        this.index.categories[data.type]++;
        await this.saveIndex();
        
        logger.info(`Created asset: ${assetId} (${data.name})`);
        return asset;
    }
    
    /**
     * Get an asset by ID
     */
    async getAsset(assetId: string): Promise<Asset | undefined> {
        if (!(assetId in this.index.assets)) {
            logger.warn(`Asset not found: ${assetId}`);
            return undefined;
        }
        
        const indexEntry = this.index.assets[assetId];
        const assetFile = path.join(this.assetsDir, indexEntry.file);
        
        // Check if asset file exists before trying to read it
        try {
            await fsPromises.access(assetFile);
        } catch (error) {
            logger.warn(`Asset file not found: ${assetFile} - removing from index`);
            await this.removeAssetFromIndex(assetId);
            return undefined;
        }
        
        try {
            const content = await fsPromises.readFile(assetFile, 'utf-8');
            return JSON.parse(content) as Asset;
        } catch (error) {
            logger.error(`Error loading asset ${assetId}:`, error);
            return undefined;
        }
    }
    
    /**
     * Remove an asset from the index (when file is missing)
     */
    private async removeAssetFromIndex(assetId: string): Promise<void> {
        if (assetId in this.index.assets) {
            delete this.index.assets[assetId];
            await this.saveIndex();
            logger.info(`Removed missing asset from index: ${assetId}`);
        }
    }

    /**
     * Update an existing asset
     */
    async updateAsset(assetId: string, updates: Partial<Asset>): Promise<boolean> {
        const asset = await this.getAsset(assetId);
        if (!asset) {
            return false;
        }
        
        // Update fields (don't allow changing id or created_at)
        const { id, created_at, ...allowedUpdates } = updates;
        
        // Normalize visual attributes if being updated
        if (allowedUpdates.visual_attributes) {
            allowedUpdates.visual_attributes = this.normalizeNumberedDescriptions(allowedUpdates.visual_attributes);
        }
        
        Object.assign(asset, allowedUpdates);
        asset.modified_at = new Date().toISOString();
        
        // Save updated asset
        const indexEntry = this.index.assets[assetId];
        const assetFile = path.join(this.assetsDir, indexEntry.file);
        
        try {
            await fsPromises.writeFile(
                assetFile,
                JSON.stringify(asset, null, 2),
                'utf-8'
            );
            
            // Update index if name or tags changed
            if (updates.name) {
                this.index.assets[assetId].name = updates.name;
            }
            if (updates.tags) {
                this.index.assets[assetId].tags = updates.tags;
            }
            await this.saveIndex();
            
            logger.info(`Updated asset: ${assetId}`);
            return true;
        } catch (error) {
            logger.error(`Error updating asset ${assetId}:`, error);
            return false;
        }
    }
    
    /**
     * Delete an asset
     */
    async deleteAsset(assetId: string): Promise<boolean> {
        if (!(assetId in this.index.assets)) {
            logger.warn(`Asset not found: ${assetId}`);
            return false;
        }
        
        const indexEntry = this.index.assets[assetId];
        const assetFile = path.join(this.assetsDir, indexEntry.file);
        const assetType = indexEntry.type as AssetType;
        
        try {
            // Delete file
            if (fs.existsSync(assetFile)) {
                await fsPromises.unlink(assetFile);
            }
            
            // Update index
            delete this.index.assets[assetId];
            this.index.total_assets--;
            this.index.categories[assetType]--;
            await this.saveIndex();
            
            logger.info(`Deleted asset: ${assetId}`);
            return true;
        } catch (error) {
            logger.error(`Error deleting asset ${assetId}:`, error);
            return false;
        }
    }
    
    /**
     * Search for assets
     */
    async searchAssets(options?: {
        query?: string;
        type?: AssetType;
        tags?: string[];
        storyId?: string;
    }): Promise<Asset[]> {
        const results: Asset[] = [];
        
        for (const [assetId, indexEntry] of Object.entries(this.index.assets)) {
            // Type filter
            if (options?.type && indexEntry.type !== options.type) {
                continue;
            }
            
            // Tag filter
            if (options?.tags) {
                const assetTags = new Set(indexEntry.tags);
                if (!options.tags.every(tag => assetTags.has(tag))) {
                    continue;
                }
            }
            
            // Load full asset for more detailed filtering
            const asset = await this.getAsset(assetId);
            if (!asset) {
                continue;
            }
            
            // Story filter
            if (options?.storyId && !asset.stories?.includes(options.storyId)) {
                continue;
            }
            
            // Query filter
            if (options?.query) {
                const queryLower = options.query.toLowerCase();
                if (!asset.name.toLowerCase().includes(queryLower) &&
                    !asset.description.toLowerCase().includes(queryLower)) {
                    continue;
                }
            }
            
            results.push(asset);
        }
        
        return results;
    }
    
    /**
     * Get all assets, optionally filtered by type
     */
    async getAllAssets(assetType?: AssetType): Promise<Asset[]> {
        return this.searchAssets({ type: assetType });
    }
    
    /**
     * Add a story reference to an asset
     */
    async addStoryToAsset(assetId: string, storyId: string): Promise<boolean> {
        const asset = await this.getAsset(assetId);
        if (!asset) {
            return false;
        }
        
        if (!asset.stories) {
            asset.stories = [];
        }
        
        if (!asset.stories.includes(storyId)) {
            asset.stories.push(storyId);
            asset.usage_count = asset.stories.length;
            return this.updateAsset(assetId, {
                stories: asset.stories,
                usage_count: asset.usage_count
            });
        }
        
        return true;
    }
    
    /**
     * Get all assets used in a specific story
     */
    async getAssetsForStory(storyId: string): Promise<Asset[]> {
        return this.searchAssets({ storyId });
    }
    
    /**
     * Get statistics about the asset library
     */
    getAssetStatistics(): {
        total_assets: number;
        by_category: {
            character: number;
            location: number;
            item: number;
            vehicle: number;
            animal: number;
            other: number;
        };
        last_updated: string;
    } {
        return {
            total_assets: this.index.total_assets,
            by_category: { ...this.index.categories },
            last_updated: this.index.last_updated
        };
    }
    
    /**
     * Duplicate an existing asset
     */
    async duplicateAsset(assetId: string, newName?: string): Promise<Asset | undefined> {
        const original = await this.getAsset(assetId);
        if (!original) {
            return undefined;
        }
        
        // Create new name
        const name = newName || `Copy of ${original.name}`;
        
        // Create duplicate
        return this.createAsset({
            name,
            type: original.type,
            description: original.description,
            visual_attributes: { ...original.visual_attributes },
            references: [...(original.references || [])],
            tags: [...(original.tags || [])],
            indexed_in: [...(original.indexed_in || [])]
        });
    }
    
    /**
     * Use AI to determine if a new asset is similar enough to an existing one
     * Returns the existing asset if similar, or undefined if a new one should be created
     */
    async findSimilarAssetWithAI(
        newAssetData: {
            name: string;
            type: AssetType;
            description: string;
            visual_attributes?: any;
            tags?: string[];
        },
        storyContext?: string,
        aiService?: any
    ): Promise<Asset | undefined> {
        if (!aiService) {
            logger.info('No AI service provided, skipping intelligent asset matching');
            return undefined;
        }

        // Get all existing assets of the same type
        const existingAssets = await this.searchAssets({ type: newAssetData.type });
        
        if (existingAssets.length === 0) {
            logger.info(`No existing ${newAssetData.type} assets to compare against`);
            return undefined;
        }

        logger.info(`Comparing new asset "${newAssetData.name}" against ${existingAssets.length} existing ${newAssetData.type} assets`);

        try {
            // Build comparison prompt
            const comparisonPrompt = `You are an expert asset manager for a video production system. Your job is to determine if a newly extracted asset is similar enough to an existing asset to reuse it, or if a new asset should be created.

CRITICAL DECISION CRITERIA:
- Assets should be reused if they represent the SAME entity/location/item in the narrative
- Assets should be separate if they represent DIFFERENT entities, even if similar
- Consider: name similarity, description match, visual attributes compatibility, narrative context

NEW ASSET TO BE CREATED:
Name: ${newAssetData.name}
Type: ${newAssetData.type}
Description: ${newAssetData.description}
Visual Attributes: ${JSON.stringify(newAssetData.visual_attributes || {}, null, 2)}
Tags: ${(newAssetData.tags || []).join(', ')}

${storyContext ? `STORY CONTEXT:\n${storyContext.substring(0, 500)}...\n` : ''}

EXISTING ASSETS TO COMPARE AGAINST:
${existingAssets.slice(0, 20).map((asset, idx) => `
${idx + 1}. ${asset.name} (ID: ${asset.id})
   Description: ${asset.description}
   Visual Attributes: ${JSON.stringify(asset.visual_attributes || {}, null, 2).substring(0, 300)}...
   Tags: ${(asset.tags || []).join(', ')}
   Stories Used In: ${(asset.stories || []).length} ${(asset.stories && asset.stories.length > 0) ? `(${asset.stories.slice(0, 2).join(', ')}${asset.stories.length > 2 ? '...' : ''})` : ''}
`).join('\n')}

ANALYSIS REQUIRED:
1. Is the new asset semantically THE SAME as any existing asset?
2. Would using an existing asset maintain visual consistency for the story?
3. Or does this asset need unique characteristics that require a new asset?

DECISION RULES:
- Same biblical figure (e.g., "John the Apostle" = "Soul in Exile" if context matches) → REUSE
- Same location with same characteristics (e.g., "Patmos Island" = "Island of Exile") → REUSE
- Similar but DIFFERENT entities (e.g., "Divine Entity" vs "The Lamb of God" are different divine beings) → CREATE NEW
- Generic names that could be many different things (e.g., "Voice", "Narrator") → Usually CREATE NEW unless context clearly matches
- Same character at different life stages → Usually CREATE NEW (unless story needs consistency)
- Family members vs individual characters → CREATE NEW (they're different people)

Return a JSON object with this structure:
{
    "should_reuse": true/false,
    "existing_asset_id": "asset_id_here" (only if should_reuse is true),
    "confidence": 0.0-1.0 (how confident are you in this decision),
    "reasoning": "Detailed explanation of why this asset should or should not be reused",
    "differences": "If creating new, what are the key differences from similar assets?"
}

Be conservative - when in doubt, CREATE NEW to preserve narrative specificity.`;

            // Get AI decision
            const response = await aiService.getRawText(comparisonPrompt);
            
            // Parse JSON response
            let decision;
            try {
                // Try to extract JSON from response
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    decision = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('No JSON found in response');
                }
            } catch (parseError) {
                logger.warn('Failed to parse AI decision, creating new asset:', parseError);
                return undefined;
            }

            // Log the decision
            logger.info(`AI Asset Comparison Decision: ${decision.should_reuse ? 'REUSE' : 'CREATE NEW'} (confidence: ${decision.confidence})`);
            logger.info(`Reasoning: ${decision.reasoning}`);
            if (decision.differences) {
                logger.info(`Differences: ${decision.differences}`);
            }

            // If AI says to reuse and confidence is high enough, return existing asset
            if (decision.should_reuse && decision.confidence >= 0.7 && decision.existing_asset_id) {
                const existingAsset = await this.getAsset(decision.existing_asset_id);
                if (existingAsset) {
                    logger.info(`✅ Reusing existing asset: ${existingAsset.name} (${existingAsset.id})`);
                    return existingAsset;
                }
            }

            // Otherwise, create new
            logger.info(`✨ Creating new asset: ${newAssetData.name}`);
            return undefined;

        } catch (error) {
            logger.error('AI asset comparison failed, falling back to creating new asset:', error);
            return undefined;
        }
    }

    /**
     * Find an existing asset or create a new one if it doesn't exist
     * Now with AI-powered intelligent matching
     */
    async findOrCreateAsset(
        name: string,
        assetType: AssetType,
        description?: string,
        additionalData?: Partial<Asset>,
        storyContext?: string,
        aiService?: any
    ): Promise<Asset> {
        // Step 1: Check for exact name match (fast path)
        const existing = await this.searchAssets({ query: name, type: assetType });
        
        for (const asset of existing) {
            if (asset.name.toLowerCase() === name.toLowerCase()) {
                logger.info(`Found exact name match: ${asset.id}`);
                return asset;
            }
        }
        
        // Step 2: Use AI to find semantically similar assets
        if (aiService) {
            const similarAsset = await this.findSimilarAssetWithAI(
                {
                    name,
                    type: assetType,
                    description: description || '',
                    visual_attributes: additionalData?.visual_attributes,
                    tags: additionalData?.tags
                },
                storyContext,
                aiService
            );

            if (similarAsset) {
                // Add this story to the existing asset
                if (additionalData?.stories && additionalData.stories.length > 0) {
                    await this.addStoryToAsset(similarAsset.id, additionalData.stories[0]);
                }
                return similarAsset;
            }
        }
        
        // Step 3: Create new asset
        logger.info(`Creating new asset: ${name}`);
        return this.createAsset({
            name,
            type: assetType,
            description: description || '',
            ...additionalData
        });
    }
    
    /**
     * Get all asset categories
     */
    static getCategories(): AssetType[] {
        return [...AssetService.CATEGORIES];
    }
    
    /**
     * Get category display name (plural)
     */
    static getCategoryDisplayName(category: AssetType): string {
        return AssetService.CATEGORY_DIRS[category].charAt(0).toUpperCase() + 
               AssetService.CATEGORY_DIRS[category].slice(1);
    }
    
    /**
     * Check if asset image generation is enabled in settings
     */
    private isAssetImageGenerationEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('sora');
        return config.get<boolean>('generateAssetImages', false);
    }

    /**
     * Generate reference image for any asset using DALL-E
     * Works for characters, vehicles, items, locations, etc.
     */
    async generateCharacterReferenceImage(
        assetId: string,
        openaiService: any
    ): Promise<string | undefined> {
        // Check if asset image generation is enabled
        if (!this.isAssetImageGenerationEnabled()) {
            logger.info(`Asset image generation is disabled in settings. Skipping image generation for ${assetId}`);
            return undefined;
        }
        try {
            const asset = await this.getAsset(assetId);
            if (!asset) {
                logger.error(`Asset ${assetId} not found`);
                return undefined;
            }
            
            // Generate image path
            const categoryDir = AssetService.CATEGORY_DIRS[asset.type];
            const imagesDir = path.join(this.assetsDir, categoryDir, 'images');
            
            // Ensure images directory exists
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
            
            const imagePath = path.join(imagesDir, `${assetId}.png`);
            
            // Generate image using DALL-E
            // Pass the entire asset JSON to provide full context
            logger.info(`Generating reference image for ${asset.type}: ${asset.name}`);
            await openaiService.generateCharacterImage(asset, imagePath);
            
            // Update asset with reference image path
            asset.reference_image = imagePath;
            asset.reference_image_generated = new Date().toISOString();
            await this.updateAsset(assetId, asset);
            
            logger.info(`Reference image generated for ${asset.name}: ${imagePath}`);
            return imagePath;
            
        } catch (error) {
            logger.error(`Error generating reference image for ${assetId}:`, error);
            return undefined;
        }
    }
    
    /**
     * Build comprehensive character description for DALL-E
     * Focuses on concrete, physical descriptions and filters out abstract concepts
     */
    private buildCharacterDescription(asset: Asset): string {
        const parts: string[] = [];
        
        // Start with name
        parts.push(asset.name);
        
        // Add basic description, but ground it if it's too abstract
        if (asset.description) {
            const desc = this.groundDescription(asset.description, asset.type);
            parts.push(desc);
        }
        
        // Add visual attributes - focus on concrete physical details
        const va = asset.visual_attributes;
        if (va.appearance) {
            // Filter out abstract terms like "formless", "ethereal", etc.
            const appearance = this.groundDescription(va.appearance, asset.type);
            parts.push(appearance);
        }
        if (va.colors) {
            parts.push(`Colors: ${va.colors}`);
        }
        if (va.distinguishing_features) {
            // Be careful with metaphorical features
            const features = this.groundDescription(va.distinguishing_features, asset.type);
            if (!features.includes('undefined') && !features.includes('formless')) {
                parts.push(`Features: ${features}`);
            }
        }
        
        // Skip lighting and mood for the reference image - those are for Sora, not DALL-E
        
        return parts.join('. ');
    }
    
    /**
     * Ground abstract descriptions into concrete visual terms
     */
    private groundDescription(text: string, assetType: AssetType): string {
        // For characters that are described as spiritual/divine, provide grounded alternatives
        const lowerText = text.toLowerCase();
        
        // Handle formless/ethereal beings
        if (lowerText.includes('formless') || lowerText.includes('ethereal') || 
            lowerText.includes('spiritual being') || lowerText.includes('omnipotent')) {
            return 'A luminous humanoid figure draped in flowing white robes, with a serene face showing wisdom and authority';
        }
        
        // Handle fire/flame metaphors literally
        if (lowerText.includes('eyes of fire')) {
            text = text.replace(/eyes of fire/gi, 'bright amber-colored eyes');
        }
        if (lowerText.includes('feet of flame') || lowerText.includes('feet like flame')) {
            text = text.replace(/feet (of|like) flame/gi, 'wearing golden sandals');
        }
        
        // Handle divine/radiant descriptions
        if (lowerText.includes('radiant light') || lowerText.includes('divine glow')) {
            text = text.replace(/radiant light/gi, 'soft warm lighting');
            text = text.replace(/divine glow/gi, 'gentle illumination');
        }
        
        // Handle symbolic animals more literally
        if (assetType === 'animal' && (lowerText.includes('symbolic') || lowerText.includes('represents'))) {
            // Just keep the animal type, drop the symbolism
            const animalMatch = text.match(/(lamb|lion|eagle|ox|horse|dove|serpent)/i);
            if (animalMatch) {
                return `A realistic ${animalMatch[1].toLowerCase()} in natural appearance`;
            }
        }
        
        return text;
    }
    
    /**
     * Generate reference images for all visual assets in a story
     * Includes characters, vehicles, items, locations - anything that needs visual consistency
     */
    async generateStoryAssetImages(
        storyId: string,
        openaiService: any,
        progressCallback?: (current: number, total: number, assetName: string) => void
    ): Promise<string[]> {
        // Check if asset image generation is enabled
        if (!this.isAssetImageGenerationEnabled()) {
            logger.info(`Asset image generation is disabled in settings. Skipping image generation for story ${storyId}`);
            return [];
        }

        try {
            // Get all visual assets used in this story
            // Generate images for all asset types for visual consistency
            const allAssets = await this.getAllAssets();
            const storyAssets = allAssets.filter(
                asset => asset.stories?.includes(storyId)
            );
            
            logger.info(`Generating reference images for ${storyAssets.length} assets...`);
            
            const generatedImages: string[] = [];
            
            for (let i = 0; i < storyAssets.length; i++) {
                const asset = storyAssets[i];
                
                // Skip if already has a reference image
                if (asset.reference_image && fs.existsSync(asset.reference_image)) {
                    logger.info(`${asset.type} "${asset.name}" already has reference image`);
                    generatedImages.push(asset.reference_image);
                    continue;
                }
                
                // Notify progress
                if (progressCallback) {
                    progressCallback(i + 1, storyAssets.length, asset.name);
                }
                
                // Generate image
                const imagePath = await this.generateCharacterReferenceImage(asset.id, openaiService);
                if (imagePath) {
                    generatedImages.push(imagePath);
                }
            }
            
            logger.info(`Generated ${generatedImages.length} asset reference images`);
            return generatedImages;
            
        } catch (error) {
            logger.error(`Error generating story asset images:`, error);
            return [];
        }
    }

    /**
     * Clean up orphaned assets (files that don't exist but are in index)
     */
    async cleanupOrphanedAssets(): Promise<{ removed: string[]; errors: string[] }> {
        const removed: string[] = [];
        const errors: string[] = [];
        
        logger.info('Starting asset cleanup - checking for orphaned assets...');
        
        for (const [assetId, indexEntry] of Object.entries(this.index.assets)) {
            const assetFile = path.join(this.assetsDir, indexEntry.file);
            
            try {
                await fsPromises.access(assetFile);
                // File exists, continue
            } catch (error) {
                // File doesn't exist, remove from index
                try {
                    delete this.index.assets[assetId];
                    removed.push(assetId);
                    logger.info(`Removed orphaned asset: ${assetId}`);
                } catch (removeError) {
                    errors.push(`Failed to remove ${assetId}: ${removeError}`);
                }
            }
        }
        
        if (removed.length > 0) {
            await this.saveIndex();
            logger.info(`Asset cleanup complete: removed ${removed.length} orphaned assets`);
        }
        
        return { removed, errors };
    }

    /**
     * Validate all assets in the library
     */
    async validateAssetLibrary(): Promise<{ valid: number; invalid: number; errors: string[] }> {
        let valid = 0;
        let invalid = 0;
        const errors: string[] = [];
        
        logger.info('Validating asset library...');
        
        for (const [assetId, indexEntry] of Object.entries(this.index.assets)) {
            const assetFile = path.join(this.assetsDir, indexEntry.file);
            
            try {
                await fsPromises.access(assetFile);
                const content = await fsPromises.readFile(assetFile, 'utf-8');
                JSON.parse(content); // Validate JSON
                valid++;
            } catch (error) {
                invalid++;
                errors.push(`Invalid asset ${assetId}: ${error}`);
                logger.warn(`Invalid asset ${assetId}: ${error}`);
            }
        }
        
        logger.info(`Asset validation complete: ${valid} valid, ${invalid} invalid`);
        return { valid, invalid, errors };
    }
}

