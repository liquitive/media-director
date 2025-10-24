# Storyline Editor - Fixed to Open in Main Editor Area

## Problem
The Storyline Editor was appearing in the **left sidebar panel** instead of opening as a **full editor tab** in the center area.

## Root Cause
- Registered as `WebviewView` (sidebar component)
- Used `registerWebviewViewProvider` (limited to sidebar)

## Solution
Changed to open as a **WebviewPanel** (main editor area).

## Changes Made

### 1. package.json ✅
**Removed** from views section:
```json
// REMOVED: Storyline Editor from sidebar views
{
  "id": "sora.storylineEditor",
  "name": "Storyline Editor",
  "type": "webview"
}
```

**Removed** activation event:
```json
// REMOVED: "onView:sora.storylineEditor"
```

**Kept** command registration:
```json
{
  "command": "sora.openStorylineEditor",
  "title": "Open Storyline Editor",
  "category": "Sora"
}
```

### 2. extension.ts ✅
**Changed** registration approach:
```typescript
// OLD: Sidebar view registration
vscode.window.registerWebviewViewProvider(...)

// NEW: Store provider for command access
const storylineEditorProvider = new StorylineEditorProvider(...);
(context as any).storylineEditorProvider = storylineEditorProvider;
```

### 3. commands/index.ts ✅
**Changed** command handler:
```typescript
// OLD: Focus sidebar view
await vscode.commands.executeCommand('sora.storylineEditor.focus');

// NEW: Create WebviewPanel in main editor
const panel = vscode.window.createWebviewPanel(
    'soraStorylineEditor',
    'Storyline Editor',
    vscode.ViewColumn.One,  // Opens in center editor area
    {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [...]
    }
);
```

**Added** HTML generation function:
```typescript
function getStorylineEditorHtml(webview, storyId)
// Returns full HTML with timeline UI
```

## How It Works Now

### Opening the Editor
```
User: Right-click story → "Open Storyline Editor"
    ↓
Command: sora.openStorylineEditor(storyId)
    ↓
Create WebviewPanel in main editor area
    ↓
Load HTML/CSS/JS for timeline interface
    ↓
Editor opens as a new tab in center (like script.json)
```

### Result
- ✅ Opens in **main editor area** (center)
- ✅ Full-screen timeline interface
- ✅ Opens as a **tab** (like other editors)
- ✅ More space for video player and timeline
- ✅ Can have multiple storyline editors open
- ✅ Tabbed interface for easy switching

## Testing

After reloading the extension:

1. **Right-click a story** in the tree view
2. **Click "Open Storyline Editor"**
3. **Should see**: Editor opens in center as a tab
4. **Should NOT see**: Editor in left sidebar

## Visual Comparison

### Before ❌
```
┌─────────────┬──────────────────┐
│ Stories     │  script.json     │
│ Assets      │                  │
│ Progress    │  (center area)   │
│ STORYLINE   │                  │
│ EDITOR      │                  │
│ [video]     │                  │
│ [timeline]  │                  │
└─────────────┴──────────────────┘
```

### After ✅
```
┌─────────────┬──────────────────────────┐
│ Stories     │ Storyline Editor (tab)   │
│ Assets      │  [video player]          │
│ Progress    │  [playback controls]     │
│             │  [timeline - full width] │
│             │  [Audio layer]           │
│             │  [Transcript layer]      │
│             │  [Script layer]          │
│             │  [Video layer]           │
└─────────────┴──────────────────────────┘
```

## Compilation Status
✅ Compiles without errors
✅ All TypeScript types valid
✅ Ready to test

## Next Steps

1. **Reload VS Code** to apply changes
2. **Right-click a story** → "Open Storyline Editor"
3. **Should open in center** as a full editor tab

---

**Fix Applied**: 2025-10-19  
**Status**: ✅ Ready to test










