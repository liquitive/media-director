/**
 * Video Service
 * Handles video processing using FFmpeg
 */

import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';

export class VideoService {
    private ffmpegPath: string;

    constructor(ffmpegPath: string = 'ffmpeg') {
        this.ffmpegPath = ffmpegPath;
        ffmpeg.setFfmpegPath(ffmpegPath);
    }

    /**
     * Compile video segments into final video
     */
    async compileSegments(
        segmentPaths: string[],
        outputPath: string,
        audioPath?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            if (segmentPaths.length === 0) {
                reject(new Error('No segments to compile'));
                return;
            }

            // Create a temporary file list for FFmpeg concat
            const listFilePath = path.join(path.dirname(outputPath), 'segments_list.txt');
            const listContent = segmentPaths.map(p => `file '${p}'`).join('\n');
            fs.writeFileSync(listFilePath, listContent);

            try {
                let command = ffmpeg();

                if (audioPath) {
                    // Concatenate videos and add audio
                    command
                        .input(listFilePath)
                        .inputOptions(['-f', 'concat', '-safe', '0'])
                        .input(audioPath)
                        .outputOptions([
                            '-c:v', 'copy',
                            '-c:a', 'aac',
                            '-map', '0:v:0',
                            '-map', '1:a:0',
                            '-shortest'
                        ]);
                } else {
                    // Just concatenate videos
                    command
                        .input(listFilePath)
                        .inputOptions(['-f', 'concat', '-safe', '0'])
                        .outputOptions(['-c', 'copy']);
                }

                command
                    .on('end', () => {
                        // Clean up temp file
                        try {
                            fs.unlinkSync(listFilePath);
                        } catch (e) {
                            // Ignore cleanup errors
                        }
                        resolve(outputPath);
                    })
                    .on('error', (err: Error) => {
                        // Clean up temp file
                        try {
                            fs.unlinkSync(listFilePath);
                        } catch (e) {
                            // Ignore cleanup errors
                        }
                        reject(err);
                    })
                    .save(outputPath);
            } catch (error) {
                // Clean up temp file
                try {
                    fs.unlinkSync(listFilePath);
                } catch (e) {
                    // Ignore cleanup errors
                }
                reject(error);
            }
        });
    }

    /**
     * Extract audio from video
     */
    async extractAudio(videoPath: string, outputPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .noVideo()
                .audioCodec('libmp3lame')
                .on('end', () => resolve(outputPath))
                .on('error', reject)
                .save(outputPath);
        });
    }

    /**
     * Generate thumbnail from video
     */
    async generateThumbnail(
        videoPath: string,
        outputPath: string,
        timestamp: number = 5
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .seekInput(timestamp)
                .frames(1)
                .outputOptions(['-q:v', '2'])
                .on('end', () => resolve(outputPath))
                .on('error', reject)
                .save(outputPath);
        });
    }

    /**
     * Get video metadata
     */
    async getMetadata(videoPath: string): Promise<any> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(metadata);
                }
            });
        });
    }

    /**
     * Get video duration in seconds
     */
    async getDuration(videoPath: string): Promise<number> {
        try {
            const metadata = await this.getMetadata(videoPath);
            return metadata.format.duration || 0;
        } catch (error) {
            console.error('Error getting video duration:', error);
            return 0;
        }
    }

    /**
     * Optimize video for web
     */
    async optimizeVideo(inputPath: string, outputPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-preset', 'medium',
                    '-crf', '23',
                    '-b:a', '128k',
                    '-movflags', '+faststart'
                ])
                .on('end', () => resolve(outputPath))
                .on('error', reject)
                .save(outputPath);
        });
    }

    /**
     * Create video with crossfade transitions
     */
    async addTransitions(segmentPaths: string[], outputPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (segmentPaths.length < 2) {
                // No transitions needed for single segment
                this.compileSegments(segmentPaths, outputPath)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            // Build complex filter for crossfade transitions
            const filterParts: string[] = [];
            let currentLabel = '0:v';

            for (let i = 1; i < segmentPaths.length; i++) {
                const nextLabel = `v${i}`;
                filterParts.push(
                    `${currentLabel}[${i}:v]xfade=transition=fade:duration=0.5:offset=0[${nextLabel}]`
                );
                currentLabel = nextLabel;
            }

            const filterComplex = filterParts.join(';');

            let command = ffmpeg();
            segmentPaths.forEach(p => command.input(p));

            command
                .complexFilter(filterComplex)
                .outputOptions(['-map', `[${currentLabel}]`])
                .videoCodec('libx264')
                .on('end', () => resolve(outputPath))
                .on('error', reject)
                .save(outputPath);
        });
    }

    /**
     * Extract a specific frame from video as image
     * @param videoPath - Path to source video
     * @param outputPath - Path for output image
     * @param timestamp - Time in seconds (-1 for last frame, -0.5 for 0.5s before end)
     * @returns Path to extracted frame
     */
    async extractFrame(
        videoPath: string,
        outputPath: string,
        timestamp: number = -1
    ): Promise<string> {
        return new Promise(async (resolve, reject) => {
            try {
                // Get video duration first
                const duration = await this.getDuration(videoPath);
                
                let actualTimestamp: number;
                
                if (timestamp < 0) {
                    // Negative timestamp means offset from end
                    // -1 means last frame, so we go to end minus a tiny amount
                    actualTimestamp = Math.max(0, duration + timestamp);
                } else {
                    actualTimestamp = Math.min(timestamp, duration);
                }

                // Ensure output directory exists
                const outputDir = path.dirname(outputPath);
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                ffmpeg(videoPath)
                    .seekInput(actualTimestamp)
                    .frames(1)
                    .outputOptions(['-q:v', '2'])  // High quality JPEG
                    .on('end', () => resolve(outputPath))
                    .on('error', reject)
                    .save(outputPath);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Extract the last frame from a video
     * Convenience method for extractFrame with timestamp = -0.1
     * @param videoPath - Path to source video
     * @param outputPath - Path for output image
     * @returns Path to extracted frame
     */
    async extractLastFrame(videoPath: string, outputPath: string): Promise<string> {
        // Extract frame from 0.1 seconds before end to ensure we get actual content
        return this.extractFrame(videoPath, outputPath, -0.1);
    }

    /**
     * Extract multiple key frames from video for selection
     * @param videoPath - Path to source video
     * @param outputDir - Directory for output images
     * @param count - Number of frames to extract
     * @returns Array of paths to extracted frames
     */
    async extractKeyFrames(
        videoPath: string,
        outputDir: string,
        count: number = 5
    ): Promise<string[]> {
        try {
            const duration = await this.getDuration(videoPath);
            const framePaths: string[] = [];

            // Ensure output directory exists
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Extract frames at evenly spaced intervals
            for (let i = 0; i < count; i++) {
                const timestamp = (duration / (count + 1)) * (i + 1);
                const framePath = path.join(outputDir, `frame_${i + 1}.jpg`);
                
                await this.extractFrame(videoPath, framePath, timestamp);
                framePaths.push(framePath);
            }

            return framePaths;
        } catch (error) {
            console.error('Error extracting key frames:', error);
            throw error;
        }
    }

    /**
     * Analyze frame quality/sharpness
     * Uses FFmpeg's idet filter to get frame statistics
     * @param framePath - Path to frame image
     * @returns Quality score (0-1, higher is better)
     */
    async analyzeFrameQuality(framePath: string): Promise<number> {
        return new Promise((resolve) => {
            if (!fs.existsSync(framePath)) {
                resolve(0);
                return;
            }

            // Use FFmpeg to analyze frame
            // This is a simplified quality check based on file size and dimensions
            // In production, you might want more sophisticated analysis
            try {
                const stats = fs.statSync(framePath);
                
                // Simple heuristic: larger file size usually means more detail
                // Normalize to 0-1 range (assuming typical JPEG sizes)
                const sizeScore = Math.min(stats.size / (500 * 1024), 1.0);
                
                resolve(sizeScore);
            } catch (error) {
                console.error('Error analyzing frame quality:', error);
                resolve(0.5); // Default middle quality
            }
        });
    }

    /**
     * Extract the best quality frame from a video segment
     * Extracts multiple frames and returns the highest quality one
     * @param videoPath - Path to source video
     * @param outputPath - Path for output image
     * @param sampleCount - Number of frames to sample
     * @returns Path to best quality frame
     */
    async extractBestFrame(
        videoPath: string,
        outputPath: string,
        sampleCount: number = 5
    ): Promise<string> {
        try {
            const tempDir = path.join(path.dirname(outputPath), 'temp_frames');
            
            // Extract multiple frames
            const framePaths = await this.extractKeyFrames(videoPath, tempDir, sampleCount);
            
            // Analyze quality of each frame
            let bestFrame = framePaths[0];
            let bestQuality = 0;
            
            for (const framePath of framePaths) {
                const quality = await this.analyzeFrameQuality(framePath);
                if (quality > bestQuality) {
                    bestQuality = quality;
                    bestFrame = framePath;
                }
            }
            
            // Copy best frame to output path
            fs.copyFileSync(bestFrame, outputPath);
            
            // Clean up temp frames
            for (const framePath of framePaths) {
                try {
                    fs.unlinkSync(framePath);
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
            
            // Remove temp directory
            try {
                fs.rmdirSync(tempDir);
            } catch (e) {
                // Ignore cleanup errors
            }
            
            return outputPath;
        } catch (error) {
            console.error('Error extracting best frame:', error);
            // Fallback to last frame
            return this.extractLastFrame(videoPath, outputPath);
        }
    }

    /**
     * Update FFmpeg path
     */
    updateFfmpegPath(ffmpegPath: string): void {
        this.ffmpegPath = ffmpegPath;
        ffmpeg.setFfmpegPath(ffmpegPath);
    }
}

