/**
 * Continuity Linter - Prevents trait drift and detects violations
 * Checks prompts for forbidden phrases, trait re-descriptions, and length issues
 */

import { Segment } from '../models/story';

/**
 * Character profile with appearance state tracking
 */
export interface CharacterProfile {
  assetName: string;
  defaultStateId: string;
  states: Record<string, AppearanceState>;
}

/**
 * Appearance state for a character (e.g., default, prison, travel)
 */
export interface AppearanceState {
  id: string;
  summary: string;  // Canonical descriptor
  allowedColors?: string[];
  forbiddenTraits?: string[];  // Traits that must not appear in prompts
}

/**
 * Forbidden phrases that should never appear in prompts
 */
const FORBIDDEN_PHRASES = [
  /\bthe camera\b/i,
  /\ba shot of\b/i,
  /\bthe mood is\b/i,
  /\bemphasizing\b/i,
  /\bmaintain continuity\b/i,
  /\bas the\b.*\bunfolds\b/i,
  /\bwe see\b/i,
  /\bthe scene\b/i
];

/**
 * Fixed trait keywords that should not be re-described when continuity exists
 */
const FIXED_TRAIT_KEYWORDS = [
  'eyes', 'hair', 'skin', 'beard', 'face', 'build', 
  'height', 'age', 'wardrobe', 'clothes', 'robe', 'cloak',
  'complexion', 'features', 'physique', 'frame'
];

/**
 * Lint results for a segment
 */
export interface LintResult {
  driftFlags: string[];
  fillerFlags: string[];
  lengthFlags: string[];
  allFlags: string[];
}

/**
 * Continuity linter service
 */
export class ContinuityLinter {
  
  constructor(private characterProfiles: Record<string, CharacterProfile>) {}
  
  /**
   * Lint for continuity drift (fixed trait re-descriptions)
   */
  lintContinuityDrift(segment: Segment): string[] {
    const driftFlags: string[] = [];
    
    for (const charName of segment.characters || []) {
      const hasRef = segment.continuityRefsByCharacter?.[charName];
      if (!hasRef) continue;  // First appearance, full description allowed
      
      const profile = this.characterProfiles[charName];
      if (!profile) continue;
      
      const appearanceStateId = segment.appearanceByCharacter?.[charName];
      if (!appearanceStateId) continue;
      
      const state = profile.states[appearanceStateId];
      const forbidden = state?.forbiddenTraits || FIXED_TRAIT_KEYWORDS;
      
      for (const trait of forbidden) {
        const re = new RegExp(`\\b${this.escapeRegex(trait)}\\b`, 'i');
        if (re.test(segment.prompt)) {
          driftFlags.push(
            `${charName}: fixed trait "${trait}" (has ref to ${hasRef})`
          );
        }
      }
    }
    
    return driftFlags;
  }
  
  /**
   * Lint for forbidden filler phrases
   */
  lintFillerPhrases(prompt: string | undefined): string[] {
    if (!prompt) {
      return []; // If no prompt, skip filler check
    }
    
    const flags: string[] = [];
    
    for (const pattern of FORBIDDEN_PHRASES) {
      if (pattern.test(prompt)) {
        const match = prompt.match(pattern);
        if (match) {
          flags.push(`Filler: "${match[0]}"`);
        }
      }
    }
    
    return flags;
  }
  
  /**
   * Check word count
   */
  lintLength(prompt: string | undefined, min: number = 50, max: number = 80): string[] {
    if (!prompt) {
      return []; // If no prompt, skip length check
    }
    
    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    
    if (wordCount < min) {
      return [`Too short: ${wordCount} words (min ${min})`];
    }
    if (wordCount > max) {
      return [`Too long: ${wordCount} words (max ${max})`];
    }
    
    return [];
  }
  
  /**
   * Full lint pass on a segment
   */
  lintSegment(segment: Segment): LintResult {
    // Use finalPrompt (after fusion) if available, otherwise fall back to prompt
    const promptToLint = (segment as any).finalPrompt || segment.prompt;
    
    const driftFlags = this.lintContinuityDrift(segment);
    const fillerFlags = this.lintFillerPhrases(promptToLint);
    const lengthFlags = this.lintLength(promptToLint);
    
    return {
      driftFlags,
      fillerFlags,
      lengthFlags,
      allFlags: [...driftFlags, ...fillerFlags, ...lengthFlags]
    };
  }
  
  /**
   * Lint entire batch and return metrics
   */
  lintBatch(segments: Segment[]): {
    totalFlags: number;
    flaggedSegments: string[];
    cleanRate: number;
  } {
    let totalFlags = 0;
    const flaggedSegments: string[] = [];
    
    for (const seg of segments) {
      const flags = this.lintSegment(seg);
      if (flags.allFlags.length > 0) {
        totalFlags += flags.allFlags.length;
        flaggedSegments.push(seg.id);
      }
    }
    
    return {
      totalFlags,
      flaggedSegments,
      cleanRate: segments.length > 0 ? (segments.length - flaggedSegments.length) / segments.length : 1
    };
  }
  
  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}






