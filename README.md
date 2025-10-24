# Sora Video Director - VS Code Extension

AI-powered video generation using OpenAI Sora - create music videos, visual stories, and cinematic content directly in VS Code/Cursor.

## Features

🎬 **Video Generation with Sora API**
- Generate professional video segments from text prompts
- Automatic script generation using GPT-4
- Support for sora-2 and sora-2-pro models

🎵 **Audio/Video Processing**
- Transcribe audio files using Whisper AI
- Extract lyrics from songs and videos
- Analyze audio features for mood and tempo

📝 **Director's Script Editor**
- AI-generated cinematic scripts
- Visual prompts optimized for Sora
- Edit scripts directly in VS Code

🔄 **Multi-Story Management**
- Manage multiple video projects simultaneously
- Queue-based parallel generation (up to 10 concurrent stories)
- Progress tracking and notifications

🎞️ **Video Compilation**
- Automatic compilation of video segments
- Audio synchronization with original tracks
- Professional transitions and effects

## Requirements

- **VS Code**: Version 1.85.0 or higher
- **OpenAI API Key**: Required for Sora, Whisper, and GPT-4
- **FFmpeg**: Required for video/audio processing
  - Install via Homebrew: `brew install ffmpeg`
  - Or download from [ffmpeg.org](https://ffmpeg.org/)

## Installation

### From Marketplace (Coming Soon)

1. Open VS Code/Cursor
2. Go to Extensions (⇧⌘X)
3. Search for "Sora Video Director"
4. Click Install

### From VSIX File

1. Download the `.vsix` file from releases
2. Open VS Code/Cursor
3. Go to Extensions (⇧⌘X)
4. Click "..." → "Install from VSIX..."
5. Select the downloaded file

## Setup

1. Open Settings (⌘,)
2. Search for "Sora"
3. Configure:
   - **API Key**: Your OpenAI API key
   - **Model**: sora-2 or sora-2-pro
   - **Output Directory**: Where to save generated videos
   - **FFmpeg Path**: Path to FFmpeg executable (default: `ffmpeg`)
   - **Max Parallel Stories**: Number of concurrent generations (1-10)

## Quick Start

### Creating a Story from Text

1. Click the Sora icon in the Activity Bar
2. Click "+" (Create New Story)
3. Enter story name
4. Select "Text Input"
5. Paste your lyrics or script
6. Right-click the story → "Generate Director's Script"
7. Review the generated script
8. Right-click the story → "Execute Video Production"

### Quick Import from Audio/Video

1. Click "📁" (Quick Import)
2. Select an audio or video file
3. Wait for transcription (automatic)
4. Review the extracted lyrics
5. Generate script and produce video

## Usage

### Sidebar Commands

- **Create New Story**: Start a new video project
- **Quick Import**: Import from audio/video/text file
- **Refresh Stories**: Update the story list

### Story Context Menu

Right-click any story to:
- **Open Story**: View/edit director's script
- **Analyze Content**: Generate AI script
- **Generate Script**: Same as analyze
- **Execute Production**: Generate all video segments
- **View Media**: Open final video
- **Delete Story**: Remove story and files

### Progress Tracking

- Check status bar for queue info
- Click "$(film) Sora" in status bar for details
- View detailed logs in Output panel

## Project Structure

```
workspace/
└── sora-output/
    └── stories/
        └── my-story/
            ├── segments/           # Individual video clips
            │   ├── segment_1.mp4
            │   ├── segment_2.mp4
            │   └── ...
            ├── completed/          # Final compiled video
            │   └── my-story.mp4
            ├── thumbnails/         # Segment thumbnails
            │   ├── thumb_1.jpg
            │   └── ...
            └── script.md           # Director's script
```

## Settings

```json
{
  "sora.apiKey": "sk-...",
  "sora.model": "sora-2",
  "sora.outputDirectory": "${workspaceFolder}/sora-output",
  "sora.maxParallelStories": 3,
  "sora.ffmpegPath": "ffmpeg"
}
```

## Keyboard Shortcuts

| Command | Shortcut | Description |
|---------|----------|-------------|
| Create Story | - | Create new story |
| Quick Import | - | Import from file |
| Refresh Stories | - | Refresh story list |
| Show Progress | - | View queue status |

*Note: Assign custom shortcuts in Keyboard Shortcuts (⌘K ⌘S)*

## Troubleshooting

### FFmpeg Not Found

```bash
# macOS (Homebrew)
brew install ffmpeg

# Or specify path in settings
"sora.ffmpegPath": "/opt/homebrew/bin/ffmpeg"
```

### API Key Issues

1. Verify your OpenAI API key
2. Check API quota and billing
3. Ensure Sora API access is enabled

### Video Generation Fails

- Check Output panel for detailed errors
- Verify API key has Sora access
- Check prompt length (max 500 characters)
- Ensure stable internet connection

### Compilation Errors

- Check all segments generated successfully
- Verify FFmpeg is working: `ffmpeg -version`
- Check output directory permissions

## Development

### Build from Source

```bash
# Clone repository
git clone https://github.com/liquitive/media-director.git
cd media-director

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package extension
npm run package
```

### Debug Extension

1. Open project in VS Code
2. Press F5 to launch Extension Development Host
3. Test extension functionality
4. Check Debug Console for logs

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details

## Support

- **Issues**: [GitHub Issues](https://github.com/liquitive/media-director/issues)
- **Discussions**: [GitHub Discussions](https://github.com/liquitive/media-director/discussions)
- **Email**: support@example.com

## Acknowledgments

- OpenAI for Sora, Whisper, and GPT-4 APIs
- FFmpeg for video processing
- VS Code Extension API

## Roadmap

- [ ] Real-time video preview in webview
- [ ] Advanced audio analysis (tempo, beat detection)
- [ ] Custom transition effects
- [ ] Batch processing
- [ ] Export presets
- [ ] Collaboration features
- [ ] Cloud rendering options

---

**Made with ❤️ by the Sora Video Director Team**










