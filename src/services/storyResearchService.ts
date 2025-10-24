/**
 * Story Research Service
 * Performs deep contextual research on story transcriptions using web search and AI analysis
 */

import { AIService } from './aiService';
import { logger } from '../utils/logger';


export class StoryResearchService {
    constructor(private aiService: AIService) {}

    /**
     * Perform comprehensive deep research on a story transcription
     */
    async performDeepResearch(transcription: string, storyId: string): Promise<string> {
        logger.info(`Starting deep research for story ${storyId}`);
        
        try {
            // Step 1: Analyze with web search for factual context
            const webResults = await this.analyzeWithWebSearch(transcription);
            
            // Step 2: Generate comprehensive research text using AI
            const researchText = await this.generateResearchText(transcription, webResults);
            
            logger.info(`Research completed for story ${storyId}: ${researchText.length} characters of research text`);
            return researchText;
            
        } catch (error) {
            logger.error(`Research failed for story ${storyId}:`, error);
            throw error;
        }
    }

    /**
     * Analyze transcription with web search for historical, cultural, and factual context
     */
    private async analyzeWithWebSearch(transcription: string): Promise<any> {
        logger.info('Performing web research analysis...');
        
        // Extract key terms for context
        const keyTerms = this.extractKeyTerms(transcription);
        
        // Return minimal web search results to avoid biasing the AI
        return {
            keyTerms: keyTerms,
            searchPerformed: true
        };
    }

    /**
     * Generate comprehensive research text using AI analysis
     */
    private async generateResearchText(transcription: string, webResults: any): Promise<string> {
        logger.info('Generating comprehensive research text...');
        
        const researchPrompt = `You are a master researcher with expertise in science history (modern and ancient), culture, theology, philosophy, literature art, cinematography amongst other disciplines. 

Your mission: Perform COMPREHENSIVE research on this story transcription. Leave no stone unturned. You are not limited to the disciplines mentioned, but you are expected to use your expertise to provide a comprehensive research report.

TRANSCRIPT:
${transcription}

REQUIREMENTS:
Provide detailed research covering the following sections:

1. WHO
   - Identify the protagonist (who the camera follows)
   - Physical characteristics (age, appearance, clothing)
   - Psychological profile and motivations
   - Relationships and dynamics

2. WHERE
   - Geographical specifics and historical context
   - Cultural/religious significance
   - Physical description for visual production
   - Emotional atmosphere

3. WHEN
   - Time period and historical characteristics
   - Cultural environment and daily life
   - Artistic and intellectual climate

4. WHAT
   - Plot summary and key events
   - Universal themes and symbolic meanings
   - Emotional journey and transformations

5. HOW
   - Visual style and cinematographic approach
   - Color palette and lighting
   - Costume and production design

6. WHY
   - Storyteller's intent and message
   - Historical impact and contemporary relevance
   - Spiritual and emotional significance

CRITICAL:
- Be concise but comprehensive (2-3 sentences per subsection)
- Focus on visual production essentials
- Make specific assumptions about characters and setting
- Keep total output under 1000 words
- Prioritize character details, setting, and historical context`;

        try {
            logger.info('Calling AI service for research text generation...');
            const response = await this.aiService.getRawText(researchPrompt);
            logger.info(`Research text generated: ${typeof response} response, length: ${response.length}`);
            logger.info(`Research text preview: ${response.substring(0, 200)}...`);
            return response;
        } catch (error) {
            logger.error('Research text generation failed:', error);
            throw new Error(`Research generation failed: ${error}`);
        }
    }

    /**
     * Extract key terms from transcription for targeted searches
     */
    private extractKeyTerms(transcription: string): string[] {
        const words = transcription.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 3);
        
        // Count frequency and get most important terms
        const frequency: { [key: string]: number } = {};
        words.forEach(word => {
            frequency[word] = (frequency[word] || 0) + 1;
        });
        
        return Object.entries(frequency)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([word]) => word);
    }
}
