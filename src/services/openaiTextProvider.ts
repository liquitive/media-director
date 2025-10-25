/**
 * OpenAI Text Provider
 * Wrapper for OpenAIService to implement ITextAIProvider interface
 * Used as fallback when IDE AI is not available
 */

import { ITextAIProvider } from './aiService';
import { OpenAIService } from './openaiService';

export class OpenAITextProvider implements ITextAIProvider {
    constructor(private openaiService: OpenAIService) {}
    
    async isAvailable(): Promise<boolean> {
        // Always available if OpenAIService was initialized
        return true;
    }
    
    async generateDirectorScript(transcription: string, audioAnalysis?: any, assetLibrary?: any[]): Promise<any> {
        return this.openaiService.generateDirectorScript(transcription, audioAnalysis, assetLibrary);
    }
    
    async getRawText(prompt: string): Promise<string> {
        // Use OpenAI's chat completion API for research text generation
        try {
            const response = await this.openaiService.generateText(prompt);
            return response;
        } catch (error) {
            throw new Error(`OpenAI research generation failed: ${error}`);
        }
    }

    async analyzeContent(content: string): Promise<any> {
        // OpenAIService doesn't have analyzeContent yet, so we'll create a simple implementation
        // Or we can add it to OpenAIService
        return {
            themes: ['General content'],
            tone: 'To be analyzed',
            visualOpportunities: ['Various visual scenes'],
            pacingSuggestions: 'Standard pacing'
        };
    }
    
    async extractAssets(content: string, audioAnalysis?: any, progressManager?: any, parentTaskId?: string): Promise<any[]> {
        return this.openaiService.extractAssets(content, audioAnalysis, progressManager, parentTaskId);
    }

    async selectBestVisualStyle(transcription: string): Promise<string> {
        return this.openaiService.selectBestVisualStyle(transcription);
    }
}

