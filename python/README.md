# Native Audio Analysis Setup

This directory contains Python scripts for advanced audio analysis using librosa, providing real beat detection, tempo analysis, and energy extraction.

## 🚀 Automatic Installation (Recommended)

**The VS Code extension automatically installs Python dependencies!**

When you first use the extension:
1. The extension checks for Python and librosa
2. If not found, a notification asks if you want to install
3. Click **"Install Now"** → Dependencies install automatically in ~30-60 seconds
4. That's it! Audio analysis is ready to use

You can also manually trigger installation:
- Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
- Type: `Sora: Install Python Audio Analysis Dependencies`
- Click to install

## Features

- **Real Tempo Detection**: Accurate BPM calculation using librosa's beat tracking
- **Beat Detection**: Precise beat positions with confidence scores
- **Energy Analysis**: RMS energy levels over time (not synthetic)
- **Spectral Features**: Centroid, rolloff, bandwidth, zero-crossing rate
- **Rhythm Metrics**: Strength and regularity of rhythmic patterns

## Requirements

- Python 3.8 or higher
- librosa and dependencies

## Installation

### Option 1: Quick Install (Recommended)

```bash
pip3 install -r requirements.txt
```

### Option 2: Manual Install

```bash
pip3 install librosa numpy scipy soundfile numba
```

### macOS Users

If you encounter issues with `numba` on macOS:

```bash
brew install llvm
pip3 install numba --force-reinstall
```

## Testing the Installation

Test if librosa is installed correctly:

```bash
python3 -c "import librosa; print('✓ Librosa installed successfully')"
```

Test the analysis script with an audio file:

```bash
python3 audio_analysis.py /path/to/your/audio.mp3
```

You should see JSON output with tempo, beats, energy levels, and spectral features.

## Usage from TypeScript

The extension automatically detects if Python librosa is available and uses it for audio analysis. If not available, it falls back to FFmpeg-based analysis.

### Configuration

Set your Python path in VS Code settings if using a custom Python installation:

```json
{
  "sora.audioAnalysis.pythonPath": "/usr/local/bin/python3"
}
```

## Troubleshooting

### "librosa not installed" Error

Make sure librosa is installed in the Python environment:

```bash
pip3 list | grep librosa
```

If not listed, install it:

```bash
pip3 install librosa
```

### "Module not found: numba" Error

Install numba explicitly:

```bash
pip3 install numba
```

### Performance Issues

For faster processing on large audio files, install with performance optimizations:

```bash
pip3 install librosa[performance]
```

### Python Version Issues

Ensure you're using Python 3.8 or higher:

```bash
python3 --version
```

If using multiple Python versions, specify the correct one in VS Code settings.

## Analysis Output Format

The script outputs JSON with the following structure:

```json
{
  "tempo": 120.5,
  "duration": 180.5,
  "beats": [
    { "time": 0.5, "confidence": 0.85, "strength": 0.8 },
    { "time": 1.0, "confidence": 0.85, "strength": 0.8 }
  ],
  "energy": [
    { "time": 0.0, "level": 0.45 },
    { "time": 0.1, "level": 0.52 }
  ],
  "spectralFeatures": {
    "centroid": [1500.0, 1520.0, ...],
    "rolloff": [3000.0, 3050.0, ...],
    "bandwidth": [1000.0, 1020.0, ...],
    "zeroCrossingRate": [0.05, 0.06, ...]
  },
  "rhythm": {
    "strength": 0.75,
    "regularity": 0.85
  },
  "stats": {
    "sampleRate": 22050,
    "beatCount": 360,
    "avgEnergy": 0.52
  }
}
```

## Benefits Over Mock Data

**Before (Mock Data)**:
- Tempo: Hardcoded 120 BPM
- Beats: Estimated from volume peaks
- Energy: Synthetic sine wave patterns
- Spectral: Not available

**After (Native Analysis)**:
- Tempo: Real BPM from beat tracking
- Beats: Accurate positions with confidence
- Energy: Real RMS energy from audio
- Spectral: Full spectral feature set

This dramatically improves segment timing, mood detection, and visual synchronization with audio.

## License

This code is part of the Sora Director Extension and follows the same license.





