/**
 * Types for Storyline Editor
 * State management and data structures for the timeline-based video editor
 */

import { Story, Segment } from '../models/story';
import { AudioTimingMap } from '../services/audioAnalysisService';

/**
 * Complete state for the storyline editor
 */
export interface StorylineEditorState {
    // Media data
    story: Story;
    audioPath: string | null;
    audioAnalysis: AudioTimingMap | null;
    transcription: any | null;
    
    // Video URIs for webview
    compiledVideoUri: string | null;           // NEW: URI for compiled video
    segmentVideoUris: Map<string, string>;     // NEW: segment ID -> webview URI
    
    // Timeline data
    segments: Segment[];
    videoSegments: GeneratedVideoSegment[];
    
    // Playback state
    currentTime: number;
    currentFrame: number;
    currentSegmentId: string | null;
    isPlaying: boolean;
    playbackRate: number;
    
    // UI state
    timeline: TimelineState;
    
    // Generation state
    generation: GenerationState;
}

/**
 * Timeline UI state
 */
export interface TimelineState {
    zoomLevel: number;           // Pixels per second
    scrollPosition: number;       // Timeline scroll offset in pixels
    visibleRange: {
        start: number;            // Start time in seconds
        end: number;              // End time in seconds
    };
    selectedSegments: string[];   // Array of selected segment IDs
    playheadPosition: number;     // Playhead position in seconds
    snapToGrid: boolean;          // Whether to snap to segment boundaries
    snapToBeats: boolean;         // Whether to snap to beat markers
}

/**
 * Generation queue state
 */
export interface GenerationState {
    queue: string[];              // Segment IDs in generation queue
    activeSegment: string | null; // Currently generating segment ID
    progress: Map<string, GenerationProgress>;
}

/**
 * Progress for a single segment generation
 */
export interface GenerationProgress {
    current: number;              // Current progress (0-100)
    total: number;                // Total progress (always 100)
    status: 'queued' | 'generating' | 'downloading' | 'complete' | 'error';
    message?: string;             // Optional status message
}

/**
 * Generated video segment with metadata
 */
export interface GeneratedVideoSegment {
    id: string;                   // Segment ID from Script
    videoPath: string;            // Path to generated video file
    thumbnailPath: string;        // Path to thumbnail image
    continuityFramePath?: string; // Path to extracted continuity frame
    status: 'pending' | 'generating' | 'complete' | 'error' | 'validated';
    duration: number;             // Actual video duration
    startTime: number;            // Start time in story timeline
    endTime: number;              // End time in story timeline
}

/**
 * Playback control commands
 */
export type PlaybackCommand = 
    | 'play'
    | 'pause'
    | 'toggle-play-pause'
    | 'fast-forward'
    | 'rewind'
    | 'next-frame'
    | 'prev-frame'
    | 'first-frame-of-segment'
    | 'first-frame-of-next-segment'
    | 'first-frame-of-prev-segment'
    | 'first-frame-of-story'
    | 'last-frame-of-story'
    | 'seek';

/**
 * Timeline layer types
 */
export type TimelineLayerType = 
    | 'audio'
    | 'transcript'
    | 'script'
    | 'video';

/**
 * Timeline layer data
 */
export interface TimelineLayer {
    type: TimelineLayerType;
    name: string;
    height: number;              // Height in pixels
    visible: boolean;
    locked: boolean;
    data: any;                   // Layer-specific data
}

/**
 * Segment editing operations
 */
export type SegmentOperation = 
    | 'add'
    | 'remove'
    | 'edit'
    | 'generate'
    | 'regenerate'
    | 'duplicate'
    | 'split'
    | 'merge';

/**
 * Video player state
 */
export interface VideoPlayerState {
    isReady: boolean;
    isBuffering: boolean;
    currentSource: string | null;
    volume: number;
    muted: boolean;
    error: string | null;
}

/**
 * Zoom preset levels (pixels per second)
 */
export const ZOOM_PRESETS = {
    MIN: 10,                      // Most zoomed out
    COMFORTABLE: 50,              // Default comfortable view
    DETAILED: 100,                // Good for precise editing
    FRAME_PRECISE: 200,           // Frame-by-frame editing
    MAX: 500                      // Maximum zoom
} as const;

/**
 * Timeline constants
 */
export const TIMELINE_CONSTANTS = {
    MIN_SEGMENT_DURATION: 0.1,    // Minimum segment duration (100ms)
    SNAP_THRESHOLD: 0.1,          // Snap threshold in seconds
    PLAYHEAD_WIDTH: 2,            // Playhead line width in pixels
    LAYER_PADDING: 10,            // Padding between layers
    AUDIO_WAVEFORM_HEIGHT: 80,
    TRANSCRIPT_HEIGHT: 60,
    SCRIPT_HEIGHT: 100,
    VIDEO_HEIGHT: 80
} as const;












