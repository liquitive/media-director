/**
 * OpenAI Service
 * Handles all OpenAI API interactions: Sora, Whisper, GPT-4
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptionResult, DirectorScript, Segment } from '../models/story';
import { logger } from '../utils/logger';

export class OpenAIService {
    private client: OpenAI;

    constructor(apiKey: string) {
        this.client = new OpenAI({ apiKey });
    }

    /**
     * Map duration to Sora-supported values (4, 8, or 12 seconds)
     */
    private mapDurationToSoraSupported(duration: number): string {
        if (duration <= 4) return '4';
        if (duration <= 8) return '8';
        if (duration <= 12) return '12';
        return '12'; // Default to 12 for longer durations
    }

    /**
     * Map resolution to Sora-supported values
     */
    private mapResolutionToSoraSupported(resolution: string): string {
        switch (resolution) {
            case '1920x1080':
                return '1280x720'; // Map 1080p to 720p landscape
            case '1280x720':
                return '1280x720'; // Already supported
            case '720x1280':
                return '720x1280'; // Portrait mode
            case '1024x1792':
                return '1024x1792'; // Portrait mode
            case '1792x1024':
                return '1792x1024'; // Landscape mode
            default:
                return '1280x720'; // Default to 720p landscape
        }
    }

    /**
     * Get the API key for use by other services
     */
    getApiKey(): string {
        return this.client.apiKey;
    }

    /**
     * Generate a video segment using Sora API
     */
    async generateVideoSegment(
        prompt: string,
        duration: number,
        model: 'sora-2' | 'sora-2-pro' = 'sora-2',
        size: '1280x720' | '1920x1080' = '1280x720',
        storyConfig?: any,
        imagePaths?: string | string[],
        continuityFrame?: string,
        storyId?: string
    ): Promise<{ id: string; url?: string }> {
        try {
            logger.info(`Original prompt length: ${prompt.length} chars`);
            logger.info(`Generating video segment with prompt: ${prompt.substring(0, 100)}...`);
            
            if (!this.client) {
                throw new Error('OpenAI client not initialized');
            }
            
            // Debug: Check what's available
            logger.info(`Client type: ${typeof this.client}`);
            logger.info(`Client constructor: ${this.client?.constructor?.name}`);
            logger.info(`Client has videos: ${(this.client as any).videos !== undefined}`);
            logger.info(`Videos type: ${typeof (this.client as any).videos}`);
            
            // Shorten prompt to fit Sora's limits (max ~500 chars)
            let shortenedPrompt = this.shortenPromptForSora(prompt);
            logger.info(`Shortened prompt length: ${shortenedPrompt.length} chars`);
            
            // Apply story style to prompt if provided
            let enhancedPrompt = shortenedPrompt;
            if (storyConfig?.visualStyle) {
                const stylePrompt = this.buildStylePrompt(storyConfig.visualStyle, storyConfig.customStylePrompt);
                enhancedPrompt = `${shortenedPrompt}, ${stylePrompt}`;
            }

            // Add continuity instructions if this is a continuation of a previous segment
            if (continuityFrame && fs.existsSync(continuityFrame)) {
                logger.info(`🎬 Continuity mode enabled with frame: ${continuityFrame}`);
                enhancedPrompt = `Continuing from previous scene. Maintain consistent visual style, lighting, characters, and environment. ${enhancedPrompt}`;
            }

            logger.info(`About to call videos.create...`);
            
            // Prepare video creation parameters
            const videoParams: any = {
                model,
                prompt: enhancedPrompt,
                size: this.mapResolutionToSoraSupported(size),  // Map to Sora-supported resolution
                seconds: this.mapDurationToSoraSupported(duration)  // Map to Sora-supported values
            };
            
            // Try to add continuity frame as input_reference
            if (continuityFrame && fs.existsSync(continuityFrame)) {
                try {
                    // Read the frame as base64
                    const frameBuffer = fs.readFileSync(continuityFrame);
                    const base64Frame = frameBuffer.toString('base64');
                    const mimeType = continuityFrame.endsWith('.png') ? 'image/png' : 'image/jpeg';
                    
                    // Try to add as input_reference (if API supports it)
                    videoParams.input_reference = `data:${mimeType};base64,${base64Frame}`;
                    logger.info('✓ Continuity frame added as input_reference');
                } catch (error) {
                    logger.warn('⚠️  Could not load continuity frame, using prompt-based continuity only:', error);
                }
            }
            
            // Reference images disabled: current Sora API rejects 'image' parameter.
            // We rely on TAG DEFINITIONS in the prompt for asset consistency.
            if (imagePaths && (Array.isArray(imagePaths) ? imagePaths.length > 0 : true)) {
                logger.info('ℹ️  Reference images detected but attachment is disabled (API rejects image). Using TAG DEFINITIONS only.');
            } else {
                logger.info('ℹ️  No reference images provided for this segment');
            }
            
            // Try video generation with retry logic
            const completedVideo = await this.generateVideoWithRetry(videoParams, 3);
            
            // Download the video to local storage
            const localVideoPath = await this.downloadVideoToLocal(completedVideo.id, completedVideo.url, storyId);
            
            return {
                id: completedVideo.id,
                url: localVideoPath // Return local path instead of API URL
            };
        } catch (error: any) {
            logger.error('Error generating video segment:', error);
            logger.error('Error stack:', error?.stack);
            logger.error('Error message:', error?.message);
            logger.error('Error details:', JSON.stringify(error, null, 2));
            
            // Provide detailed error information and stop execution
            const errorMessage = error?.message || 'Unknown error';
            const errorDetails = {
                message: errorMessage,
                duration: duration,
                mappedDuration: this.mapDurationToSoraSupported(duration),
                prompt: prompt.substring(0, 100) + '...',
                storyId: storyId
            };
            
            logger.error('Detailed error context:', errorDetails);
            throw new Error(`Video generation failed: ${errorMessage}. Duration: ${duration}s -> ${this.mapDurationToSoraSupported(duration)}s. Please check your API key and Sora access.`);
        }
    }

    /**
     * Generate raw text using GPT-4 for research and analysis
     */
    async generateText(prompt: string): Promise<string> {
        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 2000
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No content returned from OpenAI');
            }

            return content;
        } catch (error) {
            logger.error('OpenAI text generation failed:', error);
            throw error;
        }
    }

    /**
     * Optimize a verbose prompt for Sora following best practices.
     * Uses AI to rewrite prompt while preserving [[tags]].
     */
    async optimizeSoraPrompt(
        rawPrompt: string, 
        maxChars: number, 
        context?: { tagDefinitions?: string; style?: string }
    ): Promise<string> {
        logger.info(`Optimizing Sora prompt using OpenAI GPT-4 (fallback)`);
        
        const systemPrompt = `You rewrite scene prompts for OpenAI Sora video generation.

RULES (STRICT):
- REPLACE all [[tags]] with their EXACT VISUAL descriptions from the TAGS section. NO tags should remain in output.
- Output MUST be <= ${maxChars} characters total. No newlines, no quotes, no parentheses, ASCII only.
- Write 1-2 short sentences. Active voice, present tense.
- Include: WHO (from tag descriptions), WHERE (from tag descriptions), WHAT (action), CAMERA, LIGHTING, MOOD.
- The TAGS section at the top defines what each [[tag]] represents. Replace each [[tag]] with its definition.
- Example: If TAGS says "[[narrator]] = weathered man with gray hair, contemplative expression" then replace [[narrator]] with "weathered man with gray hair, contemplative expression".
- PRESERVE ALL VISUAL CHARACTER DETAILS from the TAGS section (age, appearance, clothing, features). These are critical for consistency.
- DO NOT ADD attributes not present in the tags (like "deep voice", "gentle manner", etc). Only use VISUAL details.
- Do not include technical settings (duration, resolution, fps, aspect ratio).
- Use dense cinematic vocabulary: "35mm lens", "tracking shot", "golden hour", "shallow DoF", "rim lighting", "chiaroscuro".
- Keep descriptions compact but complete enough for Sora to understand all entities and actions.
- Prioritize protagonist action and setting above all else.

CRITICAL: Output must be a complete, standalone prompt with NO [[tags]]. All entities fully described using ONLY the visual details from TAGS section.

OUTPUT: Return ONLY the final optimized prompt text. No preamble, no markdown, no explanations.`;

        const userPrompt = `INPUT PROMPT:\n${rawPrompt}\n\nOPTIMIZED PROMPT (max ${maxChars} chars):`;

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 300
            });

            let optimized = response.choices[0]?.message?.content?.trim() || '';
            
            // Clean up the output
            optimized = optimized
                .replace(/^["']|["']$/g, '')  // Remove surrounding quotes
                .replace(/\n/g, ' ')           // Remove newlines
                .replace(/\s+/g, ' ')          // Collapse multiple spaces
                .trim();
            
            // Validate tag integrity
            const tagPattern = /\[\[[^\]]+\]\]/g;
            const inputTags = (rawPrompt.match(tagPattern) || []);
            
            for (const tag of inputTags) {
                if (!optimized.includes(tag)) {
                    logger.warn(`Tag ${tag} missing from optimized prompt`);
                }
            }
            
            // Check length
            if (optimized.length > maxChars) {
                logger.warn(`Optimized prompt ${optimized.length} chars exceeds limit ${maxChars}, truncating safely`);
                optimized = this.shortenPromptForSora(optimized, maxChars);
            }
            
            logger.info(`Prompt optimization: ${rawPrompt.length} → ${optimized.length} chars`);
            logger.info(`Optimized prompt: ${optimized}`);
            
            return optimized;
        } catch (error) {
            logger.error('OpenAI prompt optimization failed:', error);
            throw error;
        }
    }

    /**
     * Shorten prompt to fit Sora's character limit (~500 chars max)
     * Removes detailed asset descriptions in parentheses while keeping core visual info
     */
    private shortenPromptForSora(prompt: string, maxLength: number = 480): string {
        // First, remove detailed asset descriptions in parentheses
        // Example: "The Narrator (A soul in exile, experiencing...)" -> "The Narrator"
        let shortened = prompt.replace(/\([^)]{30,}\)/g, '');
        
        // If still too long, truncate intelligently
        if (shortened.length > maxLength) {
            // Try to end at a sentence or comma
            const cutoff = shortened.substring(0, maxLength);
            const lastPeriod = cutoff.lastIndexOf('.');
            const lastComma = cutoff.lastIndexOf(',');
            
            const cutPoint = lastPeriod > maxLength * 0.7 ? lastPeriod + 1 :
                           lastComma > maxLength * 0.7 ? lastComma :
                           maxLength;
            
            shortened = shortened.substring(0, cutPoint).trim();
        }
        
        return shortened;
    }

    /**
     * Build style prompt based on visual style configuration
     */
    private buildStylePrompt(visualStyle: string, customStylePrompt?: string): string {
        if (customStylePrompt) {
            return customStylePrompt;
        }

        const stylePrompts: { [key: string]: string } = {
            'naturalistic': 'naturalistic style with realistic lighting and textures',
            'cinematic': 'cinematic style with dramatic lighting and film-like quality',
            'photorealistic': 'ultra-realistic, modern high-fidelity visuals',
            'cartoon': 'stylized animation with vibrant colors and simplified forms',
            'anime': 'Japanese animation style with expressive characters',
            'sci-fi': 'high-tech, futuristic aesthetics with neon and cyberpunk elements',
            'fantasy': 'magical, ethereal, otherworldly environments',
            'retro': 'classic film aesthetic with grain and muted colors',
            'film-noir': 'high contrast black and white with dramatic shadows',
            'monochrome': 'black and white or single-color palette',
            'pastel': 'soft, muted pastel color palette',
            'vaporwave': 'retro-futuristic with neon pinks and blues',
            'stop-motion': 'claymation or puppet animation style',
            'watercolor': 'soft, artistic, painterly aesthetic',
            'oil-painting': 'rich, textured, classical painting style',
            'sketch': 'hand-drawn, minimalist line work',
            'low-poly': 'geometric, minimalist 3D style',
            'pixel-art': '8-bit or 16-bit retro game aesthetic'
        };

        return stylePrompts[visualStyle.toLowerCase()] || 'naturalistic style';
    }

    /**
     * Generate video with retry logic for API failures
     */
    private async generateVideoWithRetry(videoParams: any, maxRetries: number = 3): Promise<{ id: string; url?: string }> {
        let lastError: any;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.info(`🎬 Attempt ${attempt}/${maxRetries}: Creating video with Sora API...`);
                
                const video = await (this.client as any).videos.create(videoParams);
                logger.info(`✅ Video creation initiated: ${video.id}`);
                
                // Poll for completion
                const completedVideo = await this.pollVideoStatus(video.id);
                return completedVideo;
                
            } catch (error: any) {
                lastError = error;
                logger.error(`❌ Attempt ${attempt}/${maxRetries} failed:`, error.message);
                
                // Check if it's a retryable error
                if (this.isRetryableError(error) && attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
                    logger.info(`⏳ Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
                    await this.sleep(delay);
                    
                    // Modify prompt slightly for retry to avoid same failure
                    if (attempt > 1) {
                        videoParams.prompt = this.modifyPromptForRetry(videoParams.prompt, attempt);
                        logger.info(`🔄 Modified prompt for retry: ${videoParams.prompt.substring(0, 100)}...`);
                    }
                } else {
                    break; // Don't retry if not retryable or max retries reached
                }
            }
        }
        
        // All retries failed
        logger.error(`💥 All ${maxRetries} attempts failed. Last error:`, lastError);
        throw new Error(`Video generation failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
    }

    /**
     * Check if an error is retryable
     */
    private isRetryableError(error: any): boolean {
        const errorMessage = error?.message?.toLowerCase() || '';
        const retryableErrors = [
            'internal error',
            'video_generation_failed',
            'rate limit',
            'timeout',
            'network',
            'connection',
            'temporary'
        ];
        
        return retryableErrors.some(retryableError => errorMessage.includes(retryableError));
    }

    /**
     * Modify prompt slightly for retry attempts
     */
    private modifyPromptForRetry(originalPrompt: string, attempt: number): string {
        const modifications = [
            'cinematic quality',
            'high resolution',
            'professional lighting',
            'smooth motion',
            'detailed visuals'
        ];
        
        const modification = modifications[(attempt - 1) % modifications.length];
        return `${originalPrompt}, ${modification}`;
    }

    /**
     * Poll for video generation status
     */
    private async pollVideoStatus(videoId: string, maxAttempts: number = 60): Promise<{ id: string; url?: string }> {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const video = await (this.client as any).videos.retrieve(videoId);
                
                logger.info(`Video ${videoId} status: ${video.status}, progress: ${video.progress || 0}%`);
                logger.info(`Video object keys: ${Object.keys(video).join(', ')}`);
                
                if (video.status === 'completed') {
                    return {
                        id: video.id,
                        url: `https://api.openai.com/v1/videos/${video.id}/content`
                    };
                } else if (video.status === 'failed') {
                    const errorDetail = JSON.stringify((video as any).error || video, null, 2);
                    logger.error(`Video generation failed. Full video object: ${JSON.stringify(video, null, 2)}`);
                    throw new Error(`Video generation failed: ${errorDetail}`);
                }
                
                // Check if video has output_url even if status isn't "completed"
                // Some APIs use different status values
                if (video.output_url || video.url || video.file_url) {
                    logger.info(`Video has URL despite status ${video.status}: ${video.output_url || video.url || video.file_url}`);
                    return {
                        id: video.id,
                        url: video.output_url || video.url || video.file_url
                    };
                }
                
                // Wait before next poll
                await this.sleep(10000); // 10 seconds
            } catch (error) {
                logger.error(`Error polling video status (attempt ${attempt + 1}):`, error);
                if (attempt === maxAttempts - 1) {
                    throw error;
                }
                await this.sleep(10000);
            }
        }
        
        throw new Error('Video generation timed out');
    }

    /**
     * Download video to local storage with proper path structure
     */
    private async downloadVideoToLocal(videoId: string, videoUrl?: string, storyId?: string): Promise<string> {
        try {
            // Create local video directory structure in story segments folder
            const videoDir = path.join(process.cwd(), 'sora-output', 'stories', storyId || 'default', 'segments');
            if (!fs.existsSync(videoDir)) {
                fs.mkdirSync(videoDir, { recursive: true });
            }
            
            // Create filename with video ID and timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `video_${videoId}_${timestamp}.mp4`;
            const localPath = path.join(videoDir, filename);
            
            // Download the video
            await this.downloadVideo(videoId, localPath, videoUrl);
            
            logger.info(`✅ Video downloaded to local storage: ${localPath}`);
            return localPath;
            
        } catch (error) {
            logger.error('Error downloading video to local storage:', error);
            throw error;
        }
    }

    /**
     * Download video content
     */
    async downloadVideo(videoId: string, outputPath: string, videoUrl?: string): Promise<string> {
        try {
            let buffer: Buffer;
            
            // Try API method first
            if (!videoUrl) {
                logger.info(`Downloading video ${videoId} via API...`);
                const content = await ((this.client as any).videos as any).content(videoId);
                buffer = Buffer.from(await content.arrayBuffer());
            } else {
                // Fallback to direct URL download
                logger.info(`Downloading video from URL: ${videoUrl}`);
                const https = require('https');
                const http = require('http');
                
                const protocol = videoUrl.startsWith('https') ? https : http;
                
                buffer = await new Promise<Buffer>((resolve, reject) => {
                    protocol.get(videoUrl, (response: any) => {
                        if (response.statusCode !== 200) {
                            reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                            return;
                        }
                        
                        const chunks: Buffer[] = [];
                        response.on('data', (chunk: Buffer) => chunks.push(chunk));
                        response.on('end', () => resolve(Buffer.concat(chunks)));
                        response.on('error', reject);
                    }).on('error', reject);
                });
            }
            
            // Ensure directory exists
            const dir = require('path').dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(outputPath, buffer);
            logger.info(`Video downloaded successfully to: ${outputPath}`);
            return outputPath;
        } catch (error) {
            logger.error('Error downloading video:', error);
            throw error;
        }
    }

    /**
     * Transcribe audio using Whisper API
     */
    async transcribeAudio(audioPath: string, language?: string): Promise<TranscriptionResult> {
        try {
            const transcription = await this.client.audio.transcriptions.create({
                file: fs.createReadStream(audioPath),
                model: 'whisper-1',
                response_format: 'verbose_json',
                timestamp_granularities: ['word'],
                language
            });

            return {
                text: transcription.text,
                segments: (transcription.words || []).map((word: any) => ({
                    text: word.word,
                    start: word.start,
                    end: word.end
                })),
                duration: transcription.duration || 0
            };
        } catch (error: any) {
            console.error('Error transcribing audio:', error);
            console.error('Error details:', {
                message: error?.message,
                status: error?.status,
                code: error?.code,
                type: error?.type
            });
            throw new Error(`Transcription failed: ${error?.message || error}`);
        }
    }

    /**
     * Generate reference image for any asset (character, vehicle, object, etc.) using DALL-E 3
     */
    async generateCharacterImage(
        asset: any,
        outputPath: string,
        size: '1024x1024' | '1024x1792' | '1792x1024' = '1024x1792'
    ): Promise<string> {
        try {
            logger.info(`Generating reference image with gpt-image-1...`);
            logger.info(`Asset: ${asset.name} (${asset.type})`);
            
            // Create a comprehensive prompt with the full asset context
            // Include the entire asset JSON so DALL-E has all the information
            const assetContext = JSON.stringify({
                name: asset.name,
                type: asset.type,
                description: asset.description,
                visual_attributes: asset.visual_attributes,
                tags: asset.tags
            }, null, 2);
            
            logger.info(`Asset context:\n${assetContext}`);
            
            // Create a detailed prompt that includes the full asset data
            // Keep it SIMPLE and PHOTOREALISTIC - this is a reference photo, not an art piece
            const prompt = `You are creating a professional reference photograph for film production. Here is the complete asset specification in JSON format:

${assetContext}

CRITICAL REQUIREMENTS for the photograph:
1. PHOTOREALISTIC: Create a real photograph, not an artistic rendering or stylized image
2. FULL VIEW: Show the complete subject from head to toe (or equivalent full view for objects/vehicles)
3. NEUTRAL POSE: Natural, neutral standing/resting position
4. STUDIO BACKGROUND: Solid grey studio background, no environment, no props, no scenery
5. FLAT LIGHTING: Even, uniform lighting from all sides - NO shadows, NO dramatic lighting, NO artistic effects
6. STRAIGHT-ON: Front-facing view, straightforward portrait style
7. TECHNICAL REFERENCE: This is for VFX reference, not an art piece - keep it simple, literal, and realistic
8. LITERAL INTERPRETATION: Interpret all descriptions literally and photographically - avoid symbolic or metaphorical interpretations
9. APPROPRIATE ATTIRE: For humanoid characters, ensure they are appropriately clothed as befits the character

If the description includes abstract or metaphorical elements (like "formless", "ethereal", "divine"), represent them as concrete, photographable subjects (e.g., a person in robes, an animal, an object).`;

            
            const response = await this.client.images.generate({
                model: 'gpt-image-1',
                prompt: prompt,
                n: 1,
                size: size === '1024x1792' ? '1024x1536' : (size === '1792x1024' ? '1536x1024' : size) // gpt-image-1 supports different sizes
            });
            
            // gpt-image-1 returns base64-encoded images by default
            const b64Image = response.data?.[0]?.b64_json;
            if (!b64Image) {
                logger.error(`Response data: ${JSON.stringify(response.data)}`);
                throw new Error('No base64 image returned from gpt-image-1');
            }
            
            logger.info(`Received base64 image from gpt-image-1`);
            const buffer = Buffer.from(b64Image, 'base64');
            
            // Ensure directory exists
            const path = require('path');
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(outputPath, buffer);
            logger.info(`Reference image saved to: ${outputPath}`);
            
            return outputPath;
        } catch (error) {
            logger.error('Error generating reference image with gpt-image-1:', error);
            throw error;
        }
    }

    /**
     * Transcribe multiple audio chunks and merge results
     */
    async transcribeAudioChunks(chunkPaths: string[], language?: string): Promise<TranscriptionResult> {
        try {
            const chunkResults: TranscriptionResult[] = [];
            let cumulativeDuration = 0;

            for (let i = 0; i < chunkPaths.length; i++) {
                console.log(`Transcribing chunk ${i + 1} of ${chunkPaths.length}...`);
                const chunkResult = await this.transcribeAudio(chunkPaths[i], language);
                
                // Adjust timestamps by cumulative duration
                const adjustedSegments = chunkResult.segments.map(seg => ({
                    text: seg.text,
                    start: seg.start + cumulativeDuration,
                    end: seg.end + cumulativeDuration
                }));

                chunkResults.push({
                    text: chunkResult.text,
                    segments: adjustedSegments,
                    duration: chunkResult.duration
                });

                cumulativeDuration += chunkResult.duration;
            }

            // Merge all results
            return {
                text: chunkResults.map(r => r.text).join(' '),
                segments: chunkResults.flatMap(r => r.segments),
                duration: cumulativeDuration
            };
        } catch (error: any) {
            console.error('Error transcribing audio chunks:', error);
            throw new Error(`Chunked transcription failed: ${error?.message || error}`);
        }
    }

    /**
     * Extract assets from content using GPT-4 with research context
     */
    async extractAssetsWithResearch(
        content: string,
        audioAnalysis?: any,
        researchText?: string,
        progressManager?: any,
        parentTaskId?: string
    ): Promise<any[]> {
        try {
            // Step 1: Analyzing content
            const analyzeTaskId = parentTaskId ? `${parentTaskId}_analyze` : null;
            if (progressManager && parentTaskId && analyzeTaskId) {
                progressManager.startTask(analyzeTaskId, '$(search) Analyze Content with Research', parentTaskId);
            }
            
            const systemPrompt = `You are an expert at analyzing content and identifying reusable visual assets for video production with ULTRA-REALISTIC, PHOTOREALISTIC detail.

🎬 CRITICAL FIRST STEP: IDENTIFY THE PROTAGONIST
================================================
BEFORE extracting assets, determine WHO is the MAIN CHARACTER / PROTAGONIST of this story:

⚠️ PROTAGONIST IDENTIFICATION RULES:
1. If the narration uses "I", "me", "my" → The NARRATOR is the protagonist (even if they describe others)
2. If narration uses "he/she/they" → The person whose journey we follow most is the protagonist
3. The protagonist is the "star of the show" - their perspective drives the camera

➤ CREATE THE PROTAGONIST CHARACTER ASSET FIRST
➤ Name them simply: "Narrator" (if unnamed), "John" (if named), "Protagonist" (if generic)
➤ Mark this clearly in the description: "THIS IS THE PROTAGONIST - the camera's POV character"
➤ Ensure ALL other character assets are clearly SECONDARY to the protagonist

Analyze the provided content and identify all unique visual assets that should be tracked for consistency across scenes.

Extract and categorize assets into these types:
1. CHARACTERS - People, beings, entities with distinct appearances (START WITH THE PROTAGONIST, then add others)
2. LOCATIONS - Places, settings, environments (e.g., "Throne Room of Heaven", "Patmos Island", "Desert Wilderness")
3. ITEMS - Props, objects, significant items (e.g., "Scroll", "Trumpet", "Sword of Truth")
4. VEHICLES - Transportation, vessels (e.g., "White Horse", "Chariot of Fire")
5. ANIMALS - Creatures, beasts (e.g., "Four Living Creatures", "Dragon")

CRITICAL: Provide EXTREMELY DETAILED, PHOTOREALISTIC descriptions. Think like a cinematographer capturing every visual detail.

For CHARACTERS, include these visual_attributes:
- appearance: Overall physical impression, age, height, build (3-5 sentences, ultra-detailed)
- face: Facial structure, features, expressions, wrinkles, cheekbones, jawline (3-5 sentences)
- eyes: Color, shape, emotional quality, gaze direction (2-3 sentences)
- hair: Length, color, texture, style, condition (2-3 sentences)
- beard: (if applicable) Length, color, texture, style, grooming (1-2 sentences)
- skin: Tone, texture, weathering, age spots, complexion (2-3 sentences)
- body_and_build: Body type, posture, physical condition, height, weight characteristics (2-3 sentences)
- hands_and_feet: Condition, calluses, veins, jewelry, footwear (2-3 sentences)
- clothes: Detailed clothing description, fabric, condition, colors, layers, accessories (3-5 sentences)
- accessories: Jewelry, weapons, carried items, symbolic objects (if applicable)
- aura_and_atmosphere: (for divine/spiritual beings) Energy, light, supernatural qualities (3-5 sentences)
- colors: Comprehensive color palette (1-2 sentences)
- distinguishing_features: Unique identifying characteristics (2-3 sentences)
- typical_lighting: How light interacts with this character (2-3 sentences)
- mood: Emotional tone, psychological state (1-2 sentences)

For LOCATIONS, include these visual_attributes:
- overall_impression: First impression, scope, scale, atmosphere (3-5 sentences)
- terrain: Ground composition, elevation, geological features (2-3 sentences for applicable locations)
- vegetation: Plant life, trees, grass, flowers (if applicable, 2-3 sentences)
- architecture: Buildings, structures, construction style (if applicable, 3-5 sentences)
- atmospheric_conditions: Sky, weather, air quality, visibility (2-3 sentences)
- textures: Surface qualities throughout the environment (2-3 sentences)
- sounds: Ambient sounds, audio atmosphere (1-2 sentences)
- smells: Scent descriptions to enhance immersion (1-2 sentences)
- time_of_day: Lighting conditions based on time (1-2 sentences)
- colors: Comprehensive color palette (1-2 sentences)
- distinguishing_features: Unique identifying characteristics (2-3 sentences)
- typical_lighting: Light sources and quality (2-3 sentences)
- mood: Emotional atmosphere (1-2 sentences)

For ITEMS, include these visual_attributes:
- appearance: Overall look and impression (2-3 sentences)
- material_and_construction: What it's made of, how it's built (2-3 sentences)
- decorative_details: Ornaments, engravings, embellishments (2-3 sentences)
- size_and_scale: Dimensions, weight impression, portability (1-2 sentences)
- texture: Surface qualities, touch impression (1-2 sentences)
- interaction_with_light: How light reflects, refracts, or is emitted (1-2 sentences)
- colors: Color palette (1-2 sentences)
- distinguishing_features: Unique identifying characteristics (1-2 sentences)
- typical_lighting: Best lighting for this item (1-2 sentences)
- mood: Emotional quality the item conveys (1-2 sentences)

For ANIMALS/VEHICLES, adapt the above attributes as appropriate.

SPECIAL CASES:
- For FAMILIES or CHARACTER GROUPS: Create separate attributes for each member (father, mother, child_1, etc.)
- For TRANSFORMATION NARRATIVES: Include separate states (e.g., "stressed_state", "healed_state", "beginning_state", "end_state")
- For DIVINE/SUPERNATURAL BEINGS: Emphasize energy, light, non-physical qualities, internal illumination
- For MODERN/REALISTIC STORIES: Focus on contemporary details, relatable human features, everyday realism

🔑 CRITICAL: ASSET NAMING RULES
================================
**NAMES MUST BE CLEAN, SIMPLE, HUMAN-READABLE:**
✅ CORRECT: "John", "Divine Figure", "Patmos Island", "Seven Lamps", "Narrator"
❌ WRONG: "narrator_TheNarrator", "TheVoice_TheLambOfGod", "IslandSetting", "john_the_apostle"

**NAMING FORMAT:**
- Use simple, descriptive names with spaces
- Capitalize like normal titles: "John", "Divine Figure", "Rocky Shore"
- NO underscores, NO CamelCase, NO code-style names
- Keep it SHORT and MEMORABLE (1-3 words max)
- The system will auto-generate IDs like "character_john", "location_patmos_island"

**EXAMPLES:**
- Character: "Narrator", "John", "Divine Figure", "Mary", "Soldier"
- Location: "Patmos Island", "Heavenly Realm", "Desert", "Throne Room"
- Item: "Seven Lamps", "Trumpet", "Scroll", "Sword"

Return a JSON object with this structure:
{
    "assets": [
        {
            "name": "Narrator",
            "type": "character",
            "description": "THIS IS THE PROTAGONIST - the camera's POV character. Elderly person experiencing profound spiritual revelation, witnessing divine phenomena.",
            "visual_attributes": {
                "appearance": "An elderly man in his 80s or 90s, with a weathered but serene face that reflects decades of faith and hardship...",
                "face": "Deeply lined forehead with prominent wrinkles around the eyes from years of sun exposure...",
                "eyes": "Deep brown or hazel eyes capable of conveying profound spiritual depth...",
                "hair": "Long white hair falling past his shoulders, thinning at the crown...",
                "beard": "Long, flowing white beard reaching to mid-chest, full but slightly unkempt...",
                "skin": "Deeply tanned and weathered from Mediterranean sun, with age spots...",
                "body_and_build": "Thin and wiry from sparse provisions, approximately 5'6\" tall...",
                "hands_and_feet": "Gnarled, arthritic hands with prominent veins and age spots...",
                "clothes": "Simple, worn linen tunic in natural beige, darker brown wool outer robe...",
                "colors": "Earthy palette: weathered beige, faded browns, dusty terracotta...",
                "distinguishing_features": "Piercing, luminous eyes that seem to see beyond the physical realm...",
                "typical_lighting": "Harsh Mediterranean sunlight casting deep shadows, golden hour during reflection...",
                "mood": "Deeply contemplative and serene, with underlying intensity..."
            },
            "references": ["location_patmos_island", "item_scroll"],
            "tags": ["biblical", "apostle", "revelation", "prophet", "elderly"],
            "indexed_in": ["revelation"]
        }
    ]
}

CRITICAL REQUIREMENTS:
- Be EXHAUSTIVELY detailed - imagine you're briefing a cinematographer and costume designer
- Use CONCRETE, VISUAL language - avoid vague abstractions
- Include SPECIFIC measurements, colors, materials, textures
- For biblical/spiritual content: Balance reverence with visual specificity
- For modern stories: Include contemporary, relatable details
- DIFFERENTIATE between biblical/spiritual and modern/realistic contexts
- Each visual attribute should be 2-5 sentences of rich description
- Think PHOTOREALISM - what would a camera capture?
- Only extract assets actually mentioned or clearly implied in the content`;

            const userPrompt = `Analyze this content and extract all visual assets:

${content}

${audioAnalysis ? `\nAudio Analysis Context:\n${JSON.stringify(audioAnalysis, null, 2)}` : ''}

${researchText ? `\nResearch Context:\n${researchText}` : ''}

Return a comprehensive list of assets found in this content.`;

            // Complete step 1
            if (progressManager && analyzeTaskId) {
                progressManager.completeTask(analyzeTaskId); // Task name is sufficient
            }
            
            // Step 2: Calling AI
            const aiCallTaskId = parentTaskId ? `${parentTaskId}_ai_call` : null;
            if (progressManager && parentTaskId && aiCallTaskId) {
                progressManager.startTask(aiCallTaskId, '$(robot) Call AI to Identify Assets', parentTaskId);
            }
            
            const response = await this.client.chat.completions.create({
                model: 'gpt-4.1',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7
            });

            // Complete step 2
            if (progressManager && aiCallTaskId) {
                progressManager.completeTask(aiCallTaskId); // Task name is sufficient
            }
            
            // Step 3: Processing response
            const processTaskId = parentTaskId ? `${parentTaskId}_process` : null;
            if (progressManager && parentTaskId && processTaskId) {
                progressManager.startTask(processTaskId, '$(json) Process AI Response', parentTaskId);
            }
            
            const resultText = response.choices[0].message.content;
            if (!resultText) {
                throw new Error('No response from GPT-4');
            }

            const result = JSON.parse(resultText);
            const assets = result.assets || [];
            
            // Complete step 3
            if (progressManager && processTaskId) {
                progressManager.completeTask(processTaskId); // Task name is sufficient
            }
            
            return assets;
        } catch (error) {
            console.error('Error extracting assets with research:', error);
            throw error;
        }
    }

    /**
     * Extract assets from content using GPT-4
     */
    async extractAssets(
        content: string,
        audioAnalysis?: any,
        progressManager?: any,
        parentTaskId?: string
    ): Promise<any[]> {
        try {
            // Step 1: Analyzing content
            const analyzeTaskId = parentTaskId ? `${parentTaskId}_analyze` : null;
            if (progressManager && parentTaskId && analyzeTaskId) {
                progressManager.startTask(analyzeTaskId, '$(search) Analyze Content', parentTaskId);
            }
            
            const systemPrompt = `You are an expert at analyzing content and identifying reusable visual assets for video production with ULTRA-REALISTIC, PHOTOREALISTIC detail.

🎬 CRITICAL FIRST STEP: IDENTIFY THE PROTAGONIST
================================================
BEFORE extracting assets, determine WHO is the MAIN CHARACTER / PROTAGONIST of this story:

⚠️ PROTAGONIST IDENTIFICATION RULES:
1. If the narration uses "I", "me", "my" → The NARRATOR is the protagonist (even if they describe others)
2. If narration uses "he/she/they" → The person whose journey we follow most is the protagonist
3. The protagonist is the "star of the show" - their perspective drives the camera

➤ CREATE THE PROTAGONIST CHARACTER ASSET FIRST
➤ Name them simply: "Narrator" (if unnamed), "John" (if named), "Protagonist" (if generic)
➤ Mark this clearly in the description: "THIS IS THE PROTAGONIST - the camera's POV character"
➤ Ensure ALL other character assets are clearly SECONDARY to the protagonist

Analyze the provided content and identify all unique visual assets that should be tracked for consistency across scenes.

Extract and categorize assets into these types:
1. CHARACTERS - People, beings, entities with distinct appearances (START WITH THE PROTAGONIST, then add others)
2. LOCATIONS - Places, settings, environments (e.g., "Throne Room of Heaven", "Patmos Island", "Desert Wilderness")
3. ITEMS - Props, objects, significant items (e.g., "Scroll", "Trumpet", "Sword of Truth")
4. VEHICLES - Transportation, vessels (e.g., "White Horse", "Chariot of Fire")
5. ANIMALS - Creatures, beasts (e.g., "Four Living Creatures", "Dragon")

CRITICAL: Provide EXTREMELY DETAILED, PHOTOREALISTIC descriptions. Think like a cinematographer capturing every visual detail.

For CHARACTERS, include these visual_attributes:
- appearance: Overall physical impression, age, height, build (3-5 sentences, ultra-detailed)
- face: Facial structure, features, expressions, wrinkles, cheekbones, jawline (3-5 sentences)
- eyes: Color, shape, emotional quality, gaze direction (2-3 sentences)
- hair: Length, color, texture, style, condition (2-3 sentences)
- beard: (if applicable) Length, color, texture, style, grooming (1-2 sentences)
- skin: Tone, texture, weathering, age spots, complexion (2-3 sentences)
- body_and_build: Body type, posture, physical condition, height, weight characteristics (2-3 sentences)
- hands_and_feet: Condition, calluses, veins, jewelry, footwear (2-3 sentences)
- clothes: Detailed clothing description, fabric, condition, colors, layers, accessories (3-5 sentences)
- accessories: Jewelry, weapons, carried items, symbolic objects (if applicable)
- aura_and_atmosphere: (for divine/spiritual beings) Energy, light, supernatural qualities (3-5 sentences)
- colors: Comprehensive color palette (1-2 sentences)
- distinguishing_features: Unique identifying characteristics (2-3 sentences)
- typical_lighting: How light interacts with this character (2-3 sentences)
- mood: Emotional tone, psychological state (1-2 sentences)

For LOCATIONS, include these visual_attributes:
- overall_impression: First impression, scope, scale, atmosphere (3-5 sentences)
- terrain: Ground composition, elevation, geological features (2-3 sentences for applicable locations)
- vegetation: Plant life, trees, grass, flowers (if applicable, 2-3 sentences)
- architecture: Buildings, structures, construction style (if applicable, 3-5 sentences)
- atmospheric_conditions: Sky, weather, air quality, visibility (2-3 sentences)
- textures: Surface qualities throughout the environment (2-3 sentences)
- sounds: Ambient sounds, audio atmosphere (1-2 sentences)
- smells: Scent descriptions to enhance immersion (1-2 sentences)
- time_of_day: Lighting conditions based on time (1-2 sentences)
- colors: Comprehensive color palette (1-2 sentences)
- distinguishing_features: Unique identifying characteristics (2-3 sentences)
- typical_lighting: Light sources and quality (2-3 sentences)
- mood: Emotional atmosphere (1-2 sentences)

For ITEMS, include these visual_attributes:
- appearance: Overall look and impression (2-3 sentences)
- material_and_construction: What it's made of, how it's built (2-3 sentences)
- decorative_details: Ornaments, engravings, embellishments (2-3 sentences)
- size_and_scale: Dimensions, weight impression, portability (1-2 sentences)
- texture: Surface qualities, touch impression (1-2 sentences)
- interaction_with_light: How light reflects, refracts, or is emitted (1-2 sentences)
- colors: Color palette (1-2 sentences)
- distinguishing_features: Unique identifying characteristics (1-2 sentences)
- typical_lighting: Best lighting for this item (1-2 sentences)
- mood: Emotional quality the item conveys (1-2 sentences)

For ANIMALS/VEHICLES, adapt the above attributes as appropriate.

SPECIAL CASES:
- For FAMILIES or CHARACTER GROUPS: Create separate attributes for each member (father, mother, child_1, etc.)
- For TRANSFORMATION NARRATIVES: Include separate states (e.g., "stressed_state", "healed_state", "beginning_state", "end_state")
- For DIVINE/SUPERNATURAL BEINGS: Emphasize energy, light, non-physical qualities, internal illumination
- For MODERN/REALISTIC STORIES: Focus on contemporary details, relatable human features, everyday realism

🔑 CRITICAL: ASSET NAMING RULES
================================
**NAMES MUST BE CLEAN, SIMPLE, HUMAN-READABLE:**
✅ CORRECT: "John", "Divine Figure", "Patmos Island", "Seven Lamps", "Narrator"
❌ WRONG: "narrator_TheNarrator", "TheVoice_TheLambOfGod", "IslandSetting", "john_the_apostle"

**NAMING FORMAT:**
- Use simple, descriptive names with spaces
- Capitalize like normal titles: "John", "Divine Figure", "Rocky Shore"
- NO underscores, NO CamelCase, NO code-style names
- Keep it SHORT and MEMORABLE (1-3 words max)
- The system will auto-generate IDs like "character_john", "location_patmos_island"

**EXAMPLES:**
- Character: "Narrator", "John", "Divine Figure", "Mary", "Soldier"
- Location: "Patmos Island", "Heavenly Realm", "Desert", "Throne Room"
- Item: "Seven Lamps", "Trumpet", "Scroll", "Sword"

Return a JSON object with this structure:
{
    "assets": [
        {
            "name": "Narrator",
            "type": "character",
            "description": "THIS IS THE PROTAGONIST - the camera's POV character. Elderly person experiencing profound spiritual revelation, witnessing divine phenomena.",
            "visual_attributes": {
                "appearance": "An elderly man in his 80s or 90s, with a weathered but serene face that reflects decades of faith and hardship...",
                "face": "Deeply lined forehead with prominent wrinkles around the eyes from years of sun exposure...",
                "eyes": "Deep brown or hazel eyes capable of conveying profound spiritual depth...",
                "hair": "Long white hair falling past his shoulders, thinning at the crown...",
                "beard": "Long, flowing white beard reaching to mid-chest, full but slightly unkempt...",
                "skin": "Deeply tanned and weathered from Mediterranean sun, with age spots...",
                "body_and_build": "Thin and wiry from sparse provisions, approximately 5'6\" tall...",
                "hands_and_feet": "Gnarled, arthritic hands with prominent veins and age spots...",
                "clothes": "Simple, worn linen tunic in natural beige, darker brown wool outer robe...",
                "colors": "Earthy palette: weathered beige, faded browns, dusty terracotta...",
                "distinguishing_features": "Piercing, luminous eyes that seem to see beyond the physical realm...",
                "typical_lighting": "Harsh Mediterranean sunlight casting deep shadows, golden hour during reflection...",
                "mood": "Deeply contemplative and serene, with underlying intensity..."
            },
            "references": ["location_patmos_island", "item_scroll"],
            "tags": ["biblical", "apostle", "revelation", "prophet", "elderly"],
            "indexed_in": ["revelation"]
        }
    ]
}

CRITICAL REQUIREMENTS:
- Be EXHAUSTIVELY detailed - imagine you're briefing a cinematographer and costume designer
- Use CONCRETE, VISUAL language - avoid vague abstractions
- Include SPECIFIC measurements, colors, materials, textures
- For biblical/spiritual content: Balance reverence with visual specificity
- For modern stories: Include contemporary, relatable details
- DIFFERENTIATE between biblical/spiritual and modern/realistic contexts
- Each visual attribute should be 2-5 sentences of rich description
- Think PHOTOREALISM - what would a camera capture?
- Only extract assets actually mentioned or clearly implied in the content`;

            const userPrompt = `Analyze this content and extract all visual assets:

${content}

${audioAnalysis ? `\nAudio Analysis Context:\n${JSON.stringify(audioAnalysis, null, 2)}` : ''}

Return a comprehensive list of assets found in this content.`;

            // Complete step 1
            if (progressManager && analyzeTaskId) {
                progressManager.completeTask(analyzeTaskId); // Task name is sufficient
            }
            
            // Step 2: Calling AI
            const aiCallTaskId = parentTaskId ? `${parentTaskId}_ai_call` : null;
            if (progressManager && parentTaskId && aiCallTaskId) {
                progressManager.startTask(aiCallTaskId, '$(robot) Call AI to Identify Assets', parentTaskId);
            }
            
            const response = await this.client.chat.completions.create({
                model: 'gpt-4.1',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7
            });

            // Complete step 2
            if (progressManager && aiCallTaskId) {
                progressManager.completeTask(aiCallTaskId); // Task name is sufficient
            }
            
            // Step 3: Processing response
            const processTaskId = parentTaskId ? `${parentTaskId}_process` : null;
            if (progressManager && parentTaskId && processTaskId) {
                progressManager.startTask(processTaskId, '$(json) Process AI Response', parentTaskId);
            }
            
            const resultText = response.choices[0].message.content;
            if (!resultText) {
                throw new Error('No response from GPT-4');
            }

            const result = JSON.parse(resultText);
            const assets = result.assets || [];
            
            // Complete step 3
            if (progressManager && processTaskId) {
                progressManager.completeTask(processTaskId); // Task name is sufficient
            }
            
            return assets;
        } catch (error) {
            console.error('Error extracting assets:', error);
            throw error;
        }
    }

    /**
     * Generate director's script using GPT-4 with asset library support
     */
    async generateDirectorScript(
        content: string,
        audioAnalysis?: any,
        assetLibrary?: any[],
        timingMap?: any,
        aiService?: any
    ): Promise<DirectorScript> {
        try {
            // If we have timing map with pre-segmented timing, delegate to AIService for visual generation
            if (timingMap && timingMap.segments && timingMap.segments.length > 0) {
                logger.info(`Using timing-based segmentation: ${timingMap.segments.length} segments from audio analysis`);
                
                // This will be handled by the caller (ExecutionService/Wizard) using AIService
                // For now, throw error to indicate this path needs AI service integration
                throw new Error('Timing-based script generation should be called through AIService, not directly');
            }
            
            // Fallback to AI-based segmentation (legacy path)
            logger.info(`Using AI-based segmentation (no timing map available)`);
            
            // Build system prompt with asset library if available
            let systemPrompt = `You are a professional music video director with access to a preset asset library. Create a compelling visual story that brings content to life.`;

            if (assetLibrary && assetLibrary.length > 0) {
                // Build [[tag]] map for assets
                const makeTag = (name: string) => '[[' + String(name || '')
                    .toLowerCase()
                    .replace(/[^a-z0-9_]+/g, '_')
                    .replace(/^_+|_+$/g, '') + ']';
                const tagMappings = assetLibrary.map(a => `  ${makeTag(a.name).padEnd(25)} → ${a.id} (${a.type})`).join('\n');

                systemPrompt += `\n\nAVAILABLE PRESET ASSETS (USE [[tags]] ONLY):\n${JSON.stringify(assetLibrary, null, 2)}

ASSET TAG MAP (copy these EXACT [[tags]] into visualPrompt, then list IDs in usedAssets):
${tagMappings}

RULES FOR ASSETS AND PROMPTS:
1) Use [[tags]] ONLY; NEVER paste asset descriptions into visualPrompt
2) Every segment MUST include usedAssets with exact asset IDs (protagonist first)
3) visualPrompt must be ≤ 420 chars; no long parenthetical descriptions
4) Keep scene-focused; describe ACTION, CAMERA, LIGHT, MOOD
`;
            }
            
            systemPrompt += `\n\nAnalyze the content and create a JSON response with this exact structure:
{
    "title": "Extract or infer the song title",
    "theme": "Main emotional/artistic theme",
    "mood": "Dominant emotional tone",
    "visualStyle": "Overall visual aesthetic",
    "colorPalette": "Primary colors that match the mood",
    "segments": [
        {
            "id": "segment_1",
            "visualPrompt": "Detailed, cinematic visual description${assetLibrary && assetLibrary.length > 0 ? ' (use [[tags]] only; NEVER paste asset descriptions; ≤420 chars)' : ''}",
            "cameraWork": "Camera movement and angles",
            "lighting": "Lighting and mood",
            "mood": "Emotional tone"${assetLibrary && assetLibrary.length > 0 ? ',\n            "usedAssets": ["asset_id_1", "asset_id_2"]' : ''}
        }
    ],
}

CRITICAL INSTRUCTIONS:
1. Read the content carefully and identify all characters, locations, and objects
2. Create visual prompts that directly relate to the specific content
3. ${assetLibrary && assetLibrary.length > 0 ? 'Use [[tags]] ONLY and list IDs in usedAssets (protagonist first)' : 'Make prompts cinematic and specific'}
4. Use actual imagery and metaphors from the content
5. Match the visual style to the content's mood and theme
6. Each segment should be 1-12 seconds
7. Include specific visual elements mentioned in the content`;

            const userPrompt = `Create a cinematic director's script for this content:

${content}

${audioAnalysis ? `\nAudio Analysis:\n${JSON.stringify(audioAnalysis, null, 2)}` : ''}

Generate a detailed visual story with specific, context-aware prompts${assetLibrary && assetLibrary.length > 0 ? ', using the provided asset library for consistency' : ''}.`;

            const response = await this.client.chat.completions.create({
                model: 'gpt-4.1',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7
            });

            const scriptText = response.choices[0].message.content;
            if (!scriptText) {
                throw new Error('No response from GPT-4');
            }

            // Parse and validate the response
            const script = JSON.parse(scriptText) as DirectorScript;
            
            // Preserve exact durations from script (no quantization), default to 4s min
            script.segments = script.segments.map(seg => ({
                ...seg,
                duration: Math.max(1, Number(seg.duration) || 4),
                status: 'pending' as const
            }));

            return script;
        } catch (error) {
            console.error('Error generating Script:', error);
            throw error;
        }
    }

    /**
     * Normalize duration to valid Sora values (4, 8, or 12)
     */
    private normalizeDuration(duration: number): 4 | 8 | 12 {
        if (duration <= 4) return 4;
        if (duration <= 8) return 8;
        return 12;
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Update API key
     */
    updateApiKey(apiKey: string): void {
        this.client = new OpenAI({ apiKey });
    }

    /**
     * Select best visual style for content
     */
    async selectBestVisualStyle(transcription: string): Promise<string> {
        const prompt = `Based on this content, what visual style would work best for video generation?

Content: "${transcription.substring(0, 500)}..."

Choose from these 18 styles:
- naturalistic: Realistic, documentary-style
- cinematic: Hollywood movie quality with dramatic lighting
- photorealistic: Ultra-realistic, modern high-fidelity
- cartoon: Stylized animation with vibrant colors
- anime: Japanese animation style with expressive characters
- sci-fi: High-tech, futuristic with neon elements
- fantasy: Magical, ethereal, otherworldly
- retro: Classic film aesthetic with grain
- film-noir: High contrast black and white with dramatic shadows
- monochrome: Black and white or single-color palette
- pastel: Soft, muted pastel color palette
- vaporwave: Retro-futuristic with neon pinks and blues
- stop-motion: Claymation or puppet animation style
- watercolor: Soft, artistic, painterly aesthetic
- oil-painting: Rich, textured, classical painting style
- sketch: Hand-drawn, minimalist line work
- low-poly: Geometric, minimalist 3D style
- pixel-art: 8-bit or 16-bit retro game aesthetic

Return only the style name (e.g., "cinematic").`;

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-4.1',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 50
            });

            const style = response.choices[0]?.message?.content?.trim().toLowerCase() || 'naturalistic';
            
            // Validate the style is one of the 18 supported styles
            const validStyles = [
                'naturalistic', 'cinematic', 'photorealistic', 'cartoon', 'anime',
                'sci-fi', 'fantasy', 'retro', 'film-noir', 'monochrome', 'pastel',
                'vaporwave', 'stop-motion', 'watercolor', 'oil-painting', 'sketch',
                'low-poly', 'pixel-art'
            ];

            if (validStyles.includes(style)) {
                return style;
            } else {
                console.warn(`Invalid style returned: ${style}, defaulting to naturalistic`);
                return 'naturalistic';
            }
        } catch (error) {
            console.error('Failed to select visual style:', error);
            return 'naturalistic'; // Default fallback
        }
    }
}

