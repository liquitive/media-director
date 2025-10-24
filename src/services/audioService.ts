/**
 * Audio Service
 * Handles audio analysis using FFmpeg
 */

import ffmpeg from 'fluent-ffmpeg';
import { AudioAnalysis } from '../models/story';

export class AudioService {
    private ffmpegPath: string;

    constructor(ffmpegPath: string = 'ffmpeg') {
        this.ffmpegPath = ffmpegPath;
        ffmpeg.setFfmpegPath(ffmpegPath);
    }

    /**
     * Analyze audio file
     */
    async analyzeAudio(audioPath: string): Promise<AudioAnalysis> {
        try {
            const metadata = await this.getMetadata(audioPath);
            const silences = await this.detectSilence(audioPath);
            const loudness = await this.analyzeLoudness(audioPath);

            return {
                duration: metadata.format.duration || 0,
                bitrate: metadata.format.bit_rate || 0,
                sampleRate: metadata.streams[0]?.sample_rate || 0,
                channels: metadata.streams[0]?.channels || 0,
                silences,
                loudness,
                estimatedTempo: 120 // Default tempo, could be enhanced later
            };
        } catch (error) {
            console.error('Error analyzing audio:', error);
            throw error;
        }
    }

    /**
     * Get audio metadata
     */
    private async getMetadata(audioPath: string): Promise<any> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(metadata);
                }
            });
        });
    }

    /**
     * Detect silence (natural pauses)
     */
    private async detectSilence(audioPath: string): Promise<Array<{ start: number; end?: number }>> {
        return new Promise((resolve, reject) => {
            const silences: Array<{ start: number; end?: number }> = [];
            let currentSilence: { start: number; end?: number } | null = null;

            ffmpeg(audioPath)
                .audioFilters('silencedetect=noise=-30dB:d=0.5')
                .on('stderr', (line: string) => {
                    // Parse silence_start and silence_end
                    if (line.includes('silence_start:')) {
                        const match = line.match(/silence_start:\s*(\d+\.?\d*)/);
                        if (match) {
                            currentSilence = { start: parseFloat(match[1]) };
                        }
                    } else if (line.includes('silence_end:')) {
                        const match = line.match(/silence_end:\s*(\d+\.?\d*)/);
                        if (match && currentSilence) {
                            currentSilence.end = parseFloat(match[1]);
                            silences.push(currentSilence);
                            currentSilence = null;
                        }
                    }
                })
                .on('end', () => {
                    // Add any unclosed silence
                    if (currentSilence) {
                        silences.push(currentSilence);
                    }
                    resolve(silences);
                })
                .on('error', (err: Error) => {
                    // FFmpeg might error out on this, but that's okay
                    // Resolve with what we have
                    resolve(silences);
                })
                .format('null')
                .output('-')
                .run();
        });
    }

    /**
     * Analyze loudness
     */
    private async analyzeLoudness(audioPath: string): Promise<{ average: number; peak: number }> {
        return new Promise((resolve) => {
            let loudnessData = { average: -23.0, peak: -3.0 }; // Default values

            ffmpeg(audioPath)
                .audioFilters('loudnorm=print_format=json')
                .on('stderr', (line: string) => {
                    // Parse loudness data from JSON output
                    try {
                        if (line.includes('input_i') || line.includes('input_tp')) {
                            // Try to extract JSON
                            const jsonMatch = line.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                const data = JSON.parse(jsonMatch[0]);
                                loudnessData = {
                                    average: parseFloat(data.input_i) || -23.0,
                                    peak: parseFloat(data.input_tp) || -3.0
                                };
                            }
                        }
                    } catch (e) {
                        // Parsing error, keep defaults
                    }
                })
                .on('end', () => {
                    resolve(loudnessData);
                })
                .on('error', () => {
                    // Error, return defaults
                    resolve(loudnessData);
                })
                .format('null')
                .output('-')
                .run();
        });
    }

    /**
     * Normalize audio volume
     */
    async normalizeAudio(inputPath: string, outputPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .audioFilters('loudnorm')
                .on('end', () => resolve(outputPath))
                .on('error', reject)
                .save(outputPath);
        });
    }

    /**
     * Extract audio from video file and convert to compressed MP3
     */
    async extractAudioFromVideo(videoPath: string, outputPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .noVideo()
                .audioCodec('libmp3lame')
                .audioBitrate('128k')
                .audioChannels(2)
                .audioFrequency(44100)
                .on('end', () => resolve(outputPath))
                .on('error', reject)
                .save(outputPath);
        });
    }

    /**
     * Get file size in bytes
     */
    async getFileSize(filePath: string): Promise<number> {
        const fs = require('fs').promises;
        const stats = await fs.stat(filePath);
        return stats.size;
    }

    /**
     * Split audio file into chunks of specified duration (in seconds)
     */
    async splitAudioIntoChunks(
        inputPath: string,
        outputDir: string,
        chunkDuration: number = 600 // 10 minutes default
    ): Promise<string[]> {
        const fs = require('fs').promises;
        const path = require('path');

        // Ensure output directory exists
        await fs.mkdir(outputDir, { recursive: true });

        // Get audio duration
        const metadata = await this.getMetadata(inputPath);
        const totalDuration = metadata.format.duration || 0;
        
        const chunks: string[] = [];
        let startTime = 0;

        while (startTime < totalDuration) {
            const chunkIndex = Math.floor(startTime / chunkDuration);
            const chunkPath = path.join(outputDir, `chunk_${chunkIndex}.mp3`);
            
            await new Promise<void>((resolve, reject) => {
                ffmpeg(inputPath)
                    .setStartTime(startTime)
                    .setDuration(Math.min(chunkDuration, totalDuration - startTime))
                    .audioCodec('libmp3lame')
                    .audioBitrate('128k')
                    .on('end', () => resolve())
                    .on('error', reject)
                    .save(chunkPath);
            });

            chunks.push(chunkPath);
            startTime += chunkDuration;
        }

        return chunks;
    }

    /**
     * Update FFmpeg path
     */
    updateFfmpegPath(ffmpegPath: string): void {
        this.ffmpegPath = ffmpegPath;
        ffmpeg.setFfmpegPath(ffmpegPath);
    }
}

