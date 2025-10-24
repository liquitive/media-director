/**
 * Native Audio Analysis Service
 * Bridges TypeScript with Python librosa for advanced audio analysis
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import { BeatInfo, EnergyLevel } from './audioAnalysisService';

export interface NativeAudioFeatures {
    tempo: number;
    duration: number;
    beats: BeatInfo[];
    energy: EnergyLevel[];
    spectralFeatures: {
        centroid: number[];
        rolloff: number[];
        bandwidth: number[];
        zeroCrossingRate: number[];
    };
    rhythm: {
        strength: number;       // How pronounced is the rhythm (0-1)
        regularity: number;     // How regular are the beats (0-1)
    };
    stats: {
        sampleRate: number;
        beatCount: number;
        avgEnergy: number;
    };
}

export interface NativeAudioError {
    error: string;
    message: string;
}

export type NativeAudioResult = NativeAudioFeatures | NativeAudioError;

export class NativeAudioAnalysisService {
    private pythonPath: string;
    private scriptPath: string;

    constructor(pythonPath: string = 'python3') {
        this.pythonPath = pythonPath;
        this.scriptPath = path.join(__dirname, '../../python/audio_analysis.py');
    }

    /**
     * Perform comprehensive audio analysis using native tools (librosa)
     */
    async analyzeAudio(audioPath: string): Promise<NativeAudioFeatures> {
        logger.info(`🎵 Starting native audio analysis: ${audioPath}`);

        // Check if audio file exists
        if (!fs.existsSync(audioPath)) {
            throw new Error(`Audio file not found: ${audioPath}`);
        }

        // Check if Python script exists
        if (!fs.existsSync(this.scriptPath)) {
            throw new Error(`Python analysis script not found: ${this.scriptPath}`);
        }

        try {
            const result = await this.runPythonAnalysis(audioPath);
            
            // Check for errors in result
            if (this.isError(result)) {
                throw new Error(`Python analysis error: ${result.message || result.error}`);
            }

            logger.info(`✓ Native audio analysis complete: ${result.beats.length} beats, ${result.tempo.toFixed(1)} BPM`);
            return result;
        } catch (error) {
            logger.error('Native audio analysis failed:', error);
            throw error;
        }
    }
    
    /**
     * Type guard to check if result is an error
     */
    private isError(result: NativeAudioResult): result is NativeAudioError {
        return 'error' in result;
    }

    /**
     * Run Python analysis script and parse output
     */
    private async runPythonAnalysis(audioPath: string): Promise<NativeAudioResult> {
        return new Promise((resolve, reject) => {
            let stdoutData = '';
            let stderrData = '';

            logger.info(`Spawning Python process: ${this.pythonPath} ${this.scriptPath}`);

            const python = spawn(this.pythonPath, [this.scriptPath, audioPath]);

            python.stdout.on('data', (data: Buffer) => {
                stdoutData += data.toString();
            });

            python.stderr.on('data', (data: Buffer) => {
                stderrData += data.toString();
            });

            python.on('close', (code: number) => {
                if (code !== 0) {
                    logger.error(`Python process exited with code ${code}`);
                    logger.error(`Stderr: ${stderrData}`);
                    reject(new Error(`Python analysis failed with code ${code}: ${stderrData}`));
                    return;
                }

                try {
                    // Parse JSON output
                    const result = JSON.parse(stdoutData);
                    resolve(result);
                } catch (error) {
                    logger.error('Failed to parse Python output:', stdoutData);
                    reject(new Error(`Failed to parse analysis results: ${error}`));
                }
            });

            python.on('error', (error: Error) => {
                logger.error('Failed to spawn Python process:', error);
                reject(new Error(`Failed to start Python analysis: ${error.message}`));
            });

            // Set timeout (3 minutes for long audio files)
            setTimeout(() => {
                python.kill();
                reject(new Error('Audio analysis timed out after 3 minutes'));
            }, 180000);
        });
    }

    /**
     * Extract tempo using librosa beat tracking
     */
    async extractTempo(audioPath: string): Promise<number> {
        try {
            const result = await this.analyzeAudio(audioPath);
            return result.tempo;
        } catch (error) {
            logger.warn('Tempo extraction failed, using default:', error);
            return 120; // Default tempo
        }
    }

    /**
     * Detect beats with confidence scores
     */
    async detectBeats(audioPath: string): Promise<BeatInfo[]> {
        try {
            const result = await this.analyzeAudio(audioPath);
            return result.beats;
        } catch (error) {
            logger.warn('Beat detection failed:', error);
            return [];
        }
    }

    /**
     * Extract real energy levels using librosa RMS energy
     */
    async extractEnergy(audioPath: string): Promise<EnergyLevel[]> {
        try {
            const result = await this.analyzeAudio(audioPath);
            return result.energy;
        } catch (error) {
            logger.warn('Energy extraction failed:', error);
            return [];
        }
    }

    /**
     * Check if Python and librosa are available
     */
    async checkAvailability(): Promise<boolean> {
        return new Promise((resolve) => {
            const python = spawn(this.pythonPath, ['-c', 'import librosa; print("OK")']);
            
            let output = '';
            python.stdout.on('data', (data: Buffer) => {
                output += data.toString();
            });

            python.on('close', (code: number) => {
                resolve(code === 0 && output.includes('OK'));
            });

            python.on('error', () => {
                resolve(false);
            });

            // Timeout after 5 seconds
            setTimeout(() => {
                python.kill();
                resolve(false);
            }, 5000);
        });
    }

    /**
     * Update Python path (for configuration)
     */
    updatePythonPath(pythonPath: string): void {
        this.pythonPath = pythonPath;
    }
}

