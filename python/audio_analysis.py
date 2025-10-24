#!/usr/bin/env python3
"""
Audio Analysis using Librosa
Provides real tempo, beat, energy, and spectral feature extraction
"""

import sys
import json
import warnings

# Suppress librosa warnings
warnings.filterwarnings('ignore')

try:
    import librosa
    import numpy as np
except ImportError:
    print(json.dumps({
        "error": "librosa not installed",
        "message": "Please install: pip install librosa numpy scipy soundfile"
    }))
    sys.exit(1)


def analyze_audio(audio_path):
    """
    Comprehensive audio analysis using librosa
    
    Args:
        audio_path: Path to audio file
        
    Returns:
        Dictionary with tempo, beats, energy, and spectral features
    """
    try:
        # Load audio file with librosa
        # Using sr=22050 for faster processing while maintaining quality
        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        
        # Get duration
        duration = librosa.get_duration(y=y, sr=sr)
        
        # Tempo and beat detection
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        
        # Create beat info with confidence scores
        beats = []
        for beat_time in beat_times:
            beats.append({
                "time": float(beat_time),
                "confidence": 0.85,  # Librosa doesn't provide confidence, use default
                "strength": 0.8
            })
        
        # Energy analysis using RMS (Root Mean Square)
        rms = librosa.feature.rms(y=y)[0]
        rms_times = librosa.times_like(rms, sr=sr)
        
        # Normalize RMS to 0-1 range
        rms_normalized = rms / (np.max(rms) if np.max(rms) > 0 else 1.0)
        
        energy_levels = []
        for t, level in zip(rms_times, rms_normalized):
            energy_levels.append({
                "time": float(t),
                "level": float(level)
            })
        
        # Spectral features
        spectral_centroids = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
        spectral_rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr)[0]
        spectral_bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr)[0]
        zero_crossing_rate = librosa.feature.zero_crossing_rate(y)[0]
        
        # Calculate rhythm metrics
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        rhythm_strength = float(np.mean(onset_env))
        rhythm_regularity = calculate_rhythm_regularity(beat_times)
        
        # Build result
        result = {
            "tempo": float(tempo),
            "duration": float(duration),
            "beats": beats,
            "energy": energy_levels,
            "spectralFeatures": {
                "centroid": spectral_centroids.tolist(),
                "rolloff": spectral_rolloff.tolist(),
                "bandwidth": spectral_bandwidth.tolist(),
                "zeroCrossingRate": zero_crossing_rate.tolist()
            },
            "rhythm": {
                "strength": float(rhythm_strength),
                "regularity": float(rhythm_regularity)
            },
            "stats": {
                "sampleRate": int(sr),
                "beatCount": len(beats),
                "avgEnergy": float(np.mean(rms_normalized))
            }
        }
        
        return result
        
    except Exception as e:
        return {
            "error": str(e),
            "message": f"Failed to analyze audio: {str(e)}"
        }


def calculate_rhythm_regularity(beat_times):
    """
    Calculate how regular/consistent the beat timing is
    
    Args:
        beat_times: Array of beat timestamps
        
    Returns:
        Regularity score (0-1, higher is more regular)
    """
    if len(beat_times) < 3:
        return 0.5
    
    # Calculate intervals between beats
    intervals = np.diff(beat_times)
    
    if len(intervals) == 0:
        return 0.5
    
    # Calculate coefficient of variation (lower = more regular)
    mean_interval = np.mean(intervals)
    std_interval = np.std(intervals)
    
    if mean_interval == 0:
        return 0.5
    
    cv = std_interval / mean_interval
    
    # Convert to 0-1 scale (lower CV = higher regularity)
    # cv typically ranges from 0 to ~0.5 for music
    regularity = max(0, min(1, 1 - (cv * 2)))
    
    return regularity


def main():
    """Main entry point for command-line usage"""
    if len(sys.argv) < 2:
        print(json.dumps({
            "error": "missing_argument",
            "message": "Usage: python audio_analysis.py <audio_file_path>"
        }))
        sys.exit(1)
    
    audio_path = sys.argv[1]
    
    # Perform analysis
    result = analyze_audio(audio_path)
    
    # Output as JSON
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()












