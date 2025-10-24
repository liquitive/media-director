# Progress Hierarchy Fix - October 20, 2025

## Issue
The progress tree was not showing detailed progress for script generation batches and individual segments. Updates were being logged to the console but not reflected in the progress tree UI.

**Problem:**
- All progress updates were going to the parent task (`scriptGenTaskId`)
- Each update would overwrite the previous message
- No hierarchical structure showing batches → segments
- Completed batches would disappear from view

## Solution
Implemented a hierarchical progress structure with **child tasks for each batch**, where each batch task updates as segments are processed.

### Changes Made

#### `/Users/vdarevsk/Work/sora/sora-director-vscode/src/services/aiService.ts`

**1. Create Child Task for Each Batch (Lines 209-213)**
```typescript
// Create a child task for this batch
const batchTaskId = scriptGenTaskId ? `batch_${batchNum}_${Date.now()}` : null;
if (batchTaskId && progressManager && scriptGenTaskId) {
    progressManager.startTask(batchTaskId, `📝 Batch ${batchNum}/${totalBatches}: Segments ${i + 1}-${i + batch.length}`, scriptGenTaskId);
}
```

**2. Update Batch Task as Segments are Saved (Lines 358-364)**
```typescript
// Report progress for this specific segment within the batch
if (batchTaskId && progressManager) {
    const segmentInBatch = j + 1;
    const batchProgress = Math.round((segmentInBatch / batch.length) * 100);
    progressManager.updateTask(batchTaskId, 'running', 
        `💾 Saved segment ${segmentIndex + 1}/${totalSegments} (${batchProgress}% of batch)`);
}
```

**3. Complete Batch Task After All Segments Processed (Lines 374-377)**
```typescript
// Complete the batch task
if (batchTaskId && progressManager) {
    progressManager.completeTask(batchTaskId, `✅ Completed ${batch.length} segments`);
}
```

**4. Handle Batch Failures (Lines 380-382)**
```typescript
if (batchTaskId && progressManager) {
    progressManager.failTask(batchTaskId, `❌ Failed at batch ${batchNum}/${totalBatches}`);
}
```

## Expected Behavior

### Progress Tree Structure
```
▼ 📝 Generate Director's Script
  ✅ 📝 Batch 1/6: Segments 1-10
  ✅ 📝 Batch 2/6: Segments 11-20
  ▶ 📝 Batch 3/6: Segments 21-30
     💾 Saved segment 25/53 (50% of batch)
  ⏳ 📝 Batch 4/6: Segments 31-40
  ⏳ 📝 Batch 5/6: Segments 41-50
  ⏳ 📝 Batch 6/6: Segments 51-53
```

### Auto-Collapse/Expand Behavior
- **Completed batches** (✅) auto-collapse
- **Running batch** (🔄) auto-expands and shows live updates
- **Pending batches** (⏳) remain collapsed
- **Failed batch** (❌) shows error message

### Live Updates
As each segment is saved within a batch, you'll see:
- `💾 Saved segment 21/53 (10% of batch)`
- `💾 Saved segment 22/53 (20% of batch)`
- `💾 Saved segment 23/53 (30% of batch)`
- etc.

When the batch completes:
- `✅ Completed 10 segments`

## Benefits

1. **Hierarchical Visibility**: Clear parent → child structure showing overall progress and batch-level detail
2. **Real-Time Updates**: Each segment save is immediately reflected in the UI
3. **Batch Context**: Users can see which batch is currently processing
4. **History Preservation**: Completed batches remain visible (collapsed) showing what's been done
5. **Error Isolation**: If a batch fails, the specific batch is marked with error, not just the parent task

## Testing

Run script regeneration on any story and observe:
1. Parent task "Generate Director's Script" should show all batches as children
2. Each batch should expand while processing and show segment-by-segment saves
3. Completed batches should auto-collapse with checkmark
4. Progress should match console log output

## Related Files
- `/Users/vdarevsk/Work/sora/sora-director-vscode/src/services/aiService.ts` - Script generation with batch progress
- `/Users/vdarevsk/Work/sora/sora-director-vscode/src/services/progressManager.ts` - Progress tree rendering and auto-collapse logic




