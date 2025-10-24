/**
 * Story Service
 * Manages story CRUD operations and persistence
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Story, Segment } from '../models/story';

export class StoryService {
    private stories: Map<string, Story> = new Map();
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Initialize and load stories from workspace
     */
    async initialize(): Promise<void> {
        await this.loadFromWorkspace();
    }

    /**
     * Create a new story
     */
    createStory(
        name: string,
        inputType: 'text' | 'audio' | 'video',
        inputSource: string = '',
        content: string = ''
    ): Story {
        // Get workspace root and create directory path
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            throw new Error('No workspace folder open. Please open a folder to use Sora Director.');
        }
        
        const storyDirName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const directoryPath = path.join(workspaceRoot, 'sora-output', 'stories', storyDirName);
        
        const story: Story = {
            id: `story_${Date.now()}`,
            name,
            description: '',
            directoryPath,
            inputType,
            inputSource,
            content,
            directorScript: [],
            status: 'analyzing', // Start as analyzing since we're processing the content
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            progress: {
                totalSegments: 0,
                completedSegments: 0,
                currentSegment: 0
            },
            outputFiles: {
                segments: [],
                finalVideo: '',
                thumbnails: []
            },
            settings: {
                model: vscode.workspace.getConfiguration('sora').get('model') || 'sora-2',
                resolution: '1280x720'
            }
        };

        this.stories.set(story.id, story);
        this.createStoryDirectories(story.id);
        this.createInitialMasterContext(story); // Create master_context.json at inception
        this.saveToWorkspace();
        return story;
    }

    /**
     * Get story by ID
     */
    getStory(id: string): Story | undefined {
        let story = this.stories.get(id);
        if (!story) {
            // Try to discover the story from file system
            this.discoverStoryById(id);
            story = this.stories.get(id);
        }
        return story;
    }

    /**
     * Discover a specific story by ID from the file system
     */
    private discoverStoryById(id: string): void {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) return;

            const soraOutputPath = path.join(workspaceRoot, 'sora-output', 'stories');
            if (!fs.existsSync(soraOutputPath)) return;

            const storyDirs = fs.readdirSync(soraOutputPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const storyDir of storyDirs) {
                const storyPath = path.join(soraOutputPath, storyDir);
                const segmentsDir = path.join(storyPath, 'segments');
                
                if (fs.existsSync(segmentsDir)) {
                    const segmentFiles = fs.readdirSync(segmentsDir)
                        .filter(file => file.startsWith('segment_') && file.endsWith('.json'));
                    
                    for (const segmentFile of segmentFiles) {
                        try {
                            const segmentPath = path.join(segmentsDir, segmentFile);
                            const segment = JSON.parse(fs.readFileSync(segmentPath, 'utf8'));
                            
                            if (segment.storyId === id) {
                                // Found the story, create it
                                const story: Story = {
                                    id: id,
                                    name: storyDir.replace(/_/g, ' '),
                                    description: `Story discovered from file system`,
                                    directoryPath: path.join(workspaceRoot, 'sora-output', 'stories', storyDir),
                                    inputType: 'audio',
                                    inputSource: '',
                                    content: '',
                                    directorScript: [],
                                    status: 'completed',
                                    createdAt: new Date().toISOString(),
                                    modifiedAt: new Date().toISOString(),
                                    progress: {
                                        totalSegments: 0,
                                        completedSegments: 0,
                                        currentSegment: 0
                                    },
                                    outputFiles: {
                                        segments: [],
                                        finalVideo: '',
                                        thumbnails: []
                                    },
                                    settings: {
                                        model: 'sora-2',
                                        resolution: '1920x1080'
                                    }
                                };
                                
                                this.stories.set(id, story);
                                this.loadSegmentsFromDisk(id);
                                return;
                            }
                        } catch (error) {
                            // Continue to next segment
                        }
                    }
                }
            }
        } catch (error) {
            console.warn(`Failed to discover story ${id} from file system:`, error);
        }
    }

    /**
     * Update story - syncs to both workspace cache and master_context.json
     */
    updateStory(id: string, updates: Partial<Story>): void {
        const story = this.stories.get(id);
        if (!story) {
            return;
        }

        // Update in-memory story
        Object.assign(story, updates);
        story.modifiedAt = new Date().toISOString();
        this.stories.set(id, story);
        
        // Save to workspace state (cache)
        this.saveToWorkspace();

        // Persist to master_context.json (source of truth) - ONLY narrative fields
        const masterContextUpdates: any = {
            storyName: story.name,
            storyDescription: story.description,
            storyContent: story.content,
            transcription: story.transcription,
            editorsNotes: story.editorsNotes
        };
        
        // NOTE: Research is handled directly by handleSaveResearch() - not via Story updates
        
        if (updates.directorScript) {
            masterContextUpdates.segments = updates.directorScript;
        }
        
        if (updates.assetsUsed) {
            masterContextUpdates.assetsUsed = updates.assetsUsed;
        }
        
        this.updateMasterContext(id, masterContextUpdates);

        // Persist individual segment files if directorScript was updated
        try {
            if (updates.directorScript && Array.isArray(updates.directorScript)) {
                const storyDir = this.getStoryDirectory(id);
                const segmentsDir = path.join(storyDir, 'segments');
                if (!fs.existsSync(segmentsDir)) {
                    fs.mkdirSync(segmentsDir, { recursive: true });
                }
                updates.directorScript.forEach((segment: any, index: number) => {
                    const segmentPath = path.join(segmentsDir, `segment_${index + 1}.json`);
                    const segmentData = {
                        version: '1.0',
                        storyId: id,
                        segmentIndex: index,
                        createdAt: new Date().toISOString(),
                        ...segment
                    };
                    fs.writeFileSync(segmentPath, JSON.stringify(segmentData, null, 2));
                });
            }
        } catch (err) {
            console.error('Error persisting segment updates:', err);
        }
    }

    /**
     * Save a single segment to its individual file and update in-memory story
     * This is the real-time segment persistence method
     */
    saveSegment(id: string, segmentIndex: number, segmentData: any): void {
        try {
            const story = this.stories.get(id);
            if (!story) {
                throw new Error(`Story ${id} not found`);
            }

            const storyDir = this.getStoryDirectory(id);
            const segmentsDir = path.join(storyDir, 'segments');
            
            // Ensure segments directory exists
            if (!fs.existsSync(segmentsDir)) {
                fs.mkdirSync(segmentsDir, { recursive: true });
            }

            // Prepare segment data with metadata
            const fullSegmentData = {
                version: '1.0',
                storyId: story.id,
                segmentIndex,
                updatedAt: new Date().toISOString(),
                ...segmentData
            };

            // Write individual segment file immediately
            const segmentPath = path.join(segmentsDir, `segment_${segmentIndex + 1}.json`);
            fs.writeFileSync(segmentPath, JSON.stringify(fullSegmentData, null, 2));

            // Update in-memory story
            if (!story.directorScript) {
                story.directorScript = [];
            }
            
            // Extend array if needed
            while (story.directorScript.length <= segmentIndex) {
                story.directorScript.push(null as any);
            }
            
            story.directorScript[segmentIndex] = segmentData;
            story.modifiedAt = new Date().toISOString();
            
            // Update master_context.json with new segments array
            this.updateMasterContext(id, {
                segments: story.directorScript,
                modifiedAt: story.modifiedAt
            });
            
            console.log(`✓ Saved segment ${segmentIndex + 1} to disk and memory`);
        } catch (error) {
            console.error(`Error saving segment ${segmentIndex}:`, error);
            throw error;
        }
    }

    /**
     * Load segments from individual files into story object
     * This ensures segments are loaded from disk on startup/resume
     */
    loadSegmentsFromDisk(id: string): void {
        try {
            const story = this.stories.get(id);
            if (!story) return;

            const storyDir = this.getStoryDirectory(id);
            const segmentsDir = path.join(storyDir, 'segments');
            
            if (!fs.existsSync(segmentsDir)) {
                console.log(`No segments directory found for story ${id}`);
                return;
            }

            // Read all segment files
            const segmentFiles = fs.readdirSync(segmentsDir)
                .filter(f => f.startsWith('segment_') && f.endsWith('.json'))
                .sort((a, b) => {
                    const numA = parseInt(a.match(/segment_(\d+)\.json/)?.[1] || '0');
                    const numB = parseInt(b.match(/segment_(\d+)\.json/)?.[1] || '0');
                    return numA - numB;
                });

            if (segmentFiles.length === 0) {
                console.log(`No segment files found for story ${id}`);
                return;
            }

            // Load each segment
            const segments: any[] = [];
            for (const file of segmentFiles) {
                const segmentPath = path.join(segmentsDir, file);
                const segmentData = JSON.parse(fs.readFileSync(segmentPath, 'utf-8'));
                
                // Extract just the segment data (remove metadata)
                const { version, storyId, segmentIndex, createdAt, updatedAt, ...segment } = segmentData;
                segments.push(segment);
            }

            // Update story with loaded segments
            story.directorScript = segments;
            story.progress.totalSegments = segments.length;
            console.log(`✓ Loaded ${segments.length} segments from disk for story ${id}`);
            
        } catch (error) {
            console.error(`Error loading segments from disk for story ${id}:`, error);
        }
    }

    /**
     * Save Script to filesystem (DEPRECATED - use saveSegment for real-time persistence)
     * This method is kept for backward compatibility but should not be used for new code
     */
    saveDirectorScript(id: string): void {
        try {
            const story = this.stories.get(id);
            if (!story) return;

            const storyDir = this.getStoryDirectory(id);
            
            // Only create individual segment JSON files (no more script.json)
            if (story.directorScript && story.directorScript.length > 0) {
                const segmentsDir = path.join(storyDir, 'segments');
                console.log('Creating segments directory:', segmentsDir);
                
                if (!fs.existsSync(segmentsDir)) {
                    fs.mkdirSync(segmentsDir, { recursive: true });
                    console.log('Created segments directory');
                }

                console.log(`Creating ${story.directorScript.length} segment files...`);
                story.directorScript.forEach((segment: any, index: number) => {
                    this.saveSegment(id, index, segment);
                });
                console.log('All segment files created successfully');
            } else {
                console.log('No Script segments to save');
            }
        } catch (error) {
            console.error('Error saving Script:', error);
        }
    }

    /**
     * Delete story
     */
    deleteStory(id: string): void {
        this.stories.delete(id);
        this.saveToWorkspace();

        // Also delete story files
        this.deleteStoryFiles(id);
    }

    /**
     * Get all stories
     */
    getAllStories(): Story[] {
        return Array.from(this.stories.values()).sort((a, b) => {
            return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
        });
    }

    /**
     * Get story directory path
     */
    getStoryDirectory(id: string): string {
        const story = this.stories.get(id);
        if (!story) {
            throw new Error(`Story with ID ${id} not found`);
        }
        
        return story.directoryPath;
    }

    /**
     * Get default story directory path for a given name
     */
    private getDefaultStoryDirectory(name: string): string {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            throw new Error('No workspace folder open. Please open a folder to use Sora Director.');
        }
        
        const storyDirName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        return path.join(workspaceRoot, 'sora-output', 'stories', storyDirName);
    }

    /**
     * Get empty research structure for initial master context
     */
    private getEmptyResearchStructure(): any {
        return {
            historicalSources: [],
            literarySources: [],
            culturalContext: [],
            artisticSources: [],
            emotionalSignificance: '',
            literalSignificance: '',
            protagonistAnalysis: {
                identityBackground: '',
                physicalCharacteristics: '',
                psychologicalSpiritualProfile: '',
                relationshipsDynamics: '',
                historicalCulturalContext: ''
            },
            locationAnalysis: {
                geographicalSpecifics: '',
                historicalContext: '',
                culturalReligiousSignificance: '',
                physicalDescription: '',
                emotionalAtmosphere: ''
            },
            temporalContext: {
                preciseTimeframe: '',
                historicalPeriodCharacteristics: '',
                culturalReligiousEnvironment: '',
                artisticIntellectualClimate: ''
            },
            themesNarrativeAnalysis: {
                surfaceNarrative: '',
                deeperThemesMeanings: '',
                literaryAnalysis: '',
                emotionalPsychologicalJourney: ''
            },
            visualCinematicApproach: {
                visualStyleAesthetic: '',
                colorPaletteLighting: '',
                costumeProductionDesign: '',
                soundMusicDirection: ''
            },
            purposeSignificance: {
                storytellersIntent: '',
                historicalImpact: '',
                contemporaryRelevance: '',
                emotionalSpiritualSignificance: ''
            }
        };
    }

    /**
     * Create initial master_context.json at story inception
     * This is the single source of truth for story narrative/content data
     */
    private createInitialMasterContext(story: Story): void {
        const storyDir = this.getStoryDirectory(story.id);
        const sourceDir = path.join(storyDir, 'source');
        
        // Ensure source directory exists
        if (!fs.existsSync(sourceDir)) {
            fs.mkdirSync(sourceDir, { recursive: true });
        }
        
        // ONLY story content/narrative data - NO technical execution settings
        const initialContext: any = {
            storyId: story.id,
            storyName: story.name,
            storyDescription: story.description,
            storyContent: story.content,
            inputType: story.inputType,
            inputSource: story.inputSource,
            createdAt: story.createdAt,
            modifiedAt: story.modifiedAt,
            sourceUrl: story.sourceUrl,
            importedFrom: story.importedFrom,
            // Initialize empty structures that will be populated
            transcription: story.transcription,
            research: this.getEmptyResearchStructure(),
            audioAnalysis: null,
            timingMap: null,
            storyAssets: [], // Story-specific assets extracted from THIS story
            assetsUsed: story.assetsUsed || [],
            cinematographyGuidelines: null,
            generationInstructions: null,
            segments: [],
            editorsNotes: story.editorsNotes || null
        };
        
        const contextPath = path.join(sourceDir, 'master_context.json');
        fs.writeFileSync(contextPath, JSON.stringify(initialContext, null, 2));
        console.log(`✅ Created initial master_context.json for story ${story.id}`);
    }

    /**
     * Convert MasterContextFile to Story object
     * Used when loading stories from file system
     */
    private convertMasterContextToStory(context: any, directoryPath: string): Story {
        return {
            id: context.storyId,
            name: context.storyName,
            description: context.storyDescription,
            directoryPath: directoryPath,
            inputType: context.inputType,
            inputSource: context.inputSource,
            content: context.storyContent,
            transcription: context.transcription,
            directorScript: context.segments || [],
            status: 'completed', // Default status when loading from file
            createdAt: context.createdAt,
            modifiedAt: context.modifiedAt,
            progress: {
                totalSegments: context.segments?.length || 0,
                completedSegments: 0,
                currentSegment: 0
            },
            outputFiles: {
                segments: [],
                finalVideo: '',
                thumbnails: []
            },
            settings: {
                model: 'sora-2',
                resolution: '1920x1080'
            },
            sourceUrl: context.sourceUrl,
            importedFrom: context.importedFrom,
            assetsUsed: context.assetsUsed,
            editorsNotes: context.editorsNotes
        };
    }

    /**
     * Update master_context.json with new data
     * Only updates narrative/content fields, NOT technical execution fields
     */
    private updateMasterContext(id: string, updates: Partial<any>): void {
        try {
            const storyDir = this.getStoryDirectory(id);
            const contextPath = path.join(storyDir, 'source', 'master_context.json');
            
            // Load current context
            if (!fs.existsSync(contextPath)) {
                console.warn(`master_context.json not found for story ${id}, cannot update`);
                return;
            }
            
            const currentContext = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
            
            // Whitelist only narrative/content fields to prevent technical field leakage
            const allowedUpdates: any = {};
            const allowedFields = [
                'storyName', 'storyDescription', 'storyContent', 'transcription',
                'research', 'audioAnalysis', 'timingMap', 'storyAssets', 'assetsUsed',
                'cinematographyGuidelines', 'generationInstructions', 'segments', 'editorsNotes'
            ];
            
            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    allowedUpdates[field] = updates[field];
                }
            }
            
            // Merge updates
            const updatedContext = { 
                ...currentContext, 
                ...allowedUpdates, 
                modifiedAt: new Date().toISOString() 
            };
            
            // Save back to file
            fs.writeFileSync(contextPath, JSON.stringify(updatedContext, null, 2));
            console.log(`✓ Updated master_context.json for story ${id}`);
        } catch (error) {
            console.error(`Error updating master_context.json for story ${id}:`, error);
        }
    }

    /**
     * Create story directories
     */
    createStoryDirectories(id: string): void {
        try {
            const storyDir = this.getStoryDirectory(id);
            
            // Ensure parent directories exist first
            const parentDir = path.dirname(storyDir);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }
            
            const dirs = [
                storyDir,
                path.join(storyDir, 'source'),
                path.join(storyDir, 'scripts'),
                path.join(storyDir, 'assets'),
                path.join(storyDir, 'segments'),
                path.join(storyDir, 'completed'),
                path.join(storyDir, 'thumbnails')
            ];

            dirs.forEach(dir => {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            });
            
            // Create default config.json
            const configPath = path.join(storyDir, 'config.json');
            const defaultConfig = {
                model: 'sora',
                visualStyle: 'naturalistic', // Will be updated by AI
                defaultDuration: 4,
                quality: 'medium',
                aspectRatio: '16:9',
                maxPromptChars: 500,  // Maximum character length for Sora prompts (following best practices)
                audioSettings: {
                    enableMusic: false,
                    enableNarration: true,
                    musicVolume: 0.7,
                    narrationVolume: 1.0
                },
                preferredAssets: []
            };
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
            
            console.log('✅ Story directories created successfully for:', id);
        } catch (error) {
            console.error('Error creating story directories:', error);
            // Fallback to a simple directory in the workspace
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const fallbackDir = path.join(workspaceRoot, 'sora-output', 'stories', id);
            if (!fs.existsSync(fallbackDir)) {
                fs.mkdirSync(fallbackDir, { recursive: true });
            }
        }
    }

    /**
     * Delete story files
     */
    private deleteStoryFiles(id: string): void {
        try {
            const storyDir = this.getStoryDirectory(id);
            if (fs.existsSync(storyDir)) {
                fs.rmSync(storyDir, { recursive: true, force: true });
            }
        } catch (error) {
            console.error('Error deleting story files:', error);
        }
    }

    /**
     * Save stories to workspace
     */
    private async saveToWorkspace(): Promise<void> {
        const storiesData = Array.from(this.stories.values());
        await this.context.workspaceState.update('sora.stories', storiesData);
    }

    /**
     * Load stories from workspace state (cache) and file system (source of truth)
     */
    private async loadFromWorkspace(): Promise<void> {
        // Load from workspace state (cache layer)
        const storiesData = this.context.workspaceState.get<Story[]>('sora.stories');
        if (storiesData) {
            this.stories.clear();
            storiesData.forEach(story => {
                this.stories.set(story.id, story);
            });
        }
        
        // Discover stories from file system (master_context.json is source of truth)
        await this.discoverStoriesFromFileSystem();
        
        // Update workspace cache with any newly discovered stories
        await this.saveToWorkspace();
    }

    /**
     * Discover stories from the file system using master_context.json as source of truth
     */
    private async discoverStoriesFromFileSystem(): Promise<void> {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) return;

            const soraOutputPath = path.join(workspaceRoot, 'sora-output', 'stories');
            if (!fs.existsSync(soraOutputPath)) return;

            const storyDirs = fs.readdirSync(soraOutputPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const storyDir of storyDirs) {
                const storyPath = path.join(soraOutputPath, storyDir);
                const masterContextPath = path.join(storyPath, 'source', 'master_context.json');
                
                if (fs.existsSync(masterContextPath)) {
                    try {
                        const contextData = JSON.parse(fs.readFileSync(masterContextPath, 'utf8'));
                        if (contextData.storyId && !this.stories.has(contextData.storyId)) {
                            const story = this.convertMasterContextToStory(contextData, storyPath);
                            this.stories.set(story.id, story);
                            console.log(`✓ Loaded story ${story.id} from master_context.json`);
                        }
                    } catch (error) {
                        console.warn(`Failed to load story from ${masterContextPath}:`, error);
                    }
                } else {
                    console.warn(`Skipping story directory ${storyDir}: no master_context.json found`);
                }
            }
        } catch (error) {
            console.warn('Failed to discover stories from file system:', error);
        }
    }


    /**
     * Export story to file
     */
    async exportStory(id: string, exportPath: string): Promise<void> {
        const story = this.stories.get(id);
        if (!story) {
            throw new Error('Story not found');
        }

        const storyData = JSON.stringify(story, null, 2);
        fs.writeFileSync(exportPath, storyData, 'utf-8');
    }

    /**
     * Import story from file
     */
    async importStory(importPath: string): Promise<Story> {
        const storyData = fs.readFileSync(importPath, 'utf-8');
        const story = JSON.parse(storyData) as Story;
        
        // Generate new ID to avoid conflicts
        story.id = `story_${Date.now()}`;
        story.createdAt = new Date().toISOString();
        story.modifiedAt = new Date().toISOString();
        
        this.stories.set(story.id, story);
        this.createStoryDirectories(story.id);
        this.saveToWorkspace();
        return story;
    }

    /**
     * Get stories by status
     */
    getStoriesByStatus(status: Story['status']): Story[] {
        return this.getAllStories().filter(story => story.status === status);
    }

    /**
     * Get active (processing) stories
     */
    getActiveStories(): Story[] {
        return this.getAllStories().filter(story => 
            story.status === 'analyzing' || 
            story.status === 'generating' ||
            story.status === 'compiling'
        );
    }

    /**
     * Import story from JSON data
     */
    importStoryFromJSON(jsonData: any): Story {
        if (!this.validateStoryJSON(jsonData)) {
            throw new Error('Invalid story JSON format');
        }

        const format = this.detectJSONFormat(jsonData);
        
        if (format === 'full-story') {
            return this.importFullStoryJSON(jsonData);
        } else if (format === 'script') {
            return this.importScriptJSON(jsonData);
        } else {
            throw new Error('Unsupported JSON format');
        }
    }

    /**
     * Import script segments from JSON
     */
    importScriptFromJSON(jsonData: any, storyId: string): void {
        const story = this.getStory(storyId);
        if (!story) {
            throw new Error('Story not found');
        }

        if (!jsonData.segments || !Array.isArray(jsonData.segments)) {
            throw new Error('Invalid script JSON format');
        }

        const segments: Segment[] = jsonData.segments.map((seg: any, index: number) => ({
            id: seg.id || `segment_${index + 1}`,
            text: seg.text || seg.lyricsExcerpt || '',
            visualPrompt: seg.visualPrompt || seg.prompt || '',
            duration: seg.duration || 8,
            startTime: seg.startTime || 0,
            cameraWork: seg.cameraWork,
            lighting: seg.lighting,
            mood: seg.mood,
            status: 'pending' as const,
            videoPath: seg.videoPath,
            error: seg.error
        }));

        story.directorScript = segments;
        story.progress.totalSegments = segments.length;
        story.modifiedAt = new Date().toISOString();
        
        this.updateStory(storyId, story);
    }

    /**
     * Validate story JSON structure
     */
    validateStoryJSON(jsonData: any): boolean {
        try {
            if (!jsonData || typeof jsonData !== 'object') {
                return false;
            }

            // Check for full story format
            if (jsonData.version && jsonData.story) {
                return this.validateFullStoryJSON(jsonData.story);
            }

            // Check for script format
            if (jsonData.segments && Array.isArray(jsonData.segments)) {
                return this.validateScriptJSON(jsonData);
            }

            return false;
        } catch {
            return false;
        }
    }

    /**
     * Detect JSON format type
     */
    detectJSONFormat(jsonData: any): 'full-story' | 'script' | 'invalid' {
        if (!jsonData || typeof jsonData !== 'object') {
            return 'invalid';
        }

        if (jsonData.version && jsonData.story) {
            return 'full-story';
        }

        if (jsonData.segments && Array.isArray(jsonData.segments)) {
            return 'script';
        }

        return 'invalid';
    }

    /**
     * Import full story from JSON
     */
    private importFullStoryJSON(jsonData: any): Story {
        const storyData = jsonData.story;
        
        const story: Story = {
            id: storyData.id || `story_${Date.now()}`,
            name: storyData.name || 'Imported Story',
            description: storyData.description || '',
            directoryPath: storyData.directoryPath || this.getDefaultStoryDirectory(storyData.name || 'Imported Story'),
            inputType: storyData.inputType || 'text',
            inputSource: storyData.inputSource || '',
            content: storyData.content || '',
            transcription: storyData.transcription,
            directorScript: storyData.directorScript || [],
            status: storyData.status || 'draft',
            createdAt: storyData.createdAt || new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            progress: storyData.progress || {
                totalSegments: 0,
                completedSegments: 0,
                currentSegment: 0
            },
            outputFiles: storyData.outputFiles || {
                segments: [],
                finalVideo: '',
                thumbnails: []
            },
            settings: storyData.settings || {
                model: 'sora-2',
                resolution: '1280x720'
            },
            sourceUrl: storyData.sourceUrl,
            importedFrom: 'json',
            metadata: storyData.metadata
        };

        this.stories.set(story.id, story);
        this.createStoryDirectories(story.id);
        this.createInitialMasterContext(story); // Create master_context.json for imported story
        this.saveToWorkspace();
        return story;
    }

    /**
     * Import script from JSON
     */
    private importScriptJSON(jsonData: any): Story {
        const story: Story = {
            id: `story_${Date.now()}`,
            name: jsonData.title || 'Imported Script',
            description: jsonData.description || '',
            directoryPath: this.getDefaultStoryDirectory(jsonData.title || 'Imported Script'),
            inputType: 'text',
            inputSource: '',
            content: '',
            directorScript: [],
            status: 'draft',
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            progress: {
                totalSegments: 0,
                completedSegments: 0,
                currentSegment: 0
            },
            outputFiles: {
                segments: [],
                finalVideo: '',
                thumbnails: []
            },
            settings: {
                model: 'sora-2',
                resolution: '1280x720'
            },
            importedFrom: 'json'
        };

        // Import segments
        this.importScriptFromJSON(jsonData, story.id);
        return story;
    }

    /**
     * Validate full story JSON
     */
    private validateFullStoryJSON(storyData: any): boolean {
        return storyData && 
               typeof storyData === 'object' &&
               typeof storyData.name === 'string' &&
               typeof storyData.inputType === 'string';
    }

    /**
     * Validate script JSON
     */
    private validateScriptJSON(jsonData: any): boolean {
        return Array.isArray(jsonData.segments) &&
               jsonData.segments.every((seg: any) => 
                   typeof seg === 'object' &&
                   (typeof seg.text === 'string' || typeof seg.lyricsExcerpt === 'string') &&
                   (typeof seg.visualPrompt === 'string' || typeof seg.prompt === 'string')
               );
    }
}

