/**
 * Types for segment validation system
 */

export type IssueType = 
    | 'protagonist_mismatch' 
    | 'pov_inconsistency' 
    | 'character_confusion' 
    | 'narrative_inconsistency' 
    | 'visual_logic_error' 
    | 'asset_mismatch'
    | 'protagonist_error'; // Legacy type for backwards compatibility

export type IssueSeverity = 'critical' | 'warning';
export type ValidationStatus = 'awaiting_correction' | 'correcting' | 'resolved' | 'validated';

export interface ValidationIssue {
    id: string;
    type: IssueType;
    segmentIds: string[];
    description: string;
    severity: IssueSeverity;
    
    // New fields for systematic issue detection
    isSystematic?: boolean;
    rootCause?: string;
    recommendedApproach?: 'Regenerate from corrected research' | 'Manual segment fix';
    
    // Legacy field (deprecated in favor of rootCause + recommendedApproach)
    suggestedFix?: string;
}

export interface ValidationResult {
    isValid: boolean;
    issues: ValidationIssue[];
    confidence: number;
    timestamp: number;
}

export interface ValidationContext {
    storyId: string;
    transcription: string;
    research?: string;
    assets?: any[];
    segments?: any[];
}

export interface ValidationContextState {
    result: ValidationResult;
    timestamp: number;
    status: ValidationStatus;
    storyId: string;
}

export interface SegmentUpdate {
    segmentId: string;
    segmentIndex: number;
    updates: {
        rawVisualPrompt?: string;  // Complete production-ready prompt
        text?: string;
    };
}











