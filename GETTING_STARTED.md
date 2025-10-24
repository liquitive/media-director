# Getting Started with Sora Video Director

## Installation

### Prerequisites

1. **VS Code or Cursor**: Version 1.85.0 or higher
2. **FFmpeg**: Required for video processing
   ```bash
   # macOS
   brew install ffmpeg
   
   # Windows (via Chocolatey)
   choco install ffmpeg
   
   # Linux
   sudo apt install ffmpeg
   ```
3. **OpenAI API Key**: Get one from [platform.openai.com](https://platform.openai.com/api-keys)

### Install Extension

#### Option 1: From Source (Development)

```bash
# Clone and navigate to the extension directory
cd /Users/vdarevsk/Work/sora/sora-director-vscode

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Open in VS Code
code .

# Press F5 to launch Extension Development Host
```

#### Option 2: Install VSIX (When Available)

```bash
# Install from .vsix file
code --install-extension sora-director-0.1.0.vsix
```

## First-Time Setup

### 1. Configure API Key

1. Open VS Code Settings (⌘, or Ctrl+,)
2. Search for "Sora"
3. Enter your OpenAI API Key in `sora.apiKey`
4. Or use Command Palette:
   ```
   Cmd+Shift+P → Preferences: Open Settings (UI)
   Search: sora.apiKey
   ```

### 2. Verify FFmpeg

```bash
# Check FFmpeg is installed
ffmpeg -version

# If not found, specify path in settings
"sora.ffmpegPath": "/opt/homebrew/bin/ffmpeg"
```

### 3. Set Output Directory

```json
{
  "sora.outputDirectory": "${workspaceFolder}/sora-output"
}
```

## Your First Video

### Method 1: Text to Video

1. **Open Sora Sidebar**
   - Click the Sora icon (film icon) in the Activity Bar
   
2. **Create New Story**
   - Click "+" button in sidebar
   - Enter story name: "My First Video"
   - Select input type: "Text Input"
   - Paste some lyrics or descriptive text:
     ```
     Walking through the rain
     City lights are fading
     Lost in memories again
     Dreams are slowly wading
     ```

3. **Generate Director's Script**
   - Right-click your story
   - Select "Generate Director's Script"
   - Wait for GPT-4 to analyze and create visual prompts
   - Script will open in editor when ready

4. **Execute Production**
   - Right-click your story again
   - Select "Execute Video Production"
   - Monitor progress in status bar
   - Check Output panel for details

5. **View Final Video**
   - Right-click completed story
   - Select "View Media"
   - Final video opens in system player

### Method 2: Quick Import from Audio

1. **Quick Import**
   - Click folder icon in sidebar
   - Select an MP3 or audio file
   - Wait for automatic transcription

2. **Review Transcription**
   - Story created automatically with extracted lyrics
   - Open story to view script

3. **Generate & Execute**
   - Generate script (automatically created from transcription)
   - Execute production
   - View media when complete

## Common Workflows

### Workflow 1: Music Video Creation

```
1. Prepare audio file (MP3, WAV, M4A)
2. Quick Import → Select audio file
3. Wait for transcription
4. Review generated script
5. Execute production
6. Final video synced with audio
```

### Workflow 2: Text-Based Story

```
1. Write or paste script/lyrics
2. Create Story → Text Input
3. Generate Director's Script
4. Edit script if needed
5. Execute production
6. View final video
```

### Workflow 3: Video Remix

```
1. Import existing video
2. Audio extracted automatically
3. Transcription generated
4. New script created
5. New video generated with same audio
```

## Understanding the Interface

### Sidebar Icons

- `+` Create New Story
- `📁` Quick Import
- `🔄` Refresh Stories

### Story Status

- ✏️ Draft - Ready to generate script
- 🔍 Analyzing - Generating director's script
- 🎬 Generating - Creating video segments
- 🎞️ Compiling - Assembling final video
- ✅ Completed - Ready to view
- ❌ Error - Check logs

### Right-Click Menu

- **Open Story** - View/edit director's script
- **Generate Director's Script** - AI script generation
- **Execute Video Production** - Start video generation
- **View Media** - Open final video
- **Delete Story** - Remove story and files

## Tips & Tricks

### 1. Multiple Stories

You can work on multiple stories simultaneously:
- Each story generates independently
- Configure max parallel workers in settings
- Monitor queue status in status bar

### 2. Script Editing

After script generation:
- Open story to view script.md
- Edit visual prompts directly
- Save changes
- Re-execute production

### 3. Progress Monitoring

- Click Sora icon in status bar
- View Output panel: "Sora Video Director"
- Check detailed logs and progress

### 4. Organizing Projects

```
workspace/
└── sora-output/
    └── stories/
        ├── music-video-1/
        ├── short-film/
        └── experimental/
```

### 5. Optimizing Settings

```json
{
  // Use sora-2-pro for higher quality
  "sora.model": "sora-2-pro",
  
  // Increase parallel workers (if you have quota)
  "sora.maxParallelStories": 5,
  
  // Custom output location
  "sora.outputDirectory": "/Users/you/Videos/Sora"
}
```

## Troubleshooting

### Issue: "API Key not configured"
**Solution:** Set `sora.apiKey` in settings

### Issue: "FFmpeg not found"
**Solution:** Install FFmpeg or set `sora.ffmpegPath`

### Issue: Video generation fails
**Solutions:**
- Check API quota and billing
- Verify Sora API access enabled
- Check prompt length (< 500 chars)
- Review Output panel for errors

### Issue: Slow generation
**Notes:**
- Sora API can take 1-5 minutes per segment
- This is normal - check queue status
- Multiple stories run in parallel

### Issue: No transcription
**Solutions:**
- Ensure audio file is valid
- Check file format (MP3, WAV, M4A supported)
- Verify API key has Whisper access

## Advanced Usage

### Custom Prompts

Edit the director's script directly:

```markdown
### Segment 1

**Duration:** 8s | **Start Time:** 0s

**Visual Prompt:**
A lone figure walking through neon-lit streets at night, 
rain falling, reflections on wet pavement, cinematic wide shot, 
moody blue and pink lighting, 4K quality

**Camera Work:** Tracking shot, following from behind
**Lighting:** Neon lights, dramatic shadows
```

### Batch Processing

Create multiple stories from a folder:

```bash
# Create stories programmatically
for file in *.mp3; do
  echo "Importing $file"
  # Use Quick Import command
done
```

### Export & Share

```bash
# Find your videos
cd ~/workspace/sora-output/stories/my-story/completed

# Share final video
open my-story.mp4
```

## Next Steps

1. ✅ Create your first video
2. ✅ Experiment with different prompts
3. ✅ Try multiple stories in parallel
4. ✅ Customize settings for your workflow
5. ✅ Share your creations!

## Resources

- [OpenAI Sora Documentation](https://platform.openai.com/docs/guides/sora)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [VS Code Extension API](https://code.visualstudio.com/api)

## Support

- Check Output panel for detailed logs
- Review error messages carefully
- Verify all prerequisites installed
- Check API quota and billing status

## Happy Creating! 🎬

---

**Questions?** Check the [README](README.md) for more details or submit an issue on GitHub.










