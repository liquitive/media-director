/**
 * Asset Types - Compressed asset interfaces for Script genration
 */

import { Asset } from '../models/story';

export interface CompressedAsset {
  id: string;
  type: 'character' | 'location' | 'item' | 'vehicle' | 'animal' | 'other';
  name: string;
  
  // Compressed for prompt efficiency (not token limits)
  compressedAnchor: string;  // 50-75 tokens
  visualKeywords: string[];  // 4-6 key identifiers
  
  // Type-specific
  emotionalArc?: string;        // For characters
  lightingProgression?: string; // For locations
  
  // Original full description (preserved in file)
  fullDescription: string;
  
  // Reference image path
  referenceImage?: string;
}

export interface MasterContextFile {
  storyId: string;
  storyName: string;
  storyDescription: string;
  storyContent: string;
  transcription?: string;
  
  // FULL research context (NO compression)
  research: {
    historicalSources: string[];
    literarySources: string[];
    culturalContext: string[];
    artisticSources: string[];
    emotionalSignificance: string;
    literalSignificance: string;
    protagonistAnalysis: {
      identityBackground: string;
      physicalCharacteristics: string;
      psychologicalSpiritualProfile: string;
      relationshipsDynamics: string;
      historicalCulturalContext: string;
    };
    locationAnalysis: {
      geographicalSpecifics: string;
      historicalContext: string;
      culturalReligiousSignificance: string;
      physicalDescription: string;
      emotionalAtmosphere: string;
    };
    temporalContext: {
      preciseTimeframe: string;
      historicalPeriodCharacteristics: string;
      culturalReligiousEnvironment: string;
      artisticIntellectualClimate: string;
    };
    themesNarrativeAnalysis: {
      surfaceNarrative: string;
      deeperThemesMeanings: string;
      literaryAnalysis: string;
      emotionalPsychologicalJourney: string;
    };
    visualCinematicApproach: {
      visualStyleAesthetic: string;
      colorPaletteLighting: string;
      costumeProductionDesign: string;
      soundMusicDirection: string;
    };
    purposeSignificance: {
      storytellersIntent: string;
      historicalImpact: string;
      contemporaryRelevance: string;
      emotionalSpiritualSignificance: string;
    };
  };
  
  audioAnalysis: {
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
  };
  
  compressedAssets: CompressedAsset[];
  timingMap: any; // Full timing map from audio analysis
  cinematographyGuidelines: {
    cameraMovements: string;
    lightingPrinciples: string;
    shotComposition: string;
    visualContinuity: string;
  };
  generationInstructions: {
    model: 'sora' | 'sora-turbo';
    visualStyle: string;
    customStylePrompt?: string;
    defaultDuration: number;
    quality: 'low' | 'medium' | 'high';
    aspectRatio: '16:9' | '4:3' | '1:1' | '9:16';
    maxPromptChars?: number;
    audioSettings: {
      enableMusic: boolean;
      enableNarration: boolean;
      musicVolume: number;
      narrationVolume: number;
    };
    preferredAssets: string[];
  };
  segments: {
    id: string;
    text: string;
    duration: number;
    startTime: number;
    rawVisualPrompt: string;
    usedAssets: string[];
  }[];
  editorsNotes?: {
    researchGuidance?: string;
    scriptGuidance?: string;
    visualStyle?: string;
    characterNotes?: string;
    narrativeFocus?: string;
    technicalNotes?: string;
    createdAt?: string;
    modifiedAt?: string;
  } | null;
}

export interface SegmentPrompt {
  segmentId: string;
  finalPrompt: string;
  // Cross-segment continuity
  continuityReference?: string;
  continuityType?: 'sequential' | 'narrative' | 'character' | 'location' | 'none';
  narrativeContext?: {
    sceneType?: 'establishing' | 'action' | 'dialogue' | 'transition';
    characterFocus?: string[];
    locationContinuity?: string;
    emotionalTone?: string;
  };
}

export interface SegmentPair {
  aiSegment: SegmentPrompt;
  contextSegment: any; // Original segment from master_context.json
}

export interface ValidationResult {
  isValid: boolean;
  totalSegments: number;
  errors: Array<{
    id: string;
    type: 'character_inconsistency' | 'asset_missing' | 'temporal_logic' | 'narrative_flow' | 'visual_coherence';
    segmentIds: string[];
    description: string;
    severity: 'critical' | 'warning';
    suggestedFix: string;
  }>;
  summary: {
    totalErrors: number;
    criticalErrors: number;
    warnings: number;
    overallQuality: 'excellent' | 'good' | 'fair' | 'poor';
  };
}





