/**
 * IDE AI Provider
 * Uses VS Code Language Model API to integrate with Cursor AI, GitHub Copilot, etc.
 */

import * as vscode from 'vscode';
import { ITextAIProvider } from './aiService';
import { logger } from '../utils/logger';

export class IDEAIProvider implements ITextAIProvider {
    /**
     * Helper method to get the best available model, preferring Auto mode
     */
    private async getModel(): Promise<any> {
        const lm = (vscode as any).lm;
        
        // Try to select Auto mode first (Cursor's intelligent model selection)
        let models = await lm.selectChatModels({ 
            vendor: 'copilot', 
            family: 'auto' 
        });
        
        if (models.length === 0) {
            // Fallback to any available model if Auto mode not found
            models = await lm.selectChatModels();
            if (models.length === 0) {
                throw new Error('No IDE AI model available');
            }
        }
        
        return models[0];
    }

    async isAvailable(): Promise<boolean> {
        try {
            // Check if Language Model API is available
            // The API might be at (vscode as any).lm in different versions
            const lm = (vscode as any).lm;
            if (!lm || !lm.selectChatModels) {
                logger.info('VS Code Language Model API not available');
                return false;
            }
            
            const model = await this.getModel();
            const available = !!model;
            
            if (available) {
                logger.info(`✅ IDE AI available: ${model.id} (${model.vendor}/${model.family}) ${model.family === 'auto' ? '[AUTO MODE]' : ''}`);
            } else {
                logger.info('No IDE AI models available');
            }
            
            return available;
        } catch (error) {
            logger.warn('IDE AI check failed:', error);
            return false;
        }
    }
    
    async generateDirectorScript(transcription: string, audioAnalysis?: any, assetLibrary?: any[]): Promise<any> {
        const model = await this.getModel();
        logger.info(`Using IDE AI model: ${model.id} (${model.vendor}/${model.family}) ${model.family === 'auto' ? '[AUTO MODE]' : ''}`);
        
        const prompt = this.buildScriptPrompt(transcription, audioAnalysis, assetLibrary);
        
        const LanguageModelChatMessage = (vscode as any).LanguageModelChatMessage;
        const messages = [LanguageModelChatMessage.User(prompt)];
        const cancellationToken = new vscode.CancellationTokenSource().token;
        
        const response = await model.sendRequest(messages, {}, cancellationToken);
        
        // Stream and collect response
        let fullResponse = '';
        for await (const chunk of response.text) {
            fullResponse += chunk;
        }
        
        logger.info('IDE AI response received, parsing JSON...');
        
        // Parse JSON response
        const json = this.extractJSON(fullResponse);
        return JSON.parse(json);
    }
    
    async getRawText(prompt: string): Promise<string> {
        const model = await this.getModel();
        logger.info(`Using IDE AI for research text generation: ${model.id} ${model.family === 'auto' ? '[AUTO MODE]' : ''}`);
        
        const LanguageModelChatMessage = (vscode as any).LanguageModelChatMessage;
        const messages = [LanguageModelChatMessage.User(prompt)];
        const cancellationToken = new vscode.CancellationTokenSource().token;
        
        try {
            const response = await model.sendRequest(messages, {}, cancellationToken);
            
            // Stream and collect response
            let fullResponse = '';
            for await (const chunk of response.text) {
                fullResponse += chunk;
            }
            
            logger.info(`Research text generated: ${fullResponse.length} characters`);
            return fullResponse;
        } catch (error) {
            logger.error('IDE AI raw text generation failed:', error);
            throw error;
        }
    }

    async analyzeContent(content: string): Promise<any> {
        const model = await this.getModel();
        logger.info(`Using IDE AI for content analysis: ${model.id} ${model.family === 'auto' ? '[AUTO MODE]' : ''}`);
        
        const prompt = `Analyze this content for creating a video story. Identify:
- Key themes and messages
- Emotional tone
- Visual opportunities
- Pacing suggestions

Content:
${content}

Return analysis as JSON with the following structure:
{
  "themes": ["theme1", "theme2"],
  "tone": "emotional tone description",
  "visualOpportunities": ["visual1", "visual2"],
  "pacingSuggestions": "pacing recommendations"
}

Return ONLY valid JSON, no markdown or additional text.`;
        
        const LanguageModelChatMessage = (vscode as any).LanguageModelChatMessage;
        const messages = [LanguageModelChatMessage.User(prompt)];
        const cancellationToken = new vscode.CancellationTokenSource().token;
        
        const response = await model.sendRequest(messages, {}, cancellationToken);
        
        let fullResponse = '';
        for await (const chunk of response.text) {
            fullResponse += chunk;
        }
        
        const json = this.extractJSON(fullResponse);
        return JSON.parse(json);
    }
    
    async extractAssets(content: string, audioAnalysis?: any, progressManager?: any, parentTaskId?: string): Promise<any[]> {
        const model = await this.getModel();
        logger.info(`Using IDE AI for asset extraction: ${model.id} ${model.family === 'auto' ? '[AUTO MODE]' : ''}`);
        
        // Step 1: Analyzing content
        const analyzeTaskId = parentTaskId ? `${parentTaskId}_analyze` : null;
        if (progressManager && parentTaskId && analyzeTaskId) {
            progressManager.startTask(analyzeTaskId, '$(search) Analyze Content', parentTaskId);
        }
        
        const prompt = `You are an expert at analyzing content and identifying reusable visual assets for video production.

Analyze the provided content and identify all unique visual assets that should be tracked for consistency across scenes.

Extract and categorize assets into these types:
1. CHARACTERS - People, beings, entities with distinct appearances
2. LOCATIONS - Places, settings, environments
3. ITEMS - Props, objects, significant items
4. VEHICLES - Transportation, vessels
5. ANIMALS - Creatures, beasts

For each asset provide:
- name: Descriptive, searchable name
- type: One of: character, location, item, vehicle, animal, other
- description: Brief overview (1-2 sentences)
- visual_attributes: Detailed attributes for visual consistency
  - appearance: Physical description
  - colors: Dominant colors
  - distinguishing_features: Key identifying features
  - typical_lighting: Lighting that suits this asset
  - mood: Typical emotional tone
- references: Array of related asset names (if any)
- tags: Array of relevant tags for categorization
- indexed_in: Array of sections/stories this appears in

Content:
${content}

${audioAnalysis ? `\nAudio Analysis Context:\n${JSON.stringify(audioAnalysis, null, 2)}` : ''}

Return a JSON object with structure: {"assets": [...]}
Return ONLY valid JSON, no markdown or additional text.`;

        const LanguageModelChatMessage = (vscode as any).LanguageModelChatMessage;
        const messages = [LanguageModelChatMessage.User(prompt)];
        const cancellationToken = new vscode.CancellationTokenSource().token;
        
        // Complete step 1
        if (progressManager && analyzeTaskId) {
            progressManager.completeTask(analyzeTaskId); // Task name is sufficient
        }
        
        // Step 2: Calling AI
        const aiCallTaskId = parentTaskId ? `${parentTaskId}_ai_call` : null;
        if (progressManager && parentTaskId && aiCallTaskId) {
            progressManager.startTask(aiCallTaskId, '$(robot) Call IDE AI to Identify Assets', parentTaskId);
        }
        
        const response = await model.sendRequest(messages, {}, cancellationToken);
        
        let fullResponse = '';
        for await (const chunk of response.text) {
            fullResponse += chunk;
        }
        
        // Complete step 2
        if (progressManager && aiCallTaskId) {
            progressManager.completeTask(aiCallTaskId); // Task name is sufficient
        }
        
        // Step 3: Processing response
        const processTaskId = parentTaskId ? `${parentTaskId}_process` : null;
        if (progressManager && parentTaskId && processTaskId) {
            progressManager.startTask(processTaskId, '$(json) Process AI Response', parentTaskId);
        }
        
        const json = this.extractJSON(fullResponse);
        const result = JSON.parse(json);
        const assets = result.assets || [];
        
        // Complete step 3
        if (progressManager && processTaskId) {
            progressManager.completeTask(processTaskId); // Task name is sufficient
        }
        
        return assets;
    }
    
    private buildScriptPrompt(transcription: string, audioAnalysis?: any, assetLibrary?: any[]): string {
        let prompt = `You are a professional video director creating a shot-by-shot script for AI video generation.

**Transcription:**
${transcription}

${audioAnalysis ? `**Audio Analysis:**
${JSON.stringify(audioAnalysis, null, 2)}
` : ''}

🎬 CRITICAL: PROTAGONIST & POV IDENTIFICATION
==============================================
BEFORE creating segments, identify the PROTAGONIST (the "star of the show"):

⚠️ RULES:
1. If transcription uses "I/me/my" → The NARRATOR is the protagonist (camera follows THEIR perspective)
2. If transcription uses "he/she/they" → The person whose journey we follow is the protagonist
3. ALL visual prompts must be written from the protagonist's perspective

Example WRONG: "He sees the figure approaching" (when "I" is the narrator)
Example RIGHT: "I see the figure approaching, my weathered hands trembling" (first-person POV)

➤ Every segment's visualPrompt MUST center on the PROTAGONIST's experience and perspective
➤ The camera is the protagonist's eyes - we see what THEY see, feel what THEY feel
`;

        if (assetLibrary && assetLibrary.length > 0) {
            // Build explicit [[tag]] mapping from actual assets
            const tagMappings: string[] = [];
            for (const asset of assetLibrary) {
                const assetName = asset.name || 'Unknown';
                const assetId = asset.id || 'unknown_id';
                const tag = '[[' + assetName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + ']';
                tagMappings.push(`  ${tag.padEnd(25)} → ${assetId}`);
            }
            
            prompt += `\n**🎨 AVAILABLE ASSETS IN THE LIBRARY:**
${JSON.stringify(assetLibrary, null, 2)}

**🏷️  USE THESE EXACT [[tags]] IN YOUR PROMPTS:**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${tagMappings.join('\n')}

↑ COPY THESE @TAGS EXACTLY INTO visualPrompt, THEN list the corresponding asset IDs in usedAssets array!

**🔑 CRITICAL: HOW TO USE ASSETS (MANDATORY):**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ **RULE #1: Use [[tags]] from the list above - NEVER copy asset descriptions**
❌ WRONG: "The Narrator (THIS IS THE PROTAGONIST - camera POV character. An unnamed individual..."
✅ RIGHT: "[[narrator]] stands alone on the rocky shore"

⚠️ **RULE #2: Populate usedAssets array with asset IDs (right side of → above)**
Example: If you write "[[narrator]]" in visualPrompt → add "character_narrator" to usedAssets

⚠️ **RULE #3: Keep visualPrompt focused on ACTION and SCENE**
Don't repeat descriptions! Just use [[tags]] and describe what happens:
✅ "[[narrator]] stands on the edge of [[island]], gazing at the stormy sea. Wind whips his robes."
❌ "The Narrator (elderly man with weathered skin...) stands on the Island (rocky terrain...)"

⚠️ **RULE #4: List protagonist FIRST in usedAssets array**

⚠️ **RULE #5: visualPrompt must be ≤ 420 chars; no long parenthetical text**

**COMPLETE EXAMPLE:**
{
  "visualPrompt": "[[narrator]] stands alone on [[island]]'s rocky shore, weathered face turned toward the horizon. The [[seven_lamps]] suddenly ignite behind him, casting golden light across the gray stones. [[divine_figure]] materializes in brilliant radiance, eyes blazing.",
  "usedAssets": ["character_narrator", "location_island", "item_seven_lamps", "character_divine_figure"]
}
`;
        }

        prompt += `\n**Task:** Create a detailed director's script with the following JSON structure:`;
        
        // Build the JSON template based on whether assets are available
        let jsonTemplate = `

{
  "segments": [
    {
      "id": "segment_1",
      "text": "The lyrics or narration for this segment",
      "visualPrompt": "Detailed scene description using [[tags]] ONLY (≤ 420 chars). Example: '[[protagonist]] stands on [[location]], wind whipping their cloak as they gaze toward the horizon where [[character_name]] appears in brilliant light.'",
      "duration": 8,
      "startTime": 0,
      "cameraWork": "Camera movement and angles (e.g., 'slow pan right', 'close-up', 'tracking shot')",
      "lighting": "Lighting style (e.g., 'golden hour', 'dramatic chiaroscuro', 'soft diffused')",
      "mood": "Emotional tone (e.g., 'melancholic', 'energetic', 'contemplative')",
      "status": "pending",
      "usedAssets": `;
      
        if (assetLibrary && assetLibrary.length > 0) {
            jsonTemplate += `["character_id_1", "location_id_1", "item_id_1"]  ← MANDATORY! Use actual asset IDs from the library above`;
        } else {
            jsonTemplate += `[]`;
        }
        
        jsonTemplate += `
    }
  ]
}

**Requirements:**
1. Break the content into segments of 8-12 seconds each
2. Each segment must have a highly detailed visualPrompt suitable for Sora AI video generation
3. Visual prompts should be cinematic and descriptive`;

        if (assetLibrary && assetLibrary.length > 0) {
            jsonTemplate += ` using [[tags]] (NEVER copy full asset definitions!)`;
        }

        jsonTemplate += `
4. Ensure continuity between segments
5. Time segments to match the transcription pacing
6. Include specific camera work, lighting, and mood for each segment`;

        if (assetLibrary && assetLibrary.length > 0) {
            jsonTemplate += `
7. **MANDATORY:** Every segment MUST have "usedAssets" array with actual asset IDs from the library
8. **MANDATORY:** Use [[tags]] in visualPrompt for any character/location/item (e.g., "[[narrator]]", "[[island]]")`;
        }

        jsonTemplate += `

**CRITICAL - FIRST-PERSON PROTAGONIST FOCUS:**
🎯 **For FIRST-PERSON narratives ("I", "me", "my"):**
   - The narrator IS the protagonist
   - The SUBJECT of actions in visualPrompt must match the SUBJECT in lyrics
   - Example: Lyrics say "I stand" → Visual: "[protagonist asset] stands"
   - The camera follows the protagonist's perspective throughout

🎯 **Camera & POV:**
   - Show protagonist's reactions, face, body language  
   - Use over-shoulder shots showing what protagonist sees
   - Include first-person POV shots when appropriate

**IMPORTANT:** Return ONLY valid JSON. No markdown code blocks, no explanations, just the JSON object.`;

        return prompt + jsonTemplate;
    }
    
    private extractJSON(text: string): string {
        // Try to extract JSON from markdown code blocks
        const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
            return codeBlockMatch[1].trim();
        }
        
        // Try to find JSON object directly
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return jsonMatch[0];
        }
        
        // Return as-is and hope it's valid JSON
        return text.trim();
    }

    async selectBestVisualStyle(transcription: string): Promise<string> {
        try {
            const model = await this.getModel();
            logger.info(`Using IDE AI for visual style selection: ${model.id} ${model.family === 'auto' ? '[AUTO MODE]' : ''}`);
            const prompt = this.buildVisualStylePrompt(transcription);
            
            const response = await model.sendRequest([
                { role: 'user', content: prompt }
            ], {
                temperature: 0.3,
                maxTokens: 50
            });

            const style = response.text.trim().toLowerCase();
            
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
                logger.warn(`Invalid style returned: ${style}, defaulting to naturalistic`);
                return 'naturalistic';
            }
        } catch (error) {
            logger.error('Failed to select visual style:', error);
            return 'naturalistic'; // Default fallback
        }
    }

    private buildVisualStylePrompt(transcription: string): string {
        return `Based on this content, what visual style would work best for video generation?

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
    }

    /**
     * Optimize a verbose prompt for Sora following best practices.
     * Preserves [[tags]], condenses to maxChars, uses cinematic language.
     */
    async optimizeSoraPrompt(
        rawPrompt: string, 
        maxChars: number, 
        context?: { tagDefinitions?: string; style?: string }
    ): Promise<string> {
        const model = await this.getModel();
        logger.info(`Optimizing Sora prompt using IDE AI: ${model.id} ${model.family === 'auto' ? '[AUTO MODE]' : ''}`);
        
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

🎬 CHARACTER PRIORITIZATION (CRITICAL):
Structure your optimized prompt in this EXACT order:
1. **STORYTELLER/PROTAGONIST**: Lead with detailed character description (age, appearance, clothing, distinctive features)
2. **SUPPORTING CHARACTERS**: Include other characters with their key visual details
3. **ENVIRONMENT/SETTING**: Describe the location and atmosphere
4. **BEHAVIOR/ACTION**: What characters are doing, their movements, expressions
5. **CAMERA/LIGHTING**: Cinematic techniques and mood

PRIORITIZE character descriptions above all else. The protagonist should be described in detail first, then supporting characters, then environment, then actions.

CRITICAL: Output must be a complete, standalone prompt with NO [[tags]]. All entities fully described using ONLY the visual details from TAGS section.

OUTPUT: Return ONLY the final optimized prompt text. No preamble, no markdown, no explanations.`;

        const userPrompt = `INPUT PROMPT:\n${rawPrompt}\n\nOPTIMIZED PROMPT (max ${maxChars} chars):`;
        
        const LanguageModelChatMessage = (vscode as any).LanguageModelChatMessage;
        const messages = [
            LanguageModelChatMessage.User(`${systemPrompt}\n\n${userPrompt}`)
        ];
        const cancellationToken = new vscode.CancellationTokenSource().token;
        
        try {
            const response = await model.sendRequest(messages, {}, cancellationToken);
            
            let optimized = '';
            for await (const chunk of response.text) {
                optimized += chunk;
            }
            
            // Clean up the output
            optimized = optimized.trim()
                .replace(/^["']|["']$/g, '')  // Remove surrounding quotes
                .replace(/\n/g, ' ')           // Remove newlines
                .replace(/\s+/g, ' ')          // Collapse multiple spaces
                .trim();
            
            // Validate tag integrity and length
            const tagPattern = /\[\[[^\]]+\]\]/g;
            const inputTags = (rawPrompt.match(tagPattern) || []);
            const outputTags = (optimized.match(tagPattern) || []);
            
            // Ensure all input tags are present
            for (const tag of inputTags) {
                if (!optimized.includes(tag)) {
                    logger.warn(`Tag ${tag} missing from optimized prompt, this should not happen`);
                }
            }
            
            // Check length and ensure no partial tags at end
            if (optimized.length > maxChars) {
                logger.warn(`Optimized prompt ${optimized.length} chars exceeds limit ${maxChars}, truncating safely`);
                optimized = this.truncateSafely(optimized, maxChars);
            }
            
            logger.info(`Prompt optimization: ${rawPrompt.length} → ${optimized.length} chars`);
            logger.info(`Optimized prompt: ${optimized}`);
            
            return optimized;
        } catch (error) {
            logger.error('IDE AI prompt optimization failed:', error);
            throw error;
        }
    }

    /**
     * Safely truncate prompt to maxChars without cutting [[tags]]
     */
    private truncateSafely(prompt: string, maxChars: number): string {
        if (prompt.length <= maxChars) {
            return prompt;
        }
        
        // Find the last complete word before maxChars that doesn't cut a tag
        let cutoff = maxChars;
        
        // Ensure we're not inside a [[tag]]
        while (cutoff > 0) {
            const beforeCutoff = prompt.substring(0, cutoff);
            const afterCutoff = prompt.substring(cutoff);
            
            // Count opening and closing brackets before cutoff
            const openBrackets = (beforeCutoff.match(/\[\[/g) || []).length;
            const closeBrackets = (beforeCutoff.match(/\]\]/g) || []).length;
            
            // If brackets are balanced, we're not cutting a tag
            if (openBrackets === closeBrackets) {
                // Try to cut at a word boundary
                const lastSpace = beforeCutoff.lastIndexOf(' ');
                if (lastSpace > maxChars * 0.7) {
                    return beforeCutoff.substring(0, lastSpace).trim();
                }
                return beforeCutoff.trim();
            }
            
            // Move back to avoid cutting tag
            cutoff--;
        }
        
        // Fallback: return first maxChars (shouldn't reach here)
        return prompt.substring(0, maxChars);
    }
}

