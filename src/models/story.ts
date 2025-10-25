/**
 * Story and segment data models
 */

export interface Segment {
    // Schema metadata
    schema?: { name: string; version: string };
    generator?: { service: string; build: string; timestamp: string };
    
    // Core identifiers
    id: string;
    segmentIndex?: number;  // Strict ordering
    text: string;  // Transcript portion (preserved)
    prompt: string;  // AI-generated prompt for video generation (or fused from structured fields)
    duration: number;
    startTime: number;
    actualDuration?: number;
    status: 'pending' | 'generating' | 'completed' | 'failed' | 'validated';
    videoPath?: string;
    error?: string;
    
    // Storyline tracking (for intercuts)
    storylineId?: string;
    sceneId?: string;
    batchId?: string;
    
    // Host-computed continuity (deterministic, Record-based for fast lookup)
    characters?: string[];  // Normalized asset names present in this segment
    location?: string;      // Normalized asset name for location
    continuityRefsByCharacter?: Record<string, string>;  // { "John": "segment_17", "Mary": "segment_12" }
    locationRef?: string;   // Most recent segment at same location
    firstAppearanceByCharacter?: string[];  // Characters appearing for first time
    
    // Appearance state tracking (prevents wardrobe drift)
    appearanceByCharacter?: Record<string, string>;  // { "John": "john_default" }
    identityLocklineByCharacter?: Record<string, string>;  // Canonical one-liner per character
    
    // Structured fields (preserved for debugging)
    structuredFields?: {
        actions?: string[];
        shot?: string;
        lighting?: string;
        environment_delta?: string;
        props_delta?: string;
        redundancy_score?: number;
        novelty_score?: number;
        continuity_confidence?: number;
        forbidden_traits_used?: string[];
    };
    
    // Execution backfill
    remixSources?: {
        byCharacter?: Record<string, { refSegmentId: string; videoId?: string }>;
        byLocation?: { refSegmentId: string; videoId?: string };
    };
    
    // QA & observability
    violations?: string[];  // Alias/asset mismatches
    driftFlags?: string[];  // Linter-detected trait re-descriptions
    criticFlags?: string[];  // From critic pass
    ngramOverlap?: number;  // Similarity to recent segments
    compressed?: boolean;   // Did compression pass run?
    
    // Legacy fields (backward compat)
    usedAssets?: string[]; // IDs of assets used in this segment
    continuityReference?: string; // ID of segment to use as remix reference
    continuityType?: 'sequential' | 'narrative' | 'character' | 'location' | 'none';
    narrativeContext?: {
        sceneType?: string; // 'establishing', 'action', 'dialogue', 'transition'
        characterFocus?: string[]; // Which characters are primary in this segment
        locationContinuity?: string; // Location reference for continuity
        emotionalTone?: string; // Emotional context for continuity
    };
    
    // Timestamps
    createdAt?: string;
    updatedAt?: string;
}

/**
 * Story represents the in-memory and workspace-cached view of a story.
 * 
 * DATA ARCHITECTURE:
 * - Narrative/content data: Persisted in master_context.json (source of truth)
 *   - name, description, content, transcription, editorsNotes
 *   - research, audioAnalysis, timingMap, storyAssets, assetsUsed
 *   - segments (directorScript), cinematographyGuidelines
 * 
 * - Technical/execution data: Persisted in workspace state (cache)
 *   - status, progress, outputFiles, settings
 *   - directoryPath, metadata, sourceFiles
 * 
 * The Story object is reconstructed on load by:
 * 1. Reading narrative data from master_context.json
 * 2. Reading technical data from workspace state
 * 3. Reconstructing missing fields with defaults
 */
export interface Story {
    id: string;
    name: string;
    description: string;
    directoryPath: string; // Story's directory path - set when story is created
    inputType: 'text' | 'audio' | 'video';
    inputSource: string;
    content: string;
    transcription?: string;
    directorScript: Segment[];
    status: 'draft' | 'analyzing' | 'generating' | 'compiling' | 'completed' | 'error';
    createdAt: string;
    modifiedAt: string;
    progress: {
        totalSegments: number;
        completedSegments: number;
        currentSegment: number;
    };
    outputFiles: {
        segments: string[];
        finalVideo: string;
        thumbnails: string[];
    };
    settings: {
        model: 'sora-2' | 'sora-2-pro';
        resolution: '1280x720' | '1920x1080';
        stylePreferences?: string;
    };
    // New fields for enhanced story creation
    sourceUrl?: string; // Original web resource URL
    importedFrom?: 'manual' | 'file' | 'web' | 'json'; // How the story was created
    metadata?: {
        originalFilename?: string;
        fileType?: string;
        webTitle?: string;
        webDescription?: string;
        [key: string]: any;
    };
    sourceFiles?: {
        original?: string;
        transcription?: string;
        analysis?: string;
    };
    assetsUsed?: string[]; // IDs of assets used in this story
    assetsExtracted?: boolean; // Whether assets have been extracted
    extractionDate?: string; // When assets were extracted
    // Editor's notes for guided research and script generation
    editorsNotes?: {
        researchGuidance?: string; // Notes to guide research direction
        scriptGuidance?: string; // Notes to guide script generation
        visualStyle?: string; // Specific visual style preferences
        characterNotes?: string; // Character-specific guidance
        narrativeFocus?: string; // Narrative direction and themes
        technicalNotes?: string; // Technical requirements or constraints
        createdAt?: string;
        modifiedAt?: string;
    };
    // NOTE: Research is ONLY stored in master_context.json, NOT in Story object
    // Load/save research directly from/to master_context.json
    generationConfig?: {
        model: 'sora' | 'sora-turbo';
        visualStyle: string;
        customStylePrompt?: string;
        defaultDuration: number;
        quality: 'low' | 'medium' | 'high';
        aspectRatio: '16:9' | '4:3' | '1:1' | '9:16';
        maxPromptChars?: number;  // Maximum character length for Sora prompts (default: 500)
        audioSettings: {
            enableMusic: boolean;
            enableNarration: boolean;
            musicVolume: number;
            narrationVolume: number;
        };
        preferredAssets: string[];
    };
}

export interface Asset {
    id: string;
    name: string;
    type: 'character' | 'location' | 'item' | 'vehicle' | 'animal' | 'other';
    description: string;
    visual_attributes: {
        // Core attributes (always present)
        appearance?: string;
        colors?: string;
        distinguishing_features?: string;
        typical_lighting?: string;
        mood?: string;
        
        // Extended character attributes (for people/beings)
        face?: string;
        eyes?: string;
        hair?: string;
        beard?: string;
        skin?: string;
        body_and_build?: string;
        hands_and_feet?: string;
        clothes?: string;
        accessories?: string;
        aura_and_atmosphere?: string;
        
        // Extended location attributes
        overall_impression?: string;
        terrain?: string;
        vegetation?: string;
        architecture?: string;
        atmospheric_conditions?: string;
        textures?: string;
        sounds?: string;
        smells?: string;
        time_of_day?: string;
        
        // Extended item attributes
        material_and_construction?: string;
        decorative_details?: string;
        size_and_scale?: string;
        texture?: string;
        interaction_with_light?: string;
        
        // Character group/family attributes
        [key: string]: string | undefined; // Allow custom keys for family members, transformation states, etc.
    };
    references?: string[]; // IDs of related assets
    tags?: string[]; // Tags for categorization
    indexed_in?: string[]; // Stories/sections this appears in
    created_at: string;
    modified_at: string;
    usage_count: number;
    stories?: string[]; // Story IDs where this asset is used
    reference_image?: string; // Path to DALL-E generated reference image for character consistency
    reference_image_generated?: string; // Timestamp when reference image was generated
}

export interface AudioAnalysis {
    duration: number;
    bitrate: number;
    sampleRate: number;
    channels: number;
    silences: Array<{ start: number; end?: number }>;
    loudness: {
        average: number;
        peak: number;
    };
    estimatedTempo: number;
}

export interface TranscriptionResult {
    text: string;
    segments: Array<{
        text: string;
        start: number;
        end: number;
    }>;
    duration: number;
}

export interface DirectorScript {
    title: string;
    theme: string;
    mood: string;
    visualStyle: string;
    colorPalette: string;
    segments: Segment[];
    totalDuration: number;
}

export interface GenerationTask {
    id: string;
    storyId: string;
    type: 'analyze' | 'generate' | 'compile' | 'single_segment';
    status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed';
    progress: number;
    error?: string | null;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    // NEW: Support for selective segment generation
    segmentFilter?: number[];  // Array of segment indices to generate
    segmentIndex?: number;     // Single segment index for single_segment tasks
    continuityFrame?: string;   // Path to continuity frame from previous segment
}

