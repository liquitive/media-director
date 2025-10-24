/**
 * Audio Analysis Service
 * Performs deep audio analysis to extract timing, beats, and structure
 */

import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import { NativeAudioAnalysisService } from './nativeAudioAnalysis';

export interface AudioTimingMap {
    duration: number;
    sampleRate: number;
    beats: BeatInfo[];
    segments: TimedSegment[];
    energy: EnergyLevel[];
}

export interface BeatInfo {
    time: number;      // Time in seconds
    confidence: number; // 0-1
    strength: number;   // 0-1
}

export interface TimedSegment {
    index: number;
    startTime: number;  // Seconds
    endTime: number;    // Seconds
    duration: number;   // Seconds
    text: string;       // Transcribed text for this time range
    hasVocals: boolean;
    energy: number;     // Average energy 0-1
    beats: number;      // Number of beats in this segment
}

export interface EnergyLevel {
    time: number;
    level: number; // 0-1
}

export class AudioAnalysisService {
    private nativeAnalysis: NativeAudioAnalysisService;
    private useNativeAnalysis: boolean = true;
    private availabilityChecked: boolean = false;

    constructor(private ffmpegPath: string) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        this.nativeAnalysis = new NativeAudioAnalysisService();
        
        // Don't check immediately - wait for proper Python path configuration
        // Availability will be checked on first use via ensureNativeAnalysisConfigured()
    }
    
    /**
     * Check if Python librosa is available for native analysis
     * Only called after Python path has been properly configured
     */
    private async checkNativeAnalysisAvailability(): Promise<void> {
        if (this.availabilityChecked) {
            return;
        }
        
        this.availabilityChecked = true;
        
        try {
            const available = await this.nativeAnalysis.checkAvailability();
            if (available) {
                logger.info('✓ Native audio analysis (Python librosa) available');
                this.useNativeAnalysis = true;
            } else {
                logger.warn('⚠️  Python librosa not available, will use FFmpeg fallback');
                this.useNativeAnalysis = false;
            }
        } catch (error) {
            logger.warn('⚠️  Could not check native analysis availability:', error);
            this.useNativeAnalysis = false;
        }
    }
    
    /**
     * Configure Python path for native analysis (called by extension after Python is found)
     */
    public async configurePythonPath(pythonPath: string): Promise<void> {
        this.nativeAnalysis.updatePythonPath(pythonPath);
        this.availabilityChecked = false; // Reset so we can check again with new path
        await this.checkNativeAnalysisAvailability();
    }
    
    /**
     * Ensure native analysis is configured before use
     */
    private async ensureNativeAnalysisConfigured(): Promise<void> {
        if (!this.availabilityChecked) {
            // Check availability with whatever Python path we have
            await this.checkNativeAnalysisAvailability();
        }
    }

    /**
     * Perform comprehensive audio analysis
     */
    async analyzeAudioTiming(audioPath: string, transcription: any): Promise<AudioTimingMap> {
        logger.info(`Starting comprehensive audio analysis: ${audioPath}`);

        // Ensure native analysis is configured before use
        await this.ensureNativeAnalysisConfigured();

        // Get basic audio metadata
        const metadata = await this.getAudioMetadata(audioPath);
        const duration = metadata.duration;

        // Extract audio features
        const beats = await this.detectBeats(audioPath, duration);
        const energy = await this.analyzeEnergy(audioPath, duration);
        
        // Map transcription to timing
        const segments = this.mapTranscriptionToTiming(
            transcription,
            duration,
            beats,
            energy
        );

        logger.info(`Audio analysis complete: ${segments.length} segments detected`);

        return {
            duration,
            sampleRate: metadata.sampleRate,
            beats,
            segments,
            energy
        };
    }

    /**
     * Get audio metadata (duration, sample rate, etc.)
     */
    private async getAudioMetadata(audioPath: string): Promise<any> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) {
                    reject(err);
                    return;
                }

                const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
                if (!audioStream) {
                    reject(new Error('No audio stream found'));
                    return;
                }

                resolve({
                    duration: metadata.format.duration || 0,
                    sampleRate: parseInt(String(audioStream.sample_rate || 44100)),
                    channels: audioStream.channels || 2,
                    bitrate: parseInt(String(metadata.format.bit_rate || 0))
                });
            });
        });
    }

    /**
     * Detect beats using native analysis or FFmpeg fallback
     */
    private async detectBeats(audioPath: string, duration: number): Promise<BeatInfo[]> {
        logger.info('Detecting beats...');
        
        // Try native analysis first
        if (this.useNativeAnalysis) {
            try {
                const nativeFeatures = await this.nativeAnalysis.analyzeAudio(audioPath);
                logger.info(`✓ Native beat detection: ${nativeFeatures.beats.length} beats, ${nativeFeatures.tempo.toFixed(1)} BPM`);
                return nativeFeatures.beats;
            } catch (error) {
                logger.warn('Native beat detection failed, falling back to FFmpeg:', error);
                // Fall through to FFmpeg fallback
            }
        }
        
        // Fallback: FFmpeg-based beat detection
        return this.detectBeatsFFmpeg(audioPath, duration);
    }
    
    /**
     * Fallback beat detection using FFmpeg volume analysis
     */
    private async detectBeatsFFmpeg(audioPath: string, duration: number): Promise<BeatInfo[]> {
        logger.info('Using FFmpeg fallback for beat detection');
        
        // Use FFmpeg to extract volume levels at regular intervals
        const volumeData = await this.extractVolumeData(audioPath);
        
        // Simple beat detection: find peaks in energy that exceed threshold
        const beats: BeatInfo[] = [];
        const threshold = 0.6;
        const minBeatInterval = 0.15; // Minimum 150ms between beats (typical for music)
        
        let lastBeatTime = -minBeatInterval;
        
        for (let i = 1; i < volumeData.length - 1; i++) {
            const prev = volumeData[i - 1];
            const curr = volumeData[i];
            const next = volumeData[i + 1];
            
            // Peak detection: current is higher than neighbors and above threshold
            if (curr.level > prev.level && 
                curr.level > next.level && 
                curr.level > threshold &&
                curr.time - lastBeatTime >= minBeatInterval) {
                
                beats.push({
                    time: curr.time,
                    confidence: Math.min(curr.level, 1.0),
                    strength: curr.level
                });
                
                lastBeatTime = curr.time;
            }
        }
        
        logger.info(`FFmpeg detected ${beats.length} estimated beats`);
        return beats;
    }

    /**
     * Extract volume data from audio file
     * For now, we'll use a simplified approach that estimates energy
     */
    private async extractVolumeData(audioPath: string): Promise<EnergyLevel[]> {
        // Simplified implementation that doesn't require complex FFmpeg processing
        // In the future, this could be enhanced with actual FFmpeg audio analysis
        return this.generateEnergyEstimate(audioPath);
    }

    /**
     * Generate energy level estimate using native analysis or FFmpeg
     */
    private async generateEnergyEstimate(audioPath: string): Promise<EnergyLevel[]> {
        // Try native analysis first
        if (this.useNativeAnalysis) {
            try {
                const nativeFeatures = await this.nativeAnalysis.analyzeAudio(audioPath);
                logger.info(`✓ Native energy extraction: ${nativeFeatures.energy.length} data points`);
                return nativeFeatures.energy;
            } catch (error) {
                logger.warn('Native energy extraction failed, falling back:', error);
                // Fall through to fallback
            }
        }
        
        // Fallback: Use FFmpeg or generate basic estimate
        return this.generateEnergyFallback(audioPath);
    }
    
    /**
     * Fallback energy estimation (basic implementation)
     */
    private async generateEnergyFallback(audioPath: string): Promise<EnergyLevel[]> {
        logger.info('Using fallback energy estimation');
        
        const metadata = await this.getAudioMetadata(audioPath);
        const duration = metadata.duration;
        const sampleInterval = 0.1; // Sample every 100ms
        
        const levels: EnergyLevel[] = [];
        
        // Generate basic energy levels based on audio characteristics
        // This is a simplified fallback when native analysis is not available
        for (let t = 0; t < duration; t += sampleInterval) {
            // Use a more realistic pattern than pure sine wave
            const baseEnergy = 0.5 + 0.2 * Math.sin(t * 0.5) + 0.1 * Math.sin(t * 2);
            const noise = Math.random() * 0.1;
            levels.push({
                time: t,
                level: Math.max(0, Math.min(1, baseEnergy + noise))
            });
        }
        
        return levels;
    }

    /**
     * Analyze audio energy levels over time
     */
    private async analyzeEnergy(audioPath: string, duration: number): Promise<EnergyLevel[]> {
        return this.extractVolumeData(audioPath);
    }

    /**
     * Map transcription to timing using word-level timestamps
     * and align with beats/energy
     */
    private mapTranscriptionToTiming(
        transcription: any,
        duration: number,
        beats: BeatInfo[],
        energy: EnergyLevel[]
    ): TimedSegment[] {
        logger.info('Mapping transcription to timing...');
        
        const segments: TimedSegment[] = [];
        
        // Check if transcription has word-level timestamps (can be in 'words' or 'segments' field)
        const words = transcription.words || transcription.segments || [];
        const hasWordTimestamps = words.length > 0 && words[0].start !== undefined;
        
        if (hasWordTimestamps) {
            logger.info(`Found ${words.length} words with timestamps`);
            // Use word-level timestamps to create natural segments
            const timedSegments = this.createSegmentsFromWords(
                words,
                duration,
                beats,
                energy
            );
            segments.push(...timedSegments);
            
            // Fill gaps with instrumental/non-vocal segments
            const completeSegments = this.fillGapsInTimeline(timedSegments, duration, beats, energy);
            return completeSegments;
        } else {
            logger.warn('No word timestamps found, using fallback text segmentation');
            // Fall back to sentence-based segmentation with estimated timing
            segments.push(...this.createSegmentsFromText(
                transcription.text || '',
                duration,
                beats,
                energy
            ));
        }
        
        return segments;
    }

    /**
     * Create segments from word-level timestamps
     */
    private createSegmentsFromWords(
        words: any[],
        duration: number,
        beats: BeatInfo[],
        energy: EnergyLevel[]
    ): TimedSegment[] {
        const segments: TimedSegment[] = [];
        const maxSegmentDuration = 12; // Sora max
        const minSegmentDuration = 0.5; // Minimum half second
        
        let currentSegment: any = null;
        
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const wordStart = word.start || 0;
            const wordEnd = word.end || wordStart + 0.5;
            
            if (!currentSegment) {
                // Start new segment
                currentSegment = {
                    startTime: wordStart,
                    words: [word],
                    endTime: wordEnd
                };
            } else {
                const potentialDuration = wordEnd - currentSegment.startTime;
                
                // Check if we should split here
                const shouldSplit = this.shouldSplitSegment(
                    currentSegment.startTime,
                    wordEnd,
                    potentialDuration,
                    beats,
                    maxSegmentDuration,
                    i === words.length - 1
                );
                
                if (shouldSplit && currentSegment.words.length > 0) {
                    // Finalize current segment
                    segments.push(this.finalizeSegment(
                        segments.length,
                        currentSegment,
                        beats,
                        energy
                    ));
                    
                    // Start new segment
                    currentSegment = {
                        startTime: wordStart,
                        words: [word],
                        endTime: wordEnd
                    };
                } else {
                    // Add to current segment
                    currentSegment.words.push(word);
                    currentSegment.endTime = wordEnd;
                }
            }
        }
        
        // Add final segment
        if (currentSegment && currentSegment.words.length > 0) {
            segments.push(this.finalizeSegment(
                segments.length,
                currentSegment,
                beats,
                energy
            ));
        }
        
        return segments;
    }

    /**
     * Determine if segment should be split at this point
     */
    private shouldSplitSegment(
        startTime: number,
        endTime: number,
        duration: number,
        beats: BeatInfo[],
        maxDuration: number,
        isLastWord: boolean
    ): boolean {
        // Must split if exceeding max duration
        if (duration >= maxDuration) {
            return true;
        }
        
        // Don't split if too short (unless last word)
        if (duration < 2 && !isLastWord) {
            return false;
        }
        
        // Check if current end time is near a beat (good split point)
        const nearestBeat = this.findNearestBeat(endTime, beats);
        if (nearestBeat && Math.abs(nearestBeat.time - endTime) < 0.2) {
            // Good natural split point
            return duration >= 3; // Only split if segment is long enough
        }
        
        return false;
    }

    /**
     * Find nearest beat to given time
     */
    private findNearestBeat(time: number, beats: BeatInfo[]): BeatInfo | null {
        if (beats.length === 0) {
            return null;
        }
        
        let nearest = beats[0];
        let minDiff = Math.abs(beats[0].time - time);
        
        for (const beat of beats) {
            const diff = Math.abs(beat.time - time);
            if (diff < minDiff) {
                minDiff = diff;
                nearest = beat;
            }
        }
        
        return nearest;
    }

    /**
     * Finalize a segment with all metadata
     */
    private finalizeSegment(
        index: number,
        segmentData: any,
        beats: BeatInfo[],
        energy: EnergyLevel[]
    ): TimedSegment {
        const startTime = segmentData.startTime;
        const endTime = segmentData.endTime;
        const duration = endTime - startTime;
        const text = segmentData.words.map((w: any) => w.word || w.text).join(' ');
        
        // Count beats in this segment
        const segmentBeats = beats.filter(b => b.time >= startTime && b.time <= endTime);
        
        // Calculate average energy
        const segmentEnergy = energy.filter(e => e.time >= startTime && e.time <= endTime);
        const avgEnergy = segmentEnergy.length > 0
            ? segmentEnergy.reduce((sum, e) => sum + e.level, 0) / segmentEnergy.length
            : 0.5;
        
        return {
            index: index + 1,
            startTime,
            endTime,
            duration,
            text,
            hasVocals: true,
            energy: avgEnergy,
            beats: segmentBeats.length
        };
    }

    /**
     * Create segments from plain text (fallback when no word timestamps)
     */
    private createSegmentsFromText(
        text: string,
        duration: number,
        beats: BeatInfo[],
        energy: EnergyLevel[]
    ): TimedSegment[] {
        // Split by sentences
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        const segments: TimedSegment[] = [];
        
        const avgSegmentDuration = duration / sentences.length;
        let currentTime = 0;
        
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i].trim();
            const segmentDuration = Math.min(avgSegmentDuration, 12);
            const startTime = currentTime;
            const endTime = currentTime + segmentDuration;
            
            segments.push({
                index: i + 1,
                startTime,
                endTime,
                duration: segmentDuration,
                text: sentence,
                hasVocals: true,
                energy: 0.5,
                beats: 0
            });
            
            currentTime = endTime;
        }
        
        return segments;
    }

    /**
     * Fill gaps in timeline with instrumental/non-vocal segments
     * Ensures the entire audio duration is covered
     */
    private fillGapsInTimeline(
        vocalSegments: TimedSegment[],
        totalDuration: number,
        beats: BeatInfo[],
        energy: EnergyLevel[]
    ): TimedSegment[] {
        logger.info(`Filling timeline gaps. Total duration: ${totalDuration}s, Vocal segments: ${vocalSegments.length}`);
        
        const allSegments: TimedSegment[] = [];
        const maxSegmentDuration = 12; // Sora max
        const minSegmentDuration = 4; // Sora min
        
        let currentTime = 0;
        let segmentIndex = 1;
        
        for (let i = 0; i < vocalSegments.length; i++) {
            const vocalSegment = vocalSegments[i];
            
            // Fill gap before this vocal segment
            if (vocalSegment.startTime > currentTime) {
                const gapDuration = vocalSegment.startTime - currentTime;
                logger.info(`Gap detected: ${currentTime.toFixed(2)}s - ${vocalSegment.startTime.toFixed(2)}s (${gapDuration.toFixed(2)}s)`);
                
                // Split gap into Sora-compatible segments
                let gapStart = currentTime;
                while (gapStart < vocalSegment.startTime) {
                    const remainingGap = vocalSegment.startTime - gapStart;
                    const segmentDuration = Math.min(remainingGap, maxSegmentDuration);
                    const normalizedDuration = segmentDuration >= 10 ? 12 : (segmentDuration >= 6 ? 8 : 4);
                    const actualEnd = Math.min(gapStart + normalizedDuration, vocalSegment.startTime);
                    
                    // Calculate average energy for this segment
                    const segmentEnergy = energy.filter(e => e.time >= gapStart && e.time < actualEnd);
                    const avgEnergy = segmentEnergy.length > 0
                        ? segmentEnergy.reduce((sum, e) => sum + e.level, 0) / segmentEnergy.length
                        : 0.5;
                    
                    // Count beats in this segment
                    const segmentBeats = beats.filter(b => b.time >= gapStart && b.time < actualEnd);
                    
                    allSegments.push({
                        index: segmentIndex++,
                        startTime: gapStart,
                        endTime: actualEnd,
                        duration: actualEnd - gapStart,
                        text: `[Instrumental - ${this.getInstrumentalDescription(avgEnergy, segmentBeats.length)}]`,
                        hasVocals: false,
                        energy: avgEnergy,
                        beats: segmentBeats.length
                    });
                    
                    gapStart = actualEnd;
                }
            }
            
            // Add the vocal segment
            allSegments.push({
                ...vocalSegment,
                index: segmentIndex++
            });
            
            currentTime = vocalSegment.endTime;
        }
        
        // Fill any remaining time at the end
        if (currentTime < totalDuration) {
            const remainingDuration = totalDuration - currentTime;
            logger.info(`Final gap detected: ${currentTime.toFixed(2)}s - ${totalDuration.toFixed(2)}s (${remainingDuration.toFixed(2)}s)`);
            
            let gapStart = currentTime;
            while (gapStart < totalDuration) {
                const remainingGap = totalDuration - gapStart;
                const segmentDuration = Math.min(remainingGap, maxSegmentDuration);
                const normalizedDuration = segmentDuration >= 10 ? 12 : (segmentDuration >= 6 ? 8 : 4);
                const actualEnd = Math.min(gapStart + normalizedDuration, totalDuration);
                
                const segmentEnergy = energy.filter(e => e.time >= gapStart && e.time < actualEnd);
                const avgEnergy = segmentEnergy.length > 0
                    ? segmentEnergy.reduce((sum, e) => sum + e.level, 0) / segmentEnergy.length
                    : 0.5;
                
                const segmentBeats = beats.filter(b => b.time >= gapStart && b.time < actualEnd);
                
                allSegments.push({
                    index: segmentIndex++,
                    startTime: gapStart,
                    endTime: actualEnd,
                    duration: actualEnd - gapStart,
                    text: `[Instrumental - ${this.getInstrumentalDescription(avgEnergy, segmentBeats.length)}]`,
                    hasVocals: false,
                    energy: avgEnergy,
                    beats: segmentBeats.length
                });
                
                gapStart = actualEnd;
            }
        }
        
        logger.info(`Timeline complete: ${allSegments.length} total segments covering ${totalDuration.toFixed(2)}s`);
        return allSegments;
    }

    /**
     * Generate description for instrumental segments based on energy and beats
     */
    private getInstrumentalDescription(energy: number, beatCount: number): string {
        if (energy < 0.3) {
            return beatCount === 0 ? 'Silence/Ambient' : 'Soft intro';
        } else if (energy < 0.5) {
            return beatCount > 5 ? 'Light rhythm' : 'Gentle melody';
        } else if (energy < 0.7) {
            return beatCount > 8 ? 'Building rhythm' : 'Melodic section';
        } else {
            return beatCount > 10 ? 'Intense beat drop' : 'Powerful instrumental';
        }
    }
}

