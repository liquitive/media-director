import { ValidationResult, ValidationContext, ValidationIssue } from '../types/validation';
import { AIService } from './aiService';
import { logger } from '../utils/logger';

/**
 * Service for validating video segments before generation
 * Catches narrative inconsistencies, protagonist errors, and logical issues
 */
export class SegmentValidationService {
    constructor(private aiService: AIService) {}

    /**
     * Validate a batch of segments for narrative consistency
     */
    async validateSegmentBatch(
        segments: any[],
        context: ValidationContext
    ): Promise<ValidationResult> {
        logger.info(`Validating batch of ${segments.length} segments for story ${context.storyId}`);

        try {
            const validationPrompt = this.buildValidationPrompt(segments, context);
            const response = await this.aiService.validateSegments(validationPrompt);
            
            // Parse validation response
            const result = this.parseValidationResponse(response);
            
            logger.info(`Validation complete: ${result.isValid ? 'PASSED' : 'FAILED'} with ${result.issues.length} issues`);
            
            return result;
        } catch (error) {
            logger.error('Validation failed:', error);
            
            // Return a safe default that allows generation to continue
            // but logs the validation error
            return {
                isValid: true,
                issues: [],
                confidence: 0,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Build the validation prompt for AI analysis
     */
    private buildValidationPrompt(segments: any[], context: ValidationContext): string {
        // Summarize research if too long
        const researchSummary = context.research 
            ? context.research.substring(0, 1500) + '...'
            : 'No research available';

        // Format assets for context
        const assetsContext = context.assets && context.assets.length > 0
            ? `\nEXTRACTED ASSETS:\n${JSON.stringify(context.assets.map(a => ({
                id: a.id,
                name: a.name,
                type: a.type,
                description: a.description
            })), null, 2)}`
            : '';

        return `You are an expert validator for video production. Focus on objective, tag-based correctness and formatting. Identify systematic issues (patterns across segments) and prefer root-cause fixes.

TRANSCRIPTION/LYRICS:
${context.transcription}

RESEARCH CONTEXT:
${researchSummary}
${assetsContext}

SEGMENTS TO VALIDATE (${segments.length} total):
${JSON.stringify(segments, null, 2)}

VALIDATION CHECKS:

A) TAG CORRECTNESS (CRITICAL):
   - If a [[tag]] appears in visualPrompt, usedAssets MUST include the exact asset ID(s) for those tags (protagonist first if present).
   - Missing or mismatched IDs → report "missing_usedAssets" (critical) with affected segments and which tags are missing.

B) TAG FORMAT (CRITICAL):
   - Tags must be canonical [[token]]: token = a–z, 0–9, underscore. Collapse duplicates like [[[[x]]]] → [[x]].
   - Any stray @ or @@ tokens, or malformed brackets → "tag_format_error" (critical) with examples.

C) CONTENT-IMPLIED ASSETS (WARNING):
   - If the prompt text clearly references a known asset (name or unique alias) but no [[tag]] is used, suggest adding the tag.
   - Report as "asset_tag_missing" (warning), not blocking.

D) NEUTRAL/AMBIENT SEGMENTS (ALLOWED):
   - If content does not imply any asset (pure ambience/silence/music), zero tags and empty usedAssets are valid. Do not report an error.

E) PRONOUNS (NEUTRAL):
   - Words like "I", "me", "my" are not errors. Do not block on pronouns.
   - Only if a systematic POV drift is evident across 3+ segments without appropriate tagging, report "pov_inconsistency" (warning) with examples.

F) DURATION CONSISTENCY (WARNING):
   - Compare timing map duration with segment.actualDuration (not the quantized duration). Allow ±0.25s tolerance.
   - If outside tolerance, report "duration_mismatch" (warning) with examples.

G) NARRATIVE CONSISTENCY (WARNING):
   - If visuals fundamentally contradict the transcription or sequence, report "narrative_inconsistency" (warning) with concrete examples.

IMPORTANT: Identify PATTERNS. If 3+ segments share the same error type, mark as isSystematic=true and include a rootCause.

RETURN VALID JSON ONLY:
{
  "isValid": true/false,
  "issues": [
    {
      "id": "issue_1",
      "type": "tag_format_error" | "missing_usedAssets" | "asset_tag_missing" | "pov_inconsistency" | "narrative_inconsistency" | "visual_logic_error" | "asset_mismatch",
      "segmentIds": ["segment_1", "segment_2", "segment_3", ...],
      "description": "Describe the pattern across segments with specific examples",
      "severity": "critical" | "warning",
      "isSystematic": true/false,
      "rootCause": "IF systematic: the core misunderstanding that caused this pattern",
      "recommendedApproach": "IF systematic: 'Regenerate from corrected research' | IF isolated: 'Manual segment fix'"
    }
  ],
  "confidence": 0.0-1.0
}

CRITICAL RULE:
- If 3+ segments share the same error type → Mark isSystematic=true and provide rootCause
- Prefer root-cause correction over individual segment fixes to maximize efficiency`;
    }

    /**
     * Parse the AI validation response into structured result
     */
    private parseValidationResponse(response: string): ValidationResult {
        try {
            // Try to extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in validation response');
            }

            const parsed = JSON.parse(jsonMatch[0]);
            
            // Ensure issues have unique IDs
            if (parsed.issues && Array.isArray(parsed.issues)) {
                parsed.issues = parsed.issues.map((issue: any, index: number) => ({
                    ...issue,
                    id: issue.id || `issue_${Date.now()}_${index}`
                }));
            }

            return {
                isValid: parsed.isValid ?? true,
                issues: parsed.issues || [],
                confidence: parsed.confidence ?? 0.5,
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error('Failed to parse validation response:', error);
            logger.error('Response was:', response);
            
            // Return safe default
            return {
                isValid: true,
                issues: [],
                confidence: 0,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Format validation result as human-readable text
     */
    formatValidationResult(result: ValidationResult): string {
        if (result.isValid) {
            return '✅ All segments validated successfully. No issues found.';
        }

        const criticalIssues = result.issues.filter(i => i.severity === 'critical');
        const warnings = result.issues.filter(i => i.severity === 'warning');

        let formatted = `❌ Validation found ${result.issues.length} issue(s):\n\n`;

        if (criticalIssues.length > 0) {
            formatted += `🚨 CRITICAL ISSUES (${criticalIssues.length}):\n`;
            criticalIssues.forEach((issue, index) => {
                formatted += `\n${index + 1}. [${issue.type}] ${issue.description}\n`;
                formatted += `   Affects: ${issue.segmentIds.join(', ')}\n`;
                if (issue.suggestedFix) {
                    formatted += `   💡 Suggested fix: ${issue.suggestedFix}\n`;
                }
            });
        }

        if (warnings.length > 0) {
            formatted += `\n⚠️  WARNINGS (${warnings.length}):\n`;
            warnings.forEach((issue, index) => {
                formatted += `\n${index + 1}. [${issue.type}] ${issue.description}\n`;
                formatted += `   Affects: ${issue.segmentIds.join(', ')}\n`;
                if (issue.suggestedFix) {
                    formatted += `   💡 Suggested fix: ${issue.suggestedFix}\n`;
                }
            });
        }

        formatted += `\n📊 Confidence: ${(result.confidence * 100).toFixed(0)}%`;

        return formatted;
    }
}











