/**
 * AI Service Abstraction Layer
 * Routes text tasks to IDE AI (Cursor/Copilot) when available,
 * and always uses OpenAI for media tasks (Whisper, Sora, DALL-E)
 */

import { OpenAIService } from './openaiService';
import { IDEAIProvider } from './ideAIProvider';
import { OpenAITextProvider } from './openaiTextProvider';
import { logger } from '../utils/logger';

export interface ITextAIProvider {
    isAvailable(): Promise<boolean>;
    generateDirectorScript(transcription: string, audioAnalysis?: any, assetLibrary?: any[]): Promise<any>;
    analyzeContent(content: string): Promise<any>;
    getRawText(prompt: string): Promise<string>;
    extractAssets(content: string, audioAnalysis?: any, progressManager?: any, parentTaskId?: string): Promise<any[]>;
    selectBestVisualStyle(transcription: string): Promise<string>;
}

export class AIService {
    private textProvider!: ITextAIProvider;
    private openaiService: OpenAIService;
    
    constructor(apiKey: string) {
        this.openaiService = new OpenAIService(apiKey);
    }
    
    async initialize(): Promise<void> {
        // Try IDE AI for text tasks
        const ideProvider = new IDEAIProvider();
        if (await ideProvider.isAvailable()) {
            this.textProvider = ideProvider;
            logger.info('✅ Using IDE AI for text generation tasks');
        } else {
            // Fall back to OpenAI for text too
            this.textProvider = new OpenAITextProvider(this.openaiService);
            logger.info('✅ Using OpenAI GPT-4 for text generation tasks');
        }
    }
    
    // Text tasks - use IDE AI or OpenAI GPT-4
    async generateDirectorScript(transcription: string, audioAnalysis?: any, assetLibrary?: any[]): Promise<any> {
        return this.textProvider.generateDirectorScript(transcription, audioAnalysis, assetLibrary);
    }
    
    async analyzeContent(content: string): Promise<any> {
        return this.textProvider.analyzeContent(content);
    }

    async getRawText(prompt: string): Promise<string> {
        return this.textProvider.getRawText(prompt);
    }
    
    async extractAssets(content: string, audioAnalysis?: any, progressManager?: any, parentTaskId?: string): Promise<any[]> {
        return this.textProvider.extractAssets(content, audioAnalysis, progressManager, parentTaskId);
    }
    
    // Media tasks - always use OpenAI
    async transcribeAudio(audioPath: string): Promise<any> {
        return this.openaiService.transcribeAudio(audioPath);
    }
    
    async transcribeAudioChunks(chunkPaths: string[]): Promise<any> {
        return this.openaiService.transcribeAudioChunks(chunkPaths);
    }
    
    // Video generation would use OpenAI Sora API when available
    async generateVideo(prompt: string, duration: number): Promise<any> {
        // TODO: Implement when Sora API is available
        throw new Error('Video generation not yet implemented');
    }
    
    getTextProviderName(): string {
        return this.textProvider instanceof IDEAIProvider ? 'IDE AI (Cursor/Copilot)' : 'OpenAI GPT-4';
    }
    
    getProviderInfo(): { textProvider: string; mediaProvider: string } {
        return {
            textProvider: this.getTextProviderName(),
            mediaProvider: 'OpenAI (Whisper, Sora, DALL-E)'
        };
    }
    
    // Get direct access to OpenAI service for video generation
    getOpenAIService(): OpenAIService {
        return this.openaiService;
    }

    async selectBestVisualStyle(transcription: string): Promise<string> {
        return this.textProvider.selectBestVisualStyle(transcription);
    }

    /**
     * Validate segments for narrative consistency
     * Used by segment validation service before video generation
     */
    async validateSegments(prompt: string): Promise<string> {
        return this.textProvider.getRawText(prompt);
    }

    /**
     * Extract story analysis from AI response by traversing the object structure
     */
    private extractStoryAnalysis(response: any): any {
        const fallback = {
            title: 'Unknown Story',
            theme: 'Unknown theme',
            mood: 'Unknown mood',
            visualStyle: 'Generic cinematic',
            colorPalette: 'Generic colors',
            mainCharacter: 'Unknown character',
            setting: 'Unknown setting',
            narrativePerspective: 'First person',
            storyElements: ['Unknown story elements'],
            tone: 'Unknown tone',
            context: 'Story analysis failed - using fallback values'
        };

        try {
            // If response is a string, try to parse it
            if (typeof response === 'string') {
                const parsed = JSON.parse(response);
                return this.traverseForStoryAnalysis(parsed) || fallback;
            }
            
            // If response is an object/array, traverse it directly
            if (typeof response === 'object' && response !== null) {
                return this.traverseForStoryAnalysis(response) || fallback;
            }
            
            logger.warn(`Unexpected story analysis response type: ${typeof response}`);
            return fallback;
        } catch (error) {
            logger.error(`Failed to extract story analysis:`, error);
            return fallback;
        }
    }

    /**
     * Extract visual descriptions from AI response by traversing the object structure
     */
    private extractVisualDescriptions(response: any, expectedCount: number): any[] {
        try {
            // If response is a string, try to parse it
            if (typeof response === 'string') {
                const parsed = JSON.parse(response);
                return this.traverseForVisualDescriptions(parsed, expectedCount);
            }
            
            // If response is an object/array, traverse it directly
            if (typeof response === 'object' && response !== null) {
                return this.traverseForVisualDescriptions(response, expectedCount);
            }
            
            logger.warn(`Unexpected visual response type: ${typeof response}`);
            return [];
        } catch (error) {
            logger.error(`Failed to extract visual descriptions:`, error);
            return [];
        }
    }

    /**
     * Traverse object to find story analysis fields
     */
    private traverseForStoryAnalysis(obj: any): any | null {
        if (!obj || typeof obj !== 'object') return null;

        // Direct match
        if (obj.title && obj.theme && obj.mood && obj.visualStyle && obj.colorPalette && obj.mainCharacter && obj.setting) {
            return {
                title: String(obj.title),
                theme: String(obj.theme),
                mood: String(obj.mood),
                visualStyle: String(obj.visualStyle),
                colorPalette: String(obj.colorPalette),
                mainCharacter: String(obj.mainCharacter),
                setting: String(obj.setting),
                narrativePerspective: String(obj.narrativePerspective || 'First person'),
                storyElements: Array.isArray(obj.storyElements) ? obj.storyElements : [String(obj.storyElements || 'Key story elements')],
                tone: String(obj.tone || 'Dramatic'),
                context: String(obj.context || 'Story context not provided')
            };
        }

        // If it's an array, check first element
        if (Array.isArray(obj) && obj.length > 0) {
            return this.traverseForStoryAnalysis(obj[0]);
        }

        // Recursively search in nested objects
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const result = this.traverseForStoryAnalysis(obj[key]);
                if (result) return result;
            }
        }

        return null;
    }

    /**
     * Traverse object to find visual description array
     */
    private traverseForVisualDescriptions(obj: any, expectedCount: number): any[] {
        if (!obj || typeof obj !== 'object') return [];

        // Direct array match
        if (Array.isArray(obj) && this.isVisualDescriptionArray(obj)) {
            return obj.slice(0, expectedCount);
        }

        // Look for segments property
        if (obj.segments && Array.isArray(obj.segments) && this.isVisualDescriptionArray(obj.segments)) {
            return obj.segments.slice(0, expectedCount);
        }

        // If it's an array, check first element
        if (Array.isArray(obj) && obj.length > 0) {
            return this.traverseForVisualDescriptions(obj[0], expectedCount);
        }

        // Recursively search in nested objects
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const result = this.traverseForVisualDescriptions(obj[key], expectedCount);
                if (result.length > 0) return result;
            }
        }

        return [];
    }

    /**
     * Check if array contains valid visual descriptions
     */
    private isVisualDescriptionArray(arr: any[]): boolean {
        if (!Array.isArray(arr) || arr.length === 0) return false;
        
        // Check if first element has visual description structure
        const first = arr[0];
        return first && 
               typeof first === 'object' && 
               (first.visualPrompt || first.visual || first.description) &&
               (first.cameraWork || first.camera || first.cameraMovement);
    }

    /**
     * Generate AI-based asset mapping for context-aware entity matching
     * Uses AI to intelligently map story mentions to assets based on narrative context
     */
    private async generateAssetMapping(
        transcription: string,
        researchText: string | undefined,
        storyAnalysis: any,
        assetLibrary: any[]
    ): Promise<any> {
        // Build minimal asset references (just ID, name, type, tags)
        const assetRefs = assetLibrary.map(asset => ({
            id: asset.id,
            name: asset.name,
            type: asset.type,
            tags: asset.tags || []
        }));

        // Keep research context brief (first 800 chars)
        const researchSnippet = researchText ? researchText.substring(0, 800) : '';

        const mappingPrompt = `Map story entities to asset references for ${storyAnalysis.title}.

MAIN CHARACTER: ${storyAnalysis.mainCharacter}
THEME: ${storyAnalysis.theme}
CONTEXT: ${storyAnalysis.context}

TRANSCRIPT (excerpt):
${transcription.substring(0, 600)}

${researchSnippet ? `RESEARCH:\n${researchSnippet}\n\n` : ''}AVAILABLE ASSETS (by reference):
${JSON.stringify(assetRefs, null, 1)}

Task: Create mappings for:
1. mainCharacter: which asset ID represents the protagonist
2. genericTerms: map generic mentions to asset IDs
   Examples: "protagonist", "main character", "the soul", "unnamed", "narrator", "witness"
3. entityMentions: map named entities to asset IDs
   Examples: "michael", "the voice", "the woman", "the dragon"

Consider biblical/historical context and character roles.

Return ONLY valid JSON:
{"mainCharacter":"asset_id","genericTerms":{},"entityMentions":{}}`;

        try {
            const mappingText = await this.textProvider.getRawText(mappingPrompt);
            logger.info(`Asset mapping raw response: ${mappingText.substring(0, 500)}...`);
            
            // Parse JSON from response
            const mapping = this.parseJsonFromText(mappingText);
            return mapping || { mainCharacter: null, genericTerms: {}, entityMentions: {} };
        } catch (error) {
            logger.error('Asset mapping generation failed:', error);
            return { mainCharacter: null, genericTerms: {}, entityMentions: {} };
        }
    }

    /**
     * Parse JSON from AI text response (handles markdown code blocks, etc.)
     */
    private parseJsonFromText(text: string): any {
        try {
            // Try direct parse first
            return JSON.parse(text);
        } catch (e) {
            // Try extracting from markdown code block
            const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1]);
            }
            
            // Try finding JSON object in text
            const objectMatch = text.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                return JSON.parse(objectMatch[0]);
            }
            
            throw new Error('No valid JSON found in response');
        }
    }

    /**
     * Inject character descriptions into visual prompts
     * Detects character mentions and replaces them with full descriptions from assets
     */
    private injectCharacterDescriptions(
        visualPrompt: string,
        segmentText: string,
        characters: any[],
        assetLibrary?: any[],
        mainCharacterName?: string,
        assetMapping?: any
    ): string {
        let enhancedPrompt = visualPrompt;
        const context = `${visualPrompt} ${segmentText}`.toLowerCase();
        const injectedEntities = new Set<string>(); // Track what we've already injected

        // Step 1: Use AI-generated mapping to inject character descriptions
        if (assetMapping && assetLibrary) {
            logger.info('Using AI-generated asset mapping for intelligent entity injection');
            
            // 1a. Handle generic terms first (protagonist, main character, etc.)
            if (assetMapping.genericTerms) {
                for (const [term, assetId] of Object.entries(assetMapping.genericTerms)) {
                    const termLower = term.toLowerCase();
                    if (context.includes(termLower)) {
                        // Find the asset
                        const asset = assetLibrary.find((a: any) => a.id === assetId);
                        if (asset) {
                            logger.info(`Found generic term "${term}" → asset "${asset.name}"`);
                            
                            // Build full description
                            const fullDesc = this.buildAssetDescription(asset);
                            
                            // Replace the generic term (FIRST OCCURRENCE ONLY)
                            const pattern = new RegExp(`\\b${this.escapeRegex(term)}\\b`, 'i'); // Remove 'g' flag
                            if (pattern.test(enhancedPrompt)) {
                                enhancedPrompt = enhancedPrompt.replace(pattern, `${asset.name} (${fullDesc})`);
                                logger.info(`✅ Injected asset "${asset.name}" for generic term "${term}" (first occurrence only)`);
                                injectedEntities.add(asset.name.toLowerCase());
                            }
                        }
                    }
                }
            }
            
            // 1b. Handle specific entity mentions
            if (assetMapping.entityMentions) {
                for (const [mention, assetId] of Object.entries(assetMapping.entityMentions)) {
                    const mentionLower = mention.toLowerCase();
                    if (context.includes(mentionLower) && !injectedEntities.has(mentionLower)) {
                        // Find the asset
                        const asset = assetLibrary.find((a: any) => a.id === assetId);
                        if (asset) {
                            logger.info(`Found entity mention "${mention}" → asset "${asset.name}"`);
                            
                            // Build full description
                            const fullDesc = this.buildAssetDescription(asset);
                            
                            // Replace the mention
                            enhancedPrompt = this.replaceEntityInPrompt(
                                enhancedPrompt,
                                mention,
                                fullDesc,
                                asset.type
                            );
                            injectedEntities.add(asset.name.toLowerCase());
                        }
                    }
                }
            }
        }
        
        // Step 2: Fallback to character list for any not handled by mapping
        if (characters && characters.length > 0) {
            for (const char of characters) {
                const charName = char.name || '';
                const charNameLower = charName.toLowerCase();
                
                // Skip if already injected
                if (injectedEntities.has(charNameLower)) {
                    continue;
                }
                
                // Check if character is mentioned directly
                if (context.includes(charNameLower)) {
                    logger.info(`Found direct character mention: "${charName}"`);
                    
                    const fullDescription = char.description || '';
                    enhancedPrompt = this.replaceEntityInPrompt(
                        enhancedPrompt,
                        charName,
                        fullDescription,
                        'character'
                    );
                    injectedEntities.add(charNameLower);
                }
            }
        }

        // Step 2: Inject descriptions for ALL other assets (animals, locations, objects, etc.)
        if (assetLibrary && assetLibrary.length > 0) {
            for (const asset of assetLibrary) {
                const assetName = asset.name || '';
                const assetNameLower = assetName.toLowerCase();
                
                // Skip if already injected as a character
                if (injectedEntities.has(assetNameLower)) {
                    continue;
                }
                
                // Check if asset is mentioned
                if (!context.includes(assetNameLower)) {
                    continue;
                }

                logger.info(`Found asset mention: "${assetName}" (${asset.type}) in segment`);

                // Build comprehensive description from asset
                const visualAttrs = asset.visual_attributes || {};
                const descParts: string[] = [];
                
                if (asset.description) {
                    descParts.push(asset.description);
                }
                if (visualAttrs.appearance) {
                    descParts.push(visualAttrs.appearance);
                }
                if (visualAttrs.colors) {
                    descParts.push(`Colors: ${visualAttrs.colors}`);
                }
                if (visualAttrs.distinguishing_features) {
                    descParts.push(visualAttrs.distinguishing_features);
                }
                
                const fullDescription = descParts.filter(p => p).join('. ');
                
                if (fullDescription) {
                    enhancedPrompt = this.replaceEntityInPrompt(
                        enhancedPrompt,
                        assetName,
                        fullDescription,
                        asset.type
                    );
                    
                    injectedEntities.add(assetNameLower);
                }
            }
        }

        return enhancedPrompt;
    }

    /**
     * Replace entity mentions in prompt with full descriptions
     */
    private replaceEntityInPrompt(
        prompt: string,
        entityName: string,
        description: string,
        type: string
    ): string {
        // Look for various mentions: "Michael", "the Dragon", "Dragon", etc.
        const patterns = [
            new RegExp(`\\b${this.escapeRegex(entityName)}\\b(?! \\()`, 'i'), // "Michael" but not "Michael ("
            new RegExp(`\\bthe ${this.escapeRegex(entityName)}\\b(?! \\()`, 'i'),
        ];

        for (const pattern of patterns) {
            const match = prompt.match(pattern);
            if (match) {
                // Replace first occurrence with full description
                prompt = prompt.replace(pattern, `${entityName} (${description})`);
                logger.info(`✅ Injected ${type} description for "${entityName}"`);
                break;
            }
        }

        return prompt;
    }

    /**
     * Build comprehensive description from asset metadata
     */
    private buildAssetDescription(asset: any): string {
        const visualAttrs = asset.visual_attributes || {};
        const descParts: string[] = [];
        
        if (asset.description) {
            descParts.push(asset.description);
        }
        if (visualAttrs.appearance) {
            descParts.push(visualAttrs.appearance);
        }
        if (visualAttrs.colors) {
            descParts.push(`Colors: ${visualAttrs.colors}`);
        }
        if (visualAttrs.distinguishing_features) {
            descParts.push(visualAttrs.distinguishing_features);
        }
        
        return descParts.filter(p => p).join('. ');
    }

    /**
     * Build tag from asset name
     */
    private buildTagFromName(name: string | undefined): string {
        const core = String(name || '')
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return `[[${core}]]`;
    }

    /**
     * Remove long parenthetical descriptions and replace asset names with @tags
     */
    private sanitizeVisualPromptTags(visualPrompt: string, assetLibrary?: any[]): string {
        if (!visualPrompt) return visualPrompt;

        // Remove long parentheses blocks (likely embedded descriptions)
        let sanitized = visualPrompt.replace(/\([^)]{30,}\)/g, '');

        // 1) Collapse any excessive bracket runs to exactly [[...]] / ]]
        sanitized = sanitized.replace(/\[{3,}/g, '[['); // [[[+ -> [[
        sanitized = sanitized.replace(/\]{3,}/g, ']]'); // ]]]+ -> ]]

        // 2) Convert any @ or @@ tokens to [[tag]] (token = up to whitespace or bracket)
        const normalizeCore = (s: string) => s
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, '_')
            .replace(/^_+|_+$/g, '');

        sanitized = sanitized.replace(/@{1,2}\s*([^\s\]\[]+)/gi, (_m, g1) => `[[${normalizeCore(String(g1))}]]`);

        // 3) Standardize any existing bracket tags [[ ... ]] to canonical [[token]]
        sanitized = sanitized.replace(/\[\[\s*([^\]\[]+?)\s*\]\]/gi, (_m, g1) => `[[${normalizeCore(String(g1))}]]`);

        // 4) Optionally replace plain asset names with tags (first occurrence), to encourage consistency
        if (assetLibrary && assetLibrary.length > 0) {
            for (const asset of assetLibrary) {
                if (!asset?.name) continue;
                const core = normalizeCore(String(asset.name));
                const tag = `[[${core}]]`;
                const name = String(asset.name);
                const patterns = [
                    new RegExp(`\\b${this.escapeRegex(name)}\\b(?!\n)`, 'i'),
                    new RegExp(`\\bthe ${this.escapeRegex(name)}\\b(?!\n)`, 'i')
                ];
                for (const pattern of patterns) {
                    if (pattern.test(sanitized)) {
                        sanitized = sanitized.replace(pattern, tag);
                        break;
                    }
                }
            }
        }

        // 5) Collapse extra whitespace
        sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();
        return sanitized;
    }

    /**
     * Clamp visualPrompt length sensibly
     */
    private limitVisualPromptLength(prompt: string, maxLength: number = 420): string {
        if (!prompt) return prompt;
        if (prompt.length <= maxLength) return prompt.trim();
        const cutoff = prompt.substring(0, maxLength);
        const lastPeriod = cutoff.lastIndexOf('.');
        const lastComma = cutoff.lastIndexOf(',');
        const cutPoint = lastPeriod > maxLength * 0.6 ? lastPeriod + 1 : (lastComma > maxLength * 0.6 ? lastComma : maxLength);
        return cutoff.substring(0, cutPoint).trim();
    }

    /**
     * Extract used asset IDs from the prompt by detecting @tags or names
     */
    private computeUsedAssetsFromPrompt(visualPrompt: string, assetLibrary?: any[], protagonistAssetId?: string): string[] {
        const used = new Set<string>();
        if (!assetLibrary || assetLibrary.length === 0) return [];
        const promptLower = visualPrompt.toLowerCase();
        
        // Always include protagonist asset if available and the prompt mentions protagonist-related terms
        if (protagonistAssetId && this.isProtagonistMentioned(visualPrompt)) {
            used.add(protagonistAssetId);
        }
        
        for (const asset of assetLibrary) {
            const id = String(asset.id || '');
            const tag = this.buildTagFromName(asset.name);
            const nameLower = String(asset.name || '').toLowerCase();
            if (!id) continue;
            if (promptLower.includes(tag.toLowerCase()) || (nameLower && promptLower.includes(nameLower))) {
                used.add(id);
            }
        }

        // Reorder so protagonist (if present) is first
        const list = Array.from(used);
        if (protagonistAssetId && list.includes(protagonistAssetId)) {
            const idx = list.indexOf(protagonistAssetId);
            if (idx > 0) {
                list.splice(idx, 1);
                list.unshift(protagonistAssetId);
            }
        }
        return list;
    }
    
    /**
     * Check if the visual prompt mentions protagonist-related terms
     */
    private isProtagonistMentioned(visualPrompt: string): boolean {
        const promptLower = visualPrompt.toLowerCase();
        const protagonistTerms = [
            'protagonist', 'narrator', 'unnamed protagonist', 'main character',
            'the protagonist', 'the narrator', 'character', 'person', 'individual',
            'he', 'she', 'they', 'him', 'her', 'them', 'his', 'hers', 'theirs'
        ];
        
        return protagonistTerms.some(term => promptLower.includes(term));
    }

    /**
     * Escape special regex characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Enhance character descriptions with rich metadata from asset library
     * Combines AI-extracted descriptions with stored character assets
     */
    private enhanceCharactersWithAssets(characters: any[], assetLibrary: any[]): any[] {
        if (!characters || characters.length === 0) {
            logger.info('No characters to enhance');
            return characters || [];
        }

        // Filter character assets from library
        const characterAssets = assetLibrary.filter(asset => 
            asset.type === 'character' || 
            asset.id?.startsWith('character_') ||
            asset.indexed_in?.includes('characters')
        );

        logger.info(`Found ${characterAssets.length} character assets in library`);

        // Enhance each character with asset metadata
        const enhancedCharacters = characters.map(char => {
            // Try to find matching asset by name
            const matchingAsset = characterAssets.find(asset => {
                const assetName = asset.name?.toLowerCase() || '';
                const charName = char.name?.toLowerCase() || '';
                return assetName.includes(charName) || charName.includes(assetName);
            });

            if (matchingAsset) {
                logger.info(`Enhancing character "${char.name}" with asset "${matchingAsset.name}"`);
                
                // Build comprehensive description from asset visual attributes
                const visualAttrs = matchingAsset.visual_attributes || {};
                const assetDesc = matchingAsset.description || '';
                
                const enhancedParts: string[] = [];
                
                // Start with base description
                if (char.description) {
                    enhancedParts.push(char.description);
                }
                
                // Add asset description
                if (assetDesc && !char.description?.includes(assetDesc)) {
                    enhancedParts.push(assetDesc);
                }
                
                // Add visual attributes
                if (visualAttrs.appearance) {
                    enhancedParts.push(`Appearance: ${visualAttrs.appearance}`);
                }
                if (visualAttrs.colors) {
                    enhancedParts.push(`Colors: ${visualAttrs.colors}`);
                }
                if (visualAttrs.distinguishing_features) {
                    enhancedParts.push(`Distinguishing features: ${visualAttrs.distinguishing_features}`);
                }
                if (visualAttrs.typical_lighting) {
                    enhancedParts.push(`Typical lighting: ${visualAttrs.typical_lighting}`);
                }
                if (visualAttrs.mood) {
                    enhancedParts.push(`Mood: ${visualAttrs.mood}`);
                }
                
                // Combine all parts into rich description
                const enhancedDescription = enhancedParts.filter(p => p).join('. ');
                
                return {
                    name: char.name,
                    description: enhancedDescription,
                    assetId: matchingAsset.id,
                    tags: matchingAsset.tags || []
                };
            }

            // No matching asset, return original
            logger.info(`No asset match found for character "${char.name}"`);
            return char;
        });

        // Also add any character assets that weren't matched
        const unmatchedAssets = characterAssets.filter(asset => {
            return !enhancedCharacters.some(char => 
                char.assetId === asset.id
            );
        });

        if (unmatchedAssets.length > 0) {
            logger.info(`Adding ${unmatchedAssets.length} unmatched character assets`);
            unmatchedAssets.forEach(asset => {
                const visualAttrs = asset.visual_attributes || {};
                const descParts: string[] = [];
                
                if (asset.description) {
                    descParts.push(asset.description);
                }
                if (visualAttrs.appearance) {
                    descParts.push(`Appearance: ${visualAttrs.appearance}`);
                }
                if (visualAttrs.colors) {
                    descParts.push(`Colors: ${visualAttrs.colors}`);
                }
                if (visualAttrs.distinguishing_features) {
                    descParts.push(`Distinguishing features: ${visualAttrs.distinguishing_features}`);
                }
                
                enhancedCharacters.push({
                    name: asset.name,
                    description: descParts.filter(p => p).join('. '),
                    assetId: asset.id,
                    tags: asset.tags || []
                });
            });
        }

        logger.info(`Enhanced character list: ${enhancedCharacters.map(c => c.name).join(', ')}`);
        return enhancedCharacters;
    }
}

