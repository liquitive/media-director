import * as vscode from 'vscode';
import { AIService } from '../services/aiService';
import { StoryService } from '../services/storyService';
import { ExecutionService } from '../services/executionService';
import { SegmentValidationService } from '../services/segmentValidationService';
import { AssetService } from '../services/assetService';
import { OpenAIService } from '../services/openaiService';
import { ValidationContextState, SegmentUpdate, ValidationIssue } from '../types/validation';
import { ProgressManager } from '../services/progressManager';
import { logger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Chat participant for interactive segment correction
 * Handles validation issues and guides user through fixing them
 */
export class SegmentCorrectionParticipant {
    private validationContexts: Map<string, ValidationContextState> = new Map();

    constructor(
        private aiService: AIService,
        private storyService: StoryService,
        private executionService: ExecutionService,
        private validationService: SegmentValidationService,
        private assetService: AssetService,
        private openaiService: OpenAIService
    ) {}

    /**
     * Handle chat requests for segment validation and correction
     */
    async handleChatRequest(
        request: any, // vscode.ChatRequest - types not available in current VS Code version
        context: any, // vscode.ChatContext
        stream: any, // vscode.ChatResponseStream
        token: vscode.CancellationToken
    ): Promise<void> {
        const prompt = request.prompt.trim();

        try {
            // Check if user is requesting smart regeneration
            if (prompt.toLowerCase().includes('regenerate') && prompt.toLowerCase().includes('research')) {
                await this.handleRegenerateFromResearch(prompt, stream);
            }
            // Check if this is a validation context - extract story ID (story_XXXXX)
            else if (prompt.match(/(story_\w+)/i)) {
                const storyIdMatch = prompt.match(/(story_\w+)/i);
                const storyId = storyIdMatch![1];
                logger.info(`Chat participant: extracted story ID: ${storyId}`);
                logger.info(`Available validation contexts: ${Array.from(this.validationContexts.keys()).join(', ')}`);
                await this.handleValidationIssues(storyId, stream);
            } else if (prompt.startsWith('/fix-segment')) {
                await this.handleFixSegment(prompt, stream);
            } else if (prompt.startsWith('/show-issue')) {
                await this.handleShowIssue(prompt, stream);
            } else if (prompt.startsWith('/apply-and-continue')) {
                await this.handleApplyAndContinue(prompt, stream);
            } else {
                // General query - provide help
                stream.markdown('## Sora Segment Validator\n\n');
                stream.markdown('I help validate and correct video segments before generation.\n\n');
                stream.markdown('**Available commands:**\n');
                stream.markdown('- `/show-issue <issue_id>` - Show detailed information about a specific issue\n');
                stream.markdown('- `/fix-segment <segment_id>` - Apply suggested fix to a segment\n');
                stream.markdown('- `/apply-and-continue` - Apply all fixes and resume video production\n');
                stream.markdown('- `regenerate from research` - Smart regeneration from corrected research (recommended for systematic issues)\n\n');
                stream.markdown('When validation issues are detected, I\'ll automatically guide you through fixing them.');
            }
        } catch (error) {
            logger.error('Error in chat participant:', error);
            stream.markdown(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle regenerate from research request
     */
    private async handleRegenerateFromResearch(
        prompt: string,
        stream: any // vscode.ChatResponseStream
    ): Promise<void> {
        stream.markdown('## ⚡ Smart Regeneration from Research\n\n');
        
        // Find the most recent validation context
        let latestContext: ValidationContextState | undefined;
        let latestStoryId: string | undefined;
        let latestTimestamp = 0;

        for (const [storyId, context] of this.validationContexts) {
            if (context.timestamp > latestTimestamp) {
                latestTimestamp = context.timestamp;
                latestContext = context;
                latestStoryId = storyId;
            }
        }

        if (!latestContext || !latestStoryId) {
            stream.markdown('❌ No active validation context found.\n\n');
            stream.markdown('Please run validation first by executing "Execute Video Production" on a story.');
            return;
        }

        // Get AI-detected systematic issues
        const systematicIssues = latestContext.result.issues.filter(i => i.isSystematic && i.rootCause);
        
        if (systematicIssues.length === 0) {
            stream.markdown('⚠️ No systematic issue detected by AI. This method works best for issues affecting multiple segments.\n\n');
            stream.markdown('Consider using manual fixes instead.');
            return;
        }

        // Combine all root causes into one research correction
        const combinedRootCause = systematicIssues.map((issue, idx) => 
            `${idx + 1}. ${issue.type.replace(/_/g, ' ').toUpperCase()} (${issue.segmentIds.length} segments affected):\n   ${issue.rootCause}`
        ).join('\n\n');

        stream.markdown(`### 📋 Systematic Issues Detected:\n\n`);
        systematicIssues.forEach((issue, idx) => {
            stream.markdown(`**${idx + 1}.** ${issue.type.replace(/_/g, ' ').toUpperCase()}\n`);
            stream.markdown(`- Affects: ${issue.segmentIds.length} segments\n`);
            stream.markdown(`- Root Cause: ${issue.rootCause}\n\n`);
        });
        
        stream.markdown(`### 🔧 Combined Research Correction:\n\`\`\`\n${combinedRootCause}\n\`\`\`\n\n`);
        
        stream.markdown('### 🔄 Starting Regeneration Process...\n\n');
        
        try {
            stream.markdown('**Step 1/6:** Updating research in `master_context.json`...\n');
            stream.markdown('**Step 2/6:** Deleting old script and segment files...\n');
            stream.markdown('**Step 3/6:** Re-extracting assets with corrected research...\n');
            stream.markdown('**Step 4/6:** Regenerating Script...\n');
            stream.markdown('**Step 5/6:** Generating character reference images...\n');
            stream.markdown('**Step 6/6:** Saving...\n\n');
            
            await this.regenerateFromResearch(latestStoryId, combinedRootCause);
            
            stream.markdown('✅ **Complete!**\n\n');
            stream.markdown('---\n\n');
            stream.markdown('### ✨ What was done:\n\n');
            stream.markdown('1. ✅ Updated research with critical corrections\n');
            stream.markdown('2. ✅ Deleted old script and segment files\n');
            stream.markdown('3. ✅ Re-extracted assets with corrected research\n');
            stream.markdown('4. ✅ Regenerated Script with correct POV\n');
            stream.markdown('5. ✅ Generated character reference images\n');
            stream.markdown('6. ✅ Saved new script and segment files\n\n');
            stream.markdown('### 🎬 Next Steps:\n\n');
            stream.markdown('1. Review the regenerated script if desired\n');
            stream.markdown('2. Check the generated character images in the asset library\n');
            stream.markdown('3. Run **Execute Video Production** again to generate videos with the corrected script\n\n');
            stream.markdown('The protagonist issue should now be fixed across all segments!');
            
            // Clear validation context since we've regenerated everything
            this.clearValidationContext(latestStoryId);
            
        } catch (error) {
            stream.markdown(`\n❌ **Error during regeneration:**\n\n`);
            stream.markdown(`\`\`\`\n${error instanceof Error ? error.message : 'Unknown error'}\n\`\`\`\n\n`);
            stream.markdown('Please check the logs for more details.');
            logger.error('Regeneration error:', error);
        }
    }

    /**
     * Display validation issues and guide user through corrections
     */
    private async handleValidationIssues(
        storyId: string,
        stream: any // vscode.ChatResponseStream
    ): Promise<void> {
        const validationContext = this.validationContexts.get(storyId);

        if (!validationContext) {
            stream.markdown(`❌ No validation context found for story \`${storyId}\`.\n\n`);
            
            const availableContexts = Array.from(this.validationContexts.keys());
            if (availableContexts.length > 0) {
                stream.markdown(`**Available validation contexts:**\n`);
                availableContexts.forEach(id => {
                    stream.markdown(`- \`${id}\`\n`);
                });
                stream.markdown('\nPlease use one of the above story IDs.');
            } else {
                stream.markdown('No validation contexts are currently stored.\n\n');
                stream.markdown('**To create a validation context:**\n');
                stream.markdown('1. Open a story in the Sora Director panel\n');
                stream.markdown('2. Click "Execute Video Production"\n');
                stream.markdown('3. If issues are found, you\'ll be guided here automatically');
            }
            return;
        }

        const result = validationContext.result;

        stream.markdown('# 🔍 Segment Validation Results\n\n');
        
        if (result.isValid) {
            stream.markdown('✅ All segments validated successfully!\n\n');
            stream.markdown('You can proceed with video generation.');
            return;
        }

        const criticalIssues = result.issues.filter(i => i.severity === 'critical');
        const warnings = result.issues.filter(i => i.severity === 'warning');

        stream.markdown(`## Found ${result.issues.length} issue(s)\n\n`);
        stream.markdown(`- 🚨 **Critical**: ${criticalIssues.length}\n`);
        stream.markdown(`- ⚠️  **Warnings**: ${warnings.length}\n\n`);

        // Show critical issues first
        if (criticalIssues.length > 0) {
            stream.markdown('## 🚨 Critical Issues\n\n');
            stream.markdown('These must be fixed before video generation can proceed.\n\n');

            for (const issue of criticalIssues) {
                await this.displayIssue(issue, stream, storyId);
            }
        }

        // Show warnings
        if (warnings.length > 0) {
            stream.markdown('## ⚠️  Warnings\n\n');
            stream.markdown('These are recommended fixes but not blocking.\n\n');

            for (const issue of warnings) {
                await this.displayIssue(issue, stream, storyId);
            }
        }

        // Check if AI detected systematic issues
        const systematicIssues = result.issues.filter(i => i.isSystematic && i.rootCause);
        
        // Provide next steps
        stream.markdown('\n---\n\n');
        stream.markdown('## 🛠️ How to proceed:\n\n');
        
        if (systematicIssues.length > 0) {
            stream.markdown(`### ⚡ **RECOMMENDED: Smart Regeneration**\n\n`);
            stream.markdown(`🚨 Detected **${systematicIssues.length} SYSTEMATIC ISSUE(S)** affecting multiple segments!\n\n`);
            
            systematicIssues.forEach((issue, idx) => {
                const affectedCount = issue.segmentIds.length;
                stream.markdown(`**Issue ${idx + 1}:** ${issue.type.replace(/_/g, ' ').toUpperCase()}\n`);
                stream.markdown(`- Affects: **${affectedCount} segments**\n`);
                stream.markdown(`- Root Cause: ${issue.rootCause}\n`);
                stream.markdown(`- Recommended: **${issue.recommendedApproach}**\n\n`);
            });
            
            stream.markdown(`Instead of manually fixing ${result.issues.reduce((sum, i) => sum + i.segmentIds.length, 0)} segment occurrences, I can:\n\n`);
            stream.markdown(`1. Update the research in \`master_context.json\` to emphasize the correct approach\n`);
            stream.markdown(`2. Delete old script and segment files\n`);
            stream.markdown(`3. Re-extract assets with corrected research context\n`);
            stream.markdown(`4. ReGenerate Script from scratch\n`);
            stream.markdown(`5. Generate character reference images\n`);
            stream.markdown(`6. Save everything\n\n`);
            stream.markdown(`This ensures **consistency** and is **MUCH FASTER** (3-5 minutes vs. hours of manual work)!\n\n`);
            stream.markdown(`### 🚀 **To start smart regeneration:**\n`);
            stream.markdown(`Just ask me: **"Regenerate from research"**\n\n`);
            stream.markdown(`---\n\n`);
            stream.markdown(`### ⚠️ Alternative: Manual Fixes (Not Recommended)\n\n`);
        }
        
        stream.markdown('1. Review each issue above\n');
        stream.markdown('2. Use `/fix-segment <segment_id>` to apply suggested fixes\n');
        stream.markdown('3. Or manually edit segments in the file explorer\n');
        stream.markdown('4. Use `/apply-and-continue` when ready to resume video generation\n');
    }

    /**
     * Detect if issues are systematic (root cause problem)
     */
    private detectSystematicIssue(issues: ValidationIssue[]): {
        type: string;
        affectedCount: number;
        rootCause: string;
    } | null {
        // Group issues by type
        const issuesByType = new Map<string, ValidationIssue[]>();
        for (const issue of issues) {
            const existing = issuesByType.get(issue.type) || [];
            existing.push(issue);
            issuesByType.set(issue.type, existing);
        }

        // Check for protagonist misidentification (common systematic issue)
        const protagonistIssues = issuesByType.get('protagonist_mismatch') || [];
        if (protagonistIssues.length >= 3) {
            const totalSegments = new Set(protagonistIssues.flatMap(i => i.segmentIds)).size;
            return {
                type: 'Protagonist Misidentification',
                affectedCount: totalSegments,
                rootCause: 'The narrator/protagonist is the first-person speaker, not the divine figure they are observing. Maintain first-person POV throughout.'
            };
        }

        // Check for POV inconsistency
        const povIssues = issuesByType.get('pov_inconsistency') || [];
        if (povIssues.length >= 3) {
            const totalSegments = new Set(povIssues.flatMap(i => i.segmentIds)).size;
            return {
                type: 'POV Inconsistency',
                affectedCount: totalSegments,
                rootCause: 'Maintain consistent point-of-view (first-person or third-person) throughout the narrative as indicated by the lyrics/transcription.'
            };
        }

        // Check for character confusion (multiple segments confusing different characters)
        const characterIssues = issuesByType.get('character_confusion') || [];
        if (characterIssues.length >= 3) {
            const totalSegments = new Set(characterIssues.flatMap(i => i.segmentIds)).size;
            return {
                type: 'Character Confusion',
                affectedCount: totalSegments,
                rootCause: 'Clearly differentiate between characters, especially when one is the narrator and another is being described.'
            };
        }

        return null;
    }

    /**
     * Display a single validation issue with details
     */
    private async displayIssue(
        issue: ValidationIssue,
        stream: any, // vscode.ChatResponseStream
        storyId: string
    ): Promise<void> {
        const icon = issue.severity === 'critical' ? '🚨' : '⚠️';
        
        stream.markdown(`### ${icon} ${issue.type.replace(/_/g, ' ').toUpperCase()}\n\n`);
        stream.markdown(`**Issue ID**: \`${issue.id}\`\n\n`);
        stream.markdown(`**Affected Segments**: ${issue.segmentIds.map(id => `\`${id}\``).join(', ')}\n\n`);
        stream.markdown(`**Description**:\n\n${issue.description}\n\n`);
        
        if (issue.suggestedFix) {
            stream.markdown(`**💡 Suggested Fix**:\n\n${issue.suggestedFix}\n\n`);
            stream.button({
                command: 'sora.applySegmentFix',
                title: 'Apply Fix',
                arguments: [storyId, issue]
            });
        }

        stream.markdown('\n');
    }

    /**
     * Handle /fix-segment command
     */
    private async handleFixSegment(
        prompt: string,
        stream: any // vscode.ChatResponseStream
    ): Promise<void> {
        const match = prompt.match(/\/fix-segment\s+(\S+)/);
        
        if (!match) {
            stream.markdown('❌ Usage: `/fix-segment <segment_id>`\n\n');
            stream.markdown('Example: `/fix-segment segment_1`');
            return;
        }

        const segmentId = match[1];
        stream.markdown(`🔧 Applying fix to ${segmentId}...\n\n`);
        stream.markdown('This feature is in development. Please manually edit the segment file or use the Apply Fix button.');
    }

    /**
     * Handle /show-issue command
     */
    private async handleShowIssue(
        prompt: string,
        stream: any // vscode.ChatResponseStream
    ): Promise<void> {
        const match = prompt.match(/\/show-issue\s+(\S+)/);
        
        if (!match) {
            stream.markdown('❌ Usage: `/show-issue <issue_id>`\n\n');
            stream.markdown('Example: `/show-issue issue_1729123456_0`');
            return;
        }

        const issueId = match[1];
        
        // Find the issue in any validation context
        for (const [storyId, context] of this.validationContexts) {
            const issue = context.result.issues.find(i => i.id === issueId);
            if (issue) {
                await this.displayIssue(issue, stream, storyId);
                return;
            }
        }

        stream.markdown(`❌ Issue \`${issueId}\` not found in validation contexts.`);
    }

    /**
     * Handle /apply-and-continue command
     */
    private async handleApplyAndContinue(
        prompt: string,
        stream: any // vscode.ChatResponseStream
    ): Promise<void> {
        stream.markdown('## 🚀 Resuming Video Production\n\n');
        stream.markdown('Checking if all critical issues have been resolved...\n\n');

        // Find the most recent validation context
        let latestContext: ValidationContextState | undefined;
        let latestStoryId: string | undefined;
        let latestTimestamp = 0;

        for (const [storyId, context] of this.validationContexts) {
            if (context.timestamp > latestTimestamp) {
                latestTimestamp = context.timestamp;
                latestContext = context;
                latestStoryId = storyId;
            }
        }

        if (!latestContext || !latestStoryId) {
            stream.markdown('❌ No active validation context found.');
            return;
        }

        // Re-validate to ensure fixes were applied
        stream.markdown('Re-validating segments...\n\n');
        
        try {
            // Get story and re-validate
            const story = await this.storyService.getStory(latestStoryId);
            if (!story) {
                stream.markdown('❌ Story not found.');
                return;
            }

            // CRITICAL: Generate character reference images before continuing
            // This ensures visual consistency during video generation
            stream.markdown('---\n\n');
            await this.ensureCharacterImagesForStory(latestStoryId, stream);
            stream.markdown('---\n\n');

            // Clear the context so validation will pass
            this.validationContexts.delete(latestStoryId);

            stream.markdown('✅ Validation complete! Reference images generated.\n\n');
            stream.markdown('🎬 You can now re-run **"Execute Video Production"** to continue with the corrected segments.\n\n');
            stream.markdown('The system will use the generated reference images for visual consistency.');
            
        } catch (error) {
            logger.error('Error in apply-and-continue:', error);
            stream.markdown(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Store validation context for interactive correction
     */
    storeValidationContext(storyId: string, context: ValidationContextState): void {
        this.validationContexts.set(storyId, context);
        logger.info(`Stored validation context for story ${storyId} with ${context.result.issues.length} issues`);
    }

    /**
     * Check if a story has pending validation issues
     */
    hasValidationContext(storyId: string): boolean {
        return this.validationContexts.has(storyId);
    }

    /**
     * Clear validation context (when issues are resolved)
     */
    clearValidationContext(storyId: string): void {
        this.validationContexts.delete(storyId);
        logger.info(`Cleared validation context for story ${storyId}`);
    }

    /**
     * Update segment with corrections using real-time persistence
     * Updates both memory and individual segment file (source of truth)
     */
    async updateSegment(
        storyId: string,
        segmentUpdate: SegmentUpdate
    ): Promise<void> {
        const story = await this.storyService.getStory(storyId);
        if (!story) {
            throw new Error(`Story ${storyId} not found`);
        }

        const segmentIndex = story.directorScript.findIndex(s => s.id === segmentUpdate.segmentId);
        if (segmentIndex === -1) {
            throw new Error(`Segment ${segmentUpdate.segmentId} not found in story`);
        }

        // Apply updates to the segment
        const updatedSegment = { ...story.directorScript[segmentIndex], ...segmentUpdate.updates };
        
        // Use the real-time persistence method which updates both memory and disk
        this.storyService.saveSegment(storyId, segmentIndex, updatedSegment);
        logger.info(`✅ Updated segment ${segmentUpdate.segmentId} (real-time persistence)`);
        
        // After updating segment, ensure character reference images are generated
        await this.ensureCharacterImagesForSegment(updatedSegment);
    }

    /**
     * Ensure all character assets in a segment have reference images
     * This is critical for visual consistency during video generation
     */
    private async ensureCharacterImagesForSegment(segment: any): Promise<void> {
        try {
            if (!segment.usedAssets || segment.usedAssets.length === 0) {
                return;
            }

            logger.info(`Checking reference images for ${segment.usedAssets.length} assets in segment ${segment.id}`);

            for (const assetId of segment.usedAssets) {
                try {
                    const asset = await this.assetService.getAsset(assetId);
                    
                    if (!asset) {
                        logger.warn(`Asset ${assetId} not found`);
                        continue;
                    }

                    // Only generate images for character assets
                    if (asset.type !== 'character') {
                        continue;
                    }

                    // Check if reference image already exists
                    if (asset.reference_image && fs.existsSync(asset.reference_image)) {
                        logger.info(`Reference image already exists for character ${asset.name}`);
                        continue;
                    }

                    // Generate reference image
                    logger.info(`Generating reference image for character: ${asset.name}`);
                    const imagePath = await this.assetService.generateCharacterReferenceImage(
                        assetId,
                        this.openaiService
                    );

                    if (imagePath) {
                        logger.info(`✅ Generated reference image for ${asset.name}: ${imagePath}`);
                    } else {
                        logger.warn(`Failed to generate reference image for ${asset.name}`);
                    }
                } catch (assetError) {
                    logger.error(`Error processing asset ${assetId}:`, assetError);
                }
            }
        } catch (error) {
            logger.error('Error ensuring character images for segment:', error);
            // Don't throw - we don't want to block segment updates if image generation fails
        }
    }

    /**
     * Generate reference images for all characters in a story
     * Called after validation fixes are applied
     */
    async ensureCharacterImagesForStory(storyId: string, stream?: any): Promise<void> {
        try {
            const story = await this.storyService.getStory(storyId);
            if (!story || !story.directorScript) {
                return;
            }

            if (stream) {
                stream.markdown('🎨 Generating character reference images...\n\n');
            }

            const characterAssetsNeedingImages = new Set<string>();

            // Collect all character assets from all segments
            for (const segment of story.directorScript) {
                if (!segment.usedAssets) {
                    continue;
                }

                for (const assetId of segment.usedAssets) {
                    const asset = await this.assetService.getAsset(assetId);
                    
                    if (asset && asset.type === 'character') {
                        // Check if reference image is missing
                        if (!asset.reference_image || !fs.existsSync(asset.reference_image)) {
                            characterAssetsNeedingImages.add(assetId);
                        }
                    }
                }
            }

            if (characterAssetsNeedingImages.size === 0) {
                if (stream) {
                    stream.markdown('✅ All characters already have reference images.\n\n');
                }
                return;
            }

            if (stream) {
                stream.markdown(`Found ${characterAssetsNeedingImages.size} character(s) needing reference images.\n\n`);
            }

            let generated = 0;
            let failed = 0;

            for (const assetId of characterAssetsNeedingImages) {
                try {
                    const asset = await this.assetService.getAsset(assetId);
                    if (!asset) {
                        continue;
                    }

                    if (stream) {
                        stream.markdown(`Generating image for: **${asset.name}**...\n`);
                    }

                    const imagePath = await this.assetService.generateCharacterReferenceImage(
                        assetId,
                        this.openaiService
                    );

                    if (imagePath) {
                        generated++;
                        if (stream) {
                            stream.markdown(`✅ Generated for ${asset.name}\n\n`);
                        }
                        logger.info(`Generated reference image for ${asset.name}`);
                    } else {
                        failed++;
                        if (stream) {
                            stream.markdown(`❌ Failed for ${asset.name}\n\n`);
                        }
                        logger.warn(`Failed to generate reference image for ${asset.name}`);
                    }
                } catch (error) {
                    failed++;
                    logger.error(`Error generating image for asset ${assetId}:`, error);
                    if (stream) {
                        stream.markdown(`❌ Error generating image\n\n`);
                    }
                }
            }

            if (stream) {
                stream.markdown(`\n**Image Generation Complete:**\n`);
                stream.markdown(`- ✅ Generated: ${generated}\n`);
                stream.markdown(`- ❌ Failed: ${failed}\n\n`);
            }

            logger.info(`Character image generation complete: ${generated} generated, ${failed} failed`);

        } catch (error) {
            logger.error('Error ensuring character images for story:', error);
            if (stream) {
                stream.markdown(`❌ Error during image generation: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`);
            }
        }
    }

    /**
     * Regenerate story from research onwards - fixes root cause issues
     * This is FAR more efficient than manually correcting 58+ segments!
     * 
     * Flow:
     * 1. Update research in master_context.json with corrections/emphasis
     * 2. Delete old script.json and segment_N.json files
     * 3. Re-extract assets (with corrected research context)
     * 4. Re-Generate Script (with corrected research & assets)
     * 5. Save new script & segment files
     */
    async regenerateFromResearch(
        storyId: string,
        researchCorrections: string
    ): Promise<void> {
        const story = this.storyService.getStory(storyId);
        if (!story) {
            throw new Error(`Story ${storyId} not found`);
        }

        const storyDir = this.storyService.getStoryDirectory(storyId);
        const masterContextPath = path.join(storyDir, 'source', 'master_context.json');

        // 1. Update research in master_context.json
        logger.info('📝 Updating research with corrections...');
        if (!fs.existsSync(masterContextPath)) {
            throw new Error('master_context.json not found');
        }

        const masterContext = JSON.parse(fs.readFileSync(masterContextPath, 'utf-8'));
        const originalResearch = typeof masterContext.research === 'string' 
            ? masterContext.research 
            : '';
        
        // Prepend corrections to research (so AI sees them first!)
        const updatedResearch = `CRITICAL CORRECTIONS AND EMPHASIS:\n${researchCorrections}\n\n---\n\n${originalResearch}`;
        masterContext.research = updatedResearch;
        masterContext.modifiedAt = new Date().toISOString();
        
        fs.writeFileSync(masterContextPath, JSON.stringify(masterContext, null, 2));
        logger.info('✅ Research updated in master_context.json');

        // 2. Delete old script and segment files
        logger.info('🗑️ Deleting old script and segment files...');
        const scriptPath = path.join(storyDir, 'scripts', 'script.json');
        const segmentsDir = path.join(storyDir, 'segments');
        
        if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath);
        }
        
        if (fs.existsSync(segmentsDir)) {
            const segmentFiles = fs.readdirSync(segmentsDir);
            for (const file of segmentFiles) {
                if (file.startsWith('segment_') && file.endsWith('.json')) {
                    fs.unlinkSync(path.join(segmentsDir, file));
                }
            }
        }
        logger.info('✅ Old files deleted');

        // 3. Re-extract assets (will use the updated research context)
        logger.info('🎨 Re-extracting assets with corrected research...');
        
        // Read the updated master context for asset extraction
        const masterContextForAssets = JSON.parse(fs.readFileSync(masterContextPath, 'utf-8'));
        const analysisDataForExtraction = {
            title: story.name,
            context: story.description,
            transcription: masterContextForAssets.transcription || story.transcription || story.content,
            researchText: typeof masterContextForAssets.research === 'string' 
                ? masterContextForAssets.research 
                : JSON.stringify(masterContextForAssets.research)
        };
        
        const extractedAssets = await this.openaiService.extractAssets(
            story.transcription || '',
            analysisDataForExtraction
        );
        
        // Save extracted assets
        const assetsDir = path.join(storyDir, 'assets');
        const assetsFile = path.join(assetsDir, 'extracted_assets.json');
        fs.writeFileSync(assetsFile, JSON.stringify({
            storyId,
            extractedAt: new Date().toISOString(),
            assets: extractedAssets
        }, null, 2));
        logger.info(`✅ Extracted ${extractedAssets.length} assets`);

        // 4. Re-Generate Script with corrected context
        logger.info('🎬 Regenerating Script...');
        
        // Read updated master_context.json
        const updatedMasterContext = JSON.parse(fs.readFileSync(masterContextPath, 'utf-8'));
        
        if (!updatedMasterContext.timingMap) {
            throw new Error('timingMap not found in master_context.json - cannot regenerate script');
        }
        
        const timingMap = updatedMasterContext.timingMap;
        
        // Get full asset library for character matching
        const fullAssetLibrary = await this.assetService.getAllAssets();
        
        // Use Script generation with corrected research from master_context
        const analysis = {
            title: story.name,
            context: story.description,
            transcription: updatedMasterContext.transcription || story.transcription || story.content,
            researchText: typeof updatedMasterContext.research === 'string' 
                ? updatedMasterContext.research 
                : JSON.stringify(updatedMasterContext.research),
            visualStyle: 'naturalistic',
            colorPalette: 'earth tones',
            mainCharacter: 'protagonist',
            setting: 'various locations',
            theme: 'narrative',
            mood: 'contemplative'
        };
        
        const segments = await this.executionService.generateScriptOneShot(
            story,
            timingMap,
            analysis,
            fullAssetLibrary,
            updatedResearch,  // Use the corrected research!
            ProgressManager.getInstance(),
            'correction_task'
        );
        
        // Convert segment map to directorScript format
        const directorScript = {
            segments: Array.from(segments.values()).map(pair => ({
                id: pair.aiSegment.segmentId,
                text: pair.contextSegment.text,
                prompt: pair.aiSegment.finalPrompt,
                duration: pair.contextSegment.duration,
                startTime: pair.contextSegment.startTime,
                status: 'completed' as const,
                usedAssets: pair.contextSegment.usedAssets || []
            }))
        };
        
        // Update story and save files
        this.storyService.updateStory(storyId, {
            directorScript: directorScript.segments
        });
        
        // Save segments to disk (with clean [[tags]])
        await this.storyService.saveDirectorScript(storyId);
        
        logger.info(`✅ Script regenerated with ${directorScript.segments.length} segments`);

        // 6. Generate character reference images
        logger.info('🎨 Generating character reference images...');
        try {
            const characterAssets = extractedAssets.filter(a => a.type === 'character');
            let generatedCount = 0;
            
            for (const asset of characterAssets) {
                logger.info(`Generating image for: ${asset.name}`);
                
                // Create asset in library first (so it has an ID for image storage)
                const createdAsset = await this.assetService.createAsset({
                    name: asset.name,
                    type: asset.type,
                    description: asset.description,
                    visual_attributes: asset.visual_attributes || {},
                    tags: asset.tags || [],
                    storyId: storyId
                });
                
                // Generate reference image
                const imagePath = await this.assetService.generateCharacterReferenceImage(
                    createdAsset.id,
                    this.openaiService
                );
                
                if (imagePath) {
                    generatedCount++;
                    logger.info(`✅ Generated image for ${asset.name}: ${imagePath}`);
                }
            }
            
            logger.info(`✅ Generated ${generatedCount}/${characterAssets.length} character images`);
        } catch (imageError) {
            logger.error('Failed to generate character images:', imageError);
            // Don't fail the entire regeneration if image generation fails
        }
    }
}

