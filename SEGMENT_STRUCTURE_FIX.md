# Segment Structure Fix - October 20, 2025

## Issues Identified

1. **`rawVisualPrompt` missing complete structure**: Segment files had a basic `rawVisualPrompt` field but it lacked the full TAGS, SCENE, CAMERA, LIGHTING, MOOD sections.

2. **Legacy fields not removed**: Segment files still contained `visualPrompt`, `cameraWork`, `lighting`, and `mood` fields which should have been consolidated into `rawVisualPrompt`.

3. **Optimization losing character details**: The `finalPrompt` was adding irrelevant attributes (like "deep voice") and not preserving exact visual character descriptions from the TAGS section.

## Root Causes

1. **Script generation** (`aiService.ts`) was saving segments with legacy fields but not building the complete `rawVisualPrompt` with TAGS section.

2. **Tag resolution** (`executionService.ts`) was checking if `rawVisualPrompt` already exists and skipping the rebuild, even though it was incomplete.

3. **Optimization prompts** were not explicitly instructing the AI to preserve only VISUAL details and avoid adding non-visual attributes.

## Changes Made

### 1. aiService.ts - Script Generation (Lines 337-369)
- **Before**: Segments were saved with legacy fields AND a basic `rawVisualPrompt`
- **After**: Segments are saved with ONLY legacy fields (`visualPrompt`, `cameraWork`, `lighting`, `mood`) with a comment noting that `rawVisualPrompt` will be built during `preResolveTagsForStory`
- **Rationale**: Separates concerns - script generation focuses on content, tag resolution builds the complete production-ready structure

### 2. executionService.ts - Tag Resolution (Lines 737-870)
- **Before**: 
  - Skipped segments that had ANY `rawVisualPrompt` and `finalPrompt`
  - Only built `rawVisualPrompt` if it didn't exist
- **After**:
  - Checks if `rawVisualPrompt` contains complete TAGS section before skipping
  - ALWAYS rebuilds `rawVisualPrompt` if:
    - It doesn't exist, OR
    - It doesn't include "TAGS:" section, OR
    - Legacy component parts exist (`visualPrompt`, `cameraWork`, `lighting`, `mood`)
  - Removes legacy fields after building complete `rawVisualPrompt`
- **Rationale**: Ensures every segment gets a complete, production-ready `rawVisualPrompt` with full TAGS definitions

### 3. ideAIProvider.ts & openaiService.ts - Optimization Prompts (Lines 434-452 & 146-164)
- **Enhanced instructions**:
  - "REPLACE all [[tags]] with their EXACT VISUAL descriptions from the TAGS section"
  - "PRESERVE ALL VISUAL CHARACTER DETAILS from the TAGS section (age, appearance, clothing, features). These are critical for consistency."
  - "DO NOT ADD attributes not present in the tags (like 'deep voice', 'gentle manner', etc). Only use VISUAL details."
  - "All entities fully described using ONLY the visual details from TAGS section"
- **Rationale**: Ensures AI optimization preserves character continuity and doesn't hallucinate irrelevant attributes

## Expected Results

### Segment Structure (After Processing)
```json
{
  "version": "1.0",
  "storyId": "story_xxxxx",
  "segmentIndex": 0,
  "id": "segment_1",
  "text": "Lyric text here",
  "duration": 7.02,
  "startTime": 0,
  "actualDuration": 7.02,
  "status": "pending",
  "usedAssets": ["character_narrator", "location_island"],
  "rawVisualPrompt": "TAGS:\n[[narrator]] = Weathered man with gray hair, aged 60s, contemplative expression...\n[[island]] = Remote Caribbean island, lush vegetation, isolated...\n\nSCENE:\n[[narrator]] standing on the [[island]], staring at the horizon...\n\nCAMERA:\nSlow establishing shot...\n\nLIGHTING:\nMuted tones of grey and blue...\n\nMOOD:\nAnticipation, solitude, peacefulness",
  "finalPrompt": "Weathered man with gray hair, aged 60s, stands on remote Caribbean island with lush vegetation, staring at horizon. Slow establishing shot with muted grey-blue tones, shallow DoF. Serene, anticipatory mood. 35mm lens."
}
```

### Key Improvements
1. **No legacy fields**: `visualPrompt`, `cameraWork`, `lighting`, `mood` are removed
2. **Complete `rawVisualPrompt`**: Includes full TAGS section with asset descriptions
3. **Clean `finalPrompt`**: No [[tags]], preserves exact character details, no hallucinated attributes

## Testing Instructions

1. **For existing segments with incomplete structure**:
   - Run "Generate Videos" on a story
   - The `preResolveTagsForStory` process will rebuild all incomplete segments
   - Check segment files to verify `rawVisualPrompt` has TAGS section
   - Verify `finalPrompt` has no [[tags]] and preserves character details

2. **For new stories**:
   - Create a new story
   - During script generation, segments will be saved with legacy fields
   - During video generation prep, segments will be converted to complete structure
   - Verify final segment structure matches expected format above

## Files Modified
- `/Users/vdarevsk/Work/sora/sora-director-vscode/src/services/aiService.ts`
- `/Users/vdarevsk/Work/sora/sora-director-vscode/src/services/executionService.ts`
- `/Users/vdarevsk/Work/sora/sora-director-vscode/src/services/ideAIProvider.ts`
- `/Users/vdarevsk/Work/sora/sora-director-vscode/src/services/openaiService.ts`

## Next Steps
1. Test with existing "the_trumpet_and_the_silence" story
2. Run "Generate Videos" to trigger segment reprocessing
3. Verify segment files have complete structure
4. Verify `finalPrompt` quality and character detail preservation






