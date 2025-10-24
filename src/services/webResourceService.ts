/**
 * Web Resource Service
 * Handles fetching content from web resources (YouTube, web pages, audio URLs)
 */

import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface YouTubeMetadata {
    title: string;
    description: string;
    duration: number;
    thumbnail: string;
}

export interface WebPageContent {
    title: string;
    text: string;
    url: string;
}

export class WebResourceService {
    private userAgent = 'Sora Director Extension/1.0';

    /**
     * Detect the type of web resource from URL
     */
    detectResourceType(url: string): 'youtube' | 'audio' | 'webpage' | 'unknown' {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();

            // YouTube detection
            if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
                return 'youtube';
            }

            // Audio file detection
            const audioExtensions = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac'];
            const pathname = urlObj.pathname.toLowerCase();
            if (audioExtensions.some(ext => pathname.endsWith(ext))) {
                return 'audio';
            }

            // Default to webpage
            return 'webpage';
        } catch (error) {
            logger.error('Invalid URL provided:', error);
            return 'unknown';
        }
    }

    /**
     * Fetch YouTube video metadata
     */
    async fetchYouTubeMetadata(url: string): Promise<YouTubeMetadata> {
        try {
            // Extract video ID from various YouTube URL formats
            const videoId = this.extractYouTubeVideoId(url);
            if (!videoId) {
                throw new Error('Could not extract video ID from YouTube URL');
            }

            // For now, return basic metadata
            // In a real implementation, you'd use YouTube API or web scraping
            return {
                title: `YouTube Video ${videoId}`,
                description: 'Video description not available',
                duration: 0,
                thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
            };
        } catch (error) {
            logger.error('Error fetching YouTube metadata:', error);
            throw new Error(`Failed to fetch YouTube metadata: ${error}`);
        }
    }

    /**
     * Extract YouTube video ID from URL
     */
    private extractYouTubeVideoId(url: string): string | null {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
            /youtube\.com\/embed\/([^&\n?#]+)/,
            /youtube\.com\/v\/([^&\n?#]+)/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    }

    /**
     * Fetch web page content and extract text
     */
    async fetchWebPageText(url: string): Promise<WebPageContent> {
        try {
            const html = await this.fetchUrl(url) as string;
            const content = this.extractTextFromHTML(html);
            
            return {
                title: this.extractTitleFromHTML(html),
                text: content,
                url: url
            };
        } catch (error) {
            logger.error('Error fetching web page content:', error);
            throw new Error(`Failed to fetch web page: ${error}`);
        }
    }

    /**
     * Download audio from URL
     */
    async fetchAudioFromURL(url: string, outputPath: string): Promise<void> {
        try {
            const audioData = await this.fetchUrl(url, { responseType: 'arraybuffer' });
            
            // Ensure directory exists
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Write audio data to file
            fs.writeFileSync(outputPath, audioData);
            logger.info(`Audio downloaded to: ${outputPath}`);
        } catch (error) {
            logger.error('Error downloading audio:', error);
            throw new Error(`Failed to download audio: ${error}`);
        }
    }

    /**
     * Generic URL fetcher
     */
    private async fetchUrl(url: string, options: { responseType?: 'text' | 'arraybuffer' } = {}): Promise<string | Buffer> {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;

            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'User-Agent': this.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            };

            const req = client.request(requestOptions, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    if (options.responseType === 'arraybuffer') {
                        data += chunk;
                    } else {
                        data += chunk.toString();
                    }
                });

                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        if (options.responseType === 'arraybuffer') {
                            resolve(Buffer.from(data, 'binary'));
                        } else {
                            resolve(data);
                        }
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    /**
     * Extract text content from HTML
     */
    private extractTextFromHTML(html: string): string {
        // Simple HTML text extraction
        // Remove script and style elements
        let text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]*>/g, ' ') // Remove HTML tags
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        // Limit length
        if (text.length > 10000) {
            text = text.substring(0, 10000) + '...';
        }

        return text;
    }

    /**
     * Extract title from HTML
     */
    private extractTitleFromHTML(html: string): string {
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (titleMatch) {
            return titleMatch[1].trim();
        }

        // Fallback to first h1
        const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
        if (h1Match) {
            return h1Match[1].trim();
        }

        return 'Untitled';
    }

    /**
     * Validate URL format
     */
    validateUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
}
