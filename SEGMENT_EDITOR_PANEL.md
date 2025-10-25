# Segment Editor Panel Implementation

## Overview

A comprehensive webview-based segment editor panel has been implemented, following the same design pattern as the Editor's Notes panel. This provides a robust interface for editing segment prompts, continuity references, narrative context, and all other editable segment properties.

## Features

### 1. **Segment Selector**
- Dropdown to switch between segments within the same story
- Shows segment number and a brief text preview
- Automatically loads the selected segment

### 2. **Read-only Information Display**
The following fields are displayed but not editable (as per requirements):
- Segment ID
- Status
- Story ID
- Segment Index
- Created At
- Version
- Text/Narration (from audio transcript)

### 3. **Editable Fields**

#### Video Prompt
- Main textarea for the visual scene description
- Core prompt sent to Sora for video generation
- Supports multi-line detailed descriptions

#### Timing Controls
- Duration (seconds): Input field with min/max validation
- Start Time (seconds): When the segment starts in the overall video

#### Continuity Reference
- **Reference Segment**: Dropdown populated with all previous segments
  - Allows linking to a specific previous segment for visual continuity
  - Option for "None (standalone segment)"
- **Continuity Type**: Dropdown with predefined types
  - None
  - Location (same setting)
  - Character (same character(s))
  - Visual (same style/lighting)
  - Action (continuous action)

#### Narrative Context
All fields help the AI understand the narrative purpose:
- **Scene Type**: Dropdown with options
  - Establishing, Action, Dialogue, Transition, Climax, Resolution
- **Character Focus**: Comma-separated list of characters
  - Automatically parsed into an array on save
- **Location**: Text input for the setting/location name
- **Emotional Tone**: Text input for the emotional atmosphere

#### Used Assets
- JSON array input for asset IDs
- Validated on save to ensure proper format
- Example: `["character_john", "location_patmos_shore"]`

#### Additional Properties
- **Video Path**: Path to the generated video file (if available)
- **Additional JSON Properties**: Textarea for any custom properties
  - Validated as JSON on save
  - Merged with the segment data

### 4. **Actions**

#### Save Segment
- Validates all inputs (JSON fields, numeric fields)
- Updates the segment in the story's `directorScript` array
- Saves to the segment JSON file (`segments/segment_N.json`)
- Updates the story in memory via `storyService`
- Shows success/error notification

#### Reload
- Reloads the current segment from the file/memory
- Useful if changes were made externally

#### Reset to Original
- Resets all editable fields to their values when the panel was first opened
- Requires confirmation
- Does not save automatically

### 5. **UI/UX Features**

#### Professional Styling
- Matches VS Code theme colors and styling
- Responsive layout with proper spacing
- Grid layouts for related fields (2-column and 3-column)
- Color-coded status indicators
- Clear visual separation between sections

#### Segment Selector Integration
- Shows current segment at the top with a badge
- Quick switching between segments without closing the panel
- Maintains edit state when switching (shows confirmation if unsaved)

#### Continuity Reference Selector
- Only shows previous segments (can't reference future segments)
- Includes segment text preview for easy identification
- Automatically updated when switching segments

#### Error Handling
- JSON validation for `usedAssets` and additional properties
- Clear error messages displayed in-panel
- Prevents saving invalid data

#### Status Messages
- Success messages (green) for successful saves
- Error messages (red) for validation failures or save errors
- Auto-hide after 5 seconds

## Implementation Details

### Files Created/Modified

#### New Files
1. **`src/webviews/segmentEditorPanel.html`**
   - Complete HTML/CSS/JavaScript for the segment editor
   - Self-contained with embedded styles
   - VS Code webview API integration

#### Modified Files
1. **`src/commands/index.ts`**
   - Added `openSegmentEditorPanel()` function
   - Added `handleLoadSegment()` function
   - Added `handleSaveSegment()` function
   - Registered `sora.openSegmentEditorPanel` command with proper argument handling

2. **`package.json`**
   - Added command definition for `sora.openSegmentEditorPanel`
   - Added context menu entry for segments in the tree view (under "edit@1")
   - Positioned before the existing `sora.editSegment` command

### Command Registration

The command is registered to accept different argument formats:
```typescript
// From tree view (StoryTreeItem)
sora.openSegmentEditorPanel(treeItem)

// From code (explicit parameters)
sora.openSegmentEditorPanel(storyId, segmentIndex)

// From story object
sora.openSegmentEditorPanel(story, segmentIndex)
```

### Context Menu Integration

The segment editor appears in the tree view context menu:
- Location: `view == soraStories && viewItem == segment`
- Group: `edit@1` (appears first in edit section)
- Icon: `$(edit)` (VS Code pencil icon)
- Label: "Edit Segment"

### Data Flow

1. **Loading**:
   - Extension receives `loadSegment` message from webview
   - Reads segment from file (`segments/segment_N.json`) if available
   - Falls back to in-memory `story.directorScript[index]`
   - Sends segment data + all segments (for selectors) to webview

2. **Saving**:
   - Webview sends `saveSegment` message with updated data
   - Extension validates segment index
   - Updates `story.directorScript[index]` in memory
   - Writes to segment JSON file
   - Updates story via `storyService.updateStory()`
   - Sends success/error response to webview

### Segment Selector Logic

```javascript
// When segment selector changes
document.getElementById('segmentSelector').addEventListener('change', (e) => {
    const selectedIndex = parseInt(e.target.value);
    vscode.postMessage({
        command: 'loadSegment',
        segmentIndex: selectedIndex
    });
});
```

Extension maintains `currentSegmentIndex` and updates the panel title accordingly.

### Continuity Reference Selector

Populated dynamically based on current segment index:
```javascript
function populateContinuitySelector(segments, currentIndex) {
    // Only show segments 0 through currentIndex-1
    for (let i = 0; i < currentIndex; i++) {
        const seg = segments[i];
        const segId = seg.id || `segment_${i + 1}`;
        // Add option with preview text
    }
}
```

## Usage

### From Tree View
1. Navigate to a story with segments in the Sora Stories view
2. Expand the "Segments" node
3. Right-click on any segment
4. Select "Edit Segment" (first option in edit group)
5. The Segment Editor Panel opens in the main editor area

### From Command Palette
1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "Sora: Edit Segment"
3. Select the command
4. If multiple stories exist, select the story
5. Select the segment to edit

### Programmatically
```typescript
// Open editor for specific segment
await vscode.commands.executeCommand('sora.openSegmentEditorPanel', storyId, segmentIndex);

// Open editor from tree item
await vscode.commands.executeCommand('sora.openSegmentEditorPanel', treeItem);
```

## Validation Rules

### Numeric Fields
- **Duration**: Must be a valid number (typically 2-20 seconds for Sora)
- **Start Time**: Must be a valid number >= 0

### JSON Fields
- **Used Assets**: Must be a valid JSON array
  - Example: `["asset1", "asset2"]`
  - Empty string is acceptable (treated as empty array)
- **Additional Properties**: Must be valid JSON object
  - Example: `{"customKey": "value"}`
  - Empty string is acceptable (treated as empty object)

### Text Fields
- **Character Focus**: Comma-separated, automatically parsed into array
  - Example: "John, Mary" → `["John", "Mary"]`
  - Whitespace is trimmed
  - Empty values are filtered out

## Error Handling

### Save Failures
- Invalid JSON in `usedAssets` or `additionalProps` → Error shown, save prevented
- Invalid numeric values → Fallback to original values
- File system errors → Error notification + log entry
- Missing story/segment → Error response to webview

### Load Failures
- Missing segment file → Falls back to in-memory data
- Invalid segment index → Returns null, webview shows error
- Missing story → Returns null, webview shows error

## Future Enhancements

Possible improvements for future iterations:

1. **Visual Prompt Assistant**
   - AI-powered suggestions for improving prompts
   - Token counter for prompt length
   - Style consistency checker

2. **Asset Browser**
   - Visual asset picker instead of JSON input
   - Drag-and-drop asset assignment
   - Asset preview thumbnails

3. **Continuity Analyzer**
   - Smart suggestions for continuity reference
   - Visual diff between current and reference segment
   - Consistency warnings

4. **Preview Integration**
   - Inline video preview in the editor
   - Side-by-side comparison with reference segment
   - Timeline visualization

5. **Batch Editing**
   - Apply changes to multiple segments at once
   - Template-based segment creation
   - Find and replace across segments

6. **Undo/Redo**
   - Track edit history
   - Revert to previous versions
   - Compare versions

7. **Collaborative Features**
   - Comments and annotations
   - Review workflow
   - Change tracking

## Testing Checklist

- [x] Segment editor opens from tree view context menu
- [x] All read-only fields display correctly
- [x] All editable fields load correctly
- [x] Segment selector populates and switches segments
- [x] Continuity reference selector shows only previous segments
- [x] Save updates segment file and in-memory data
- [x] JSON validation works for usedAssets and additionalProps
- [x] Character focus parsing works (comma-separated to array)
- [x] Error messages display correctly
- [x] Success messages display correctly
- [x] Reset to original works
- [x] Reload works
- [x] Extension compiles without errors

## Related Files

- **Editor's Notes Panel**: `src/webviews/editorsNotes.html` (similar pattern)
- **Research Panel**: `src/webviews/editResearchResults.html` (similar pattern)
- **Segment Model**: `src/models/story.ts` (Segment interface)
- **Story Service**: `src/services/storyService.ts` (persistence)
- **Tree Provider**: `src/providers/storyTreeProvider.ts` (tree integration)

## Notes

- The editor follows the same pattern as Editor's Notes for consistency
- All segment fields except read-only system fields are editable
- Changes are saved to both file system and in-memory data
- The panel retains context when hidden (VS Code feature)
- Segment switching within the panel allows efficient editing of multiple segments
- The continuity reference system ensures proper visual consistency across segments
