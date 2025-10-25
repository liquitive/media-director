/**
 * Continuity Calculator - Deterministic host-side continuity computation
 * Computes per-character and per-location continuity references
 */

import { Asset } from '../models/story';
import { CharacterProfile, AppearanceState } from './continuityLinter';

/**
 * Segment input for continuity calculation
 */
export interface SegmentInput {
  id: string;
  index: number;
  storylineId?: string;
  characters?: string[];
  location?: string;
}

/**
 * Continuity map for a single segment
 */
export interface ContinuityRefs {
  continuityRefsByCharacter: Record<string, string>;  // { "John": "segment_17" }
  locationRef?: string;                              // "segment_22"
  firstAppearanceByCharacter: string[];              // ["Mary"] (first time appearing)
  appearanceByCharacter: Record<string, string>;     // { "John": "john_default" }
  identityLocklineByCharacter: Record<string, string>; // { "John": "elderly, wiry frame..." }
}

/**
 * Rolling state for cross-batch continuity
 */
export interface ContinuityState {
  lastSeenCharacter: Record<string, { segmentId: string; index: number; storylineId?: string }>;
  lastSeenLocation: Record<string, { segmentId: string; index: number; storylineId?: string }>;
  recentPrompts: string[];
  usedCameraMoves: string[];
  updatedAt: string;
}

/**
 * Alias normalization map
 */
const ALIAS_MAP: Record<string, string> = {
  'yohanan': 'john',
  'ioannes': 'john',
  'johannes': 'john',
  'the island': 'patmos island',
  'patmos': 'patmos island',
  'heaven throne': 'throne room',
  'heavenly throne': 'throne room',
  // Add more aliases as needed
};

/**
 * Normalize name using alias map
 */
export function normalizeName(name: string): string {
  const lower = name.toLowerCase().trim();
  return ALIAS_MAP[lower] || name;
}

/**
 * Build continuity map for a batch of segments
 */
export function buildContinuityMap(
  segments: SegmentInput[],
  assets: Asset[],
  characterProfiles: Record<string, CharacterProfile>,
  priorState?: ContinuityState
): { 
  continuityMap: Record<string, ContinuityRefs>; 
  finalState: ContinuityState;
} {
  // Initialize state from prior or empty
  const lastSeenCharacter = priorState?.lastSeenCharacter || {};
  const lastSeenLocation = priorState?.lastSeenLocation || {};
  
  const continuityMap: Record<string, ContinuityRefs> = {};
  
  // Process each segment in order
  for (const seg of segments) {
    const continuityRefsByCharacter: Record<string, string> = {};
    const firstAppearanceByCharacter: string[] = [];
    const appearanceByCharacter: Record<string, string> = {};
    const identityLocklineByCharacter: Record<string, string> = {};
    
    // Normalize character names
    const normalizedCharacters = (seg.characters || []).map(normalizeName);
    
    // Per-character continuity
    for (const charName of normalizedCharacters) {
      const lastSeen = lastSeenCharacter[charName];
      
      // Check storyline match (if applicable)
      const storylineMatch = !seg.storylineId || !lastSeen?.storylineId || 
                            lastSeen.storylineId === seg.storylineId;
      
      if (lastSeen && storylineMatch) {
        // Has continuity reference
        continuityRefsByCharacter[charName] = lastSeen.segmentId;
        
        // Assign appearance state
        const profile = characterProfiles[charName];
        if (profile) {
          const stateId = profile.defaultStateId;  // For now, use default; extend for state transitions
          appearanceByCharacter[charName] = stateId;
          
          // Get identity lockline
          const state = profile.states[stateId];
          if (state) {
            identityLocklineByCharacter[charName] = state.summary;
          }
        }
      } else {
        // First appearance
        firstAppearanceByCharacter.push(charName);
        
        // Assign default appearance state
        const profile = characterProfiles[charName];
        if (profile) {
          const stateId = profile.defaultStateId;
          appearanceByCharacter[charName] = stateId;
          
          const state = profile.states[stateId];
          if (state) {
            identityLocklineByCharacter[charName] = state.summary;
          }
        }
      }
    }
    
    // Location continuity
    let locationRef: string | undefined;
    if (seg.location) {
      const normalizedLoc = normalizeName(seg.location);
      const lastSeenLoc = lastSeenLocation[normalizedLoc];
      
      const storylineMatch = !seg.storylineId || !lastSeenLoc?.storylineId || 
                            lastSeenLoc.storylineId === seg.storylineId;
      
      if (lastSeenLoc && storylineMatch) {
        locationRef = lastSeenLoc.segmentId;
      }
    }
    
    // Store continuity refs for this segment
    continuityMap[seg.id] = {
      continuityRefsByCharacter,
      locationRef,
      firstAppearanceByCharacter,
      appearanceByCharacter,
      identityLocklineByCharacter
    };
    
    // Update last-seen tracking AFTER computing refs (so we don't self-reference)
    for (const charName of normalizedCharacters) {
      lastSeenCharacter[charName] = {
        segmentId: seg.id,
        index: seg.index,
        storylineId: seg.storylineId
      };
    }
    
    if (seg.location) {
      const normalizedLoc = normalizeName(seg.location);
      lastSeenLocation[normalizedLoc] = {
        segmentId: seg.id,
        index: seg.index,
        storylineId: seg.storylineId
      };
    }
  }
  
  // Return map and updated state
  const finalState: ContinuityState = {
    lastSeenCharacter,
    lastSeenLocation,
    recentPrompts: priorState?.recentPrompts || [],
    usedCameraMoves: priorState?.usedCameraMoves || [],
    updatedAt: new Date().toISOString()
  };
  
  return { continuityMap, finalState };
}

/**
 * Load or generate character profiles from assets
 */
export function loadCharacterProfiles(assets: Asset[]): Record<string, CharacterProfile> {
  const profiles: Record<string, CharacterProfile> = {};
  
  for (const asset of assets) {
    if (asset.type === 'character') {
      const name = normalizeName(asset.name);
      
      // Build appearance state from visual attributes
      const visualAttrs = asset.visual_attributes || {};
      const summary = buildSummaryFromAttributes(visualAttrs);
      const forbiddenTraits = extractForbiddenTraits(visualAttrs);
      
      const defaultState: AppearanceState = {
        id: `${name.toLowerCase().replace(/\s+/g, '_')}_default`,
        summary,
        forbiddenTraits
      };
      
      profiles[name] = {
        assetName: name,
        defaultStateId: defaultState.id,
        states: {
          [defaultState.id]: defaultState
        }
      };
    }
  }
  
  return profiles;
}

/**
 * Build summary from visual attributes
 */
function buildSummaryFromAttributes(attrs: any): string {
  const parts: string[] = [];
  
  if (attrs.age) parts.push(attrs.age);
  if (attrs.build || attrs.physique) parts.push(attrs.build || attrs.physique);
  if (attrs.hair) parts.push(attrs.hair);
  if (attrs.beard) parts.push(attrs.beard);
  if (attrs.skin || attrs.complexion) parts.push(attrs.skin || attrs.complexion);
  if (attrs.clothing || attrs.wardrobe) parts.push(attrs.clothing || attrs.wardrobe);
  
  return parts.join(', ');
}

/**
 * Extract forbidden trait keywords from visual attributes
 */
function extractForbiddenTraits(attrs: any): string[] {
  const traits: string[] = [];
  
  // Add all trait keywords that should not be re-described
  if (attrs.age) traits.push('age', 'years', 'old', 'young');
  if (attrs.eyes) traits.push('eyes');
  if (attrs.hair) traits.push('hair');
  if (attrs.beard) traits.push('beard');
  if (attrs.skin) traits.push('skin', 'complexion');
  if (attrs.build) traits.push('build', 'frame', 'physique');
  if (attrs.height) traits.push('height', 'tall', 'short');
  if (attrs.clothing) traits.push('clothes', 'robe', 'cloak', 'wardrobe', 'clothing');
  
  return traits;
}

