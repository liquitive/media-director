# Atomic Segment Processing Implementation - October 20, 2025

## Problem

Previously, segment generation happened in **two separate loops**:

1. **"Generating 53 segment scripts"** - AI generates all segments with basic fields (`visualPrompt`, `cameraWork`, `lighting`, `mood`)
2. **"Preparing 53 segments for production"** - Processes all segments (validate tags, build `rawVisualPrompt`, optimize to `finalPrompt`)

This created a disconnect in the progress tree where segments appeared to be "done" after generation, but then required a second processing phase.

### User Requirement
**Each segment should be processed atomically as a single, complete unit:**
1. Generate script content (AI call)
2. Validate tags and resolve assets
3. Build complete `rawVisualPrompt` with TAGS section
4. Optimize to `finalPrompt`
5. Save to disk

All operations for each segment should be bundled under **one progress node** per segment.

## Solution

### Architecture

Implemented a **callback-based atomic processor** that integrates segment generation and processing into a single flow:

```
▼ 🔄 Regenerating: "Story Name"
  ✅ 🎨 Extract Assets
  ✅ 🖼️  Generate Asset Images
  ▼ 🎬 Generate Director's Script
    ▼ 📝 Batch 1/6: Segments 1-10
      ✅ 📍 segment_1 (1/53) → ✅ Production-ready
      ✅ 📍 segment_2 (2/53) → ✅ Production-ready
      ...
      ✅ 📍 segment_10 (10/53) → ✅ Production-ready
    ▼ 📝 Batch 2/6: Segments 11-20
      ✅ 📍 segment_11 (11/53) → ✅ Production-ready
      🔄 📍 segment_12 (12/53) → Processing...
      ⏳ 📍 segment_13 (13/53)
      ...
```

## Implementation Details

### 1. `aiService.ts` - Added Segment Processor Callback

**Modified Function Signature (Lines 111-121)**:
```typescript
async generateScriptFromTimingMap(
    content: string,
    timingMap: any,
    assetLibrary?: any[],
    researchText?: string,
    storyId?: string,
    storyService?: any,
    progressManager?: any,
    parentTaskId?: string,
    segmentProcessor?: (segmentData: any, segmentIndex: number, totalSegments: number, batchTaskId?: string) => Promise<any>
): Promise<any>
```

**Key Addition**: `segmentProcessor` callback parameter allows external processing of each segment immediately after generation.

**Processor Integration (Lines 352-366)**:
```typescript
// ATOMIC SEGMENT PROCESSING: If processor provided, fully process this segment now
if (segmentProcessor) {
    try {
        const processedSegment = await segmentProcessor(segmentData, segmentIndex, totalSegments, batchTaskId || undefined);
        // Update the segment in allVisualDescriptions with the processed version
        if (processedSegment) {
            allVisualDescriptions[allVisualDescriptions.length - 1] = processedSegment;
        }
    } catch (error) {
        logger.error(`Failed to process segment ${segmentIndex + 1}:`, error);
        if (batchTaskId && progressManager) {
            progressManager.failTask(batchTaskId, `❌ Failed to process segment ${segmentIndex + 1}`);
        }
        throw error;
    }
}
```

### 2. `commands/index.ts` - Atomic Processor Implementation

**Segment Processor Function (Lines 929-955)**:
```typescript
const processedSegments: any[] = [];
const segmentProcessor = async (segmentData: any, segmentIndex: number, totalSegments: number, batchTaskId?: string) => {
    const segTaskId = `seg_${segmentIndex + 1}_${Date.now()}`;
    progressManager.startTask(segTaskId, `📍 segment_${segmentIndex + 1} (${segmentIndex + 1}/${totalSegments})`, batchTaskId || scriptTaskId);
    
    try {
        // Create a temporary story with just this segment for processing
        const tempStory = {
            ...story,
            directorScript: [segmentData]
        };
        
        // Process the segment: validate, build rawVisualPrompt, optimize
        await executionService.preResolveTagsForStory(tempStory);
        
        const processedSegment = tempStory.directorScript[0];
        processedSegments[segmentIndex] = processedSegment;
        
        progressManager.completeTask(segTaskId, `✅ Production-ready`);
        return processedSegment;
    } catch (error: any) {
        logger.error(`Failed to process segment ${segmentIndex + 1}:`, error);
        progressManager.failTask(segTaskId, `❌ ${error?.message || 'Processing failed'}`);
        throw error;
    }
};
```

**What It Does**:
1. Creates a progress node for the segment
2. Wraps the segment in a temporary story object
3. Calls `executionService.preResolveTagsForStory()` which:
   - Validates tags and resolves/generates missing assets
   - Builds complete `rawVisualPrompt` with TAGS, SCENE, CAMERA, LIGHTING, MOOD
   - Validates the segment structure
   - Optimizes to `finalPrompt`
   - Saves to disk
4. Stores the processed segment
5. Marks progress node as complete

### 3. `commands/createStoryWizard.ts` - Same Pattern for New Stories

Applied identical atomic processing pattern for new story creation (Lines 737-762).

## Flow Comparison

### Before (Two Separate Loops)
```
1. Generate all 53 segments (with basic fields)
   - Segment 1: visualPrompt, cameraWork, lighting, mood
   - Segment 2: visualPrompt, cameraWork, lighting, mood
   - ...
   - Segment 53: visualPrompt, cameraWork, lighting, mood

2. Process all 53 segments (build rawVisualPrompt, validate, optimize)
   - Segment 1: complete processing
   - Segment 2: complete processing
   - ...
   - Segment 53: complete processing
```

### After (Atomic Processing)
```
Batch 1:
  - Generate segments 1-10 (AI batch call for efficiency)
  - For each segment in batch:
    - Segment 1: generate → validate → build rawVisualPrompt → optimize → save
    - Segment 2: generate → validate → build rawVisualPrompt → optimize → save
    - ...
    - Segment 10: generate → validate → build rawVisualPrompt → optimize → save

Batch 2:
  - Generate segments 11-20 (AI batch call)
  - For each segment in batch:
    - Segment 11: generate → validate → build rawVisualPrompt → optimize → save
    - ...
```

## Benefits

1. **Atomic Units**: Each segment is fully complete before moving to the next
2. **Clear Progress**: One progress node per segment showing all operations
3. **Fail-Fast**: If a segment fails validation, processing stops immediately
4. **No Separate "Preparation" Phase**: Everything happens during generation
5. **Real-Time Persistence**: Segments are saved immediately after completion
6. **Hierarchical View**: Batch → Segment hierarchy in progress tree

## Progress Tree Structure

```
▼ 🔄 Regenerating: "The Trumpet and the Silence"
  ✅ 🎨 Extract Assets
  ✅ 🖼️  Generate Asset Images
  ▼ 🎬 Generate Director's Script
    ▼ 📝 Batch 1/6: Segments 1-10
      ✅ 📍 segment_1 (1/53)
          ✅ Production-ready
      ✅ 📍 segment_2 (2/53)
          ✅ Production-ready
      ...
    ▼ 📝 Batch 2/6: Segments 11-20
      🔄 📍 segment_12 (12/53)
          🔄 Processing...
      ⏳ segment_13 (13/53)
      ...
```

## Files Modified

1. **`/Users/vdarevsk/Work/sora/sora-director-vscode/src/services/aiService.ts`**
   - Added `segmentProcessor` callback parameter
   - Integrated processor call within batch loop
   - Maintains backward compatibility (fallback to save-only if no processor)

2. **`/Users/vdarevsk/Work/sora/sora-director-vscode/src/commands/index.ts`**
   - Implemented `segmentProcessor` function for regeneration
   - Removed separate `preResolveTagsForStory` call
   - Uses processed segments directly

3. **`/Users/vdarevsk/Work/sora/sora-director-vscode/src/commands/createStoryWizard.ts`**
   - Implemented same `segmentProcessor` function for new story creation
   - Removed separate `preResolveTagsForStory` call

## Validation Integration

Each segment now goes through **strict validation** as part of atomic processing:
- ✅ `rawVisualPrompt` must exist and have TAGS section
- ✅ `rawVisualPrompt` must have SCENE section
- ✅ All tags in SCENE must be defined in TAGS section
- ✅ All `usedAssets` must be accessible
- ❌ **If validation fails, entire process stops with detailed error**

## Testing

Run script regeneration and observe:
1. No more separate "Preparing segments for production" phase
2. Each segment appears under its batch with complete processing
3. Segments show "✅ Production-ready" when fully complete
4. Progress tree shows clear batch → segment hierarchy
5. Completed batches auto-collapse, running batch stays expanded

## Next Steps

This atomic processing pattern is now the standard for all segment generation:
- ✅ Regenerate scripts (index.ts)
- ✅ New story creation (createStoryWizard.ts)
- Future: Could be extended to selective segment regeneration




