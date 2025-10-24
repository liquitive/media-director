/**
 * Master Context File Builder - Creates comprehensive context file for Script genration
 * Aggregates all story data, assets, research, and timing information into single file
 */

import * as fs from 'fs';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import { Asset } from '../models/story';
import { CompressedAsset, MasterContextFile } from '../types/asset.types';
import { IntelligentAssetCompressor } from '../utils/intelligentAssetCompressor';
import { ExplicitErrorLogger } from '../utils/explicitErrorLogger';

export class MasterContextFileBuilder {
  private compressor: IntelligentAssetCompressor;
  private errorLogger: ExplicitErrorLogger;
  private workspaceRoot: string;
  
  constructor(
    workspaceRoot: string,
    errorLogger: ExplicitErrorLogger
  ) {
    this.workspaceRoot = workspaceRoot;
    this.errorLogger = errorLogger;
    this.compressor = new IntelligentAssetCompressor();
  }
  
  /**
   * Build comprehensive master context file
   */
  async buildContextFile(
    storyId: string,
    timingMap: any,
    analysis: any,
    assets: Asset[],
    researchText: string,
    story?: any
  ): Promise<string> {
    
    this.errorLogger.logInfo(storyId, 'Building master context file...');
    
    try {
      // 1. Compress assets
      const compressedAssets = await this.compressAssets(assets);
      
      // 2. Parse research (NO COMPRESSION - full context)
      const research = await this.parseFullResearch(analysis, researchText);
      
      // 3. Build cinematography guidelines
      const cinematography = this.buildCinematographyGuidelines(analysis);
      
      // 4. Pre-resolve assets for all segments
      const segments = await this.buildSegmentsWithAssets(
        timingMap.segments,
        compressedAssets
      );
      
      // 5. Build complete context
      const contextFile: MasterContextFile = {
        storyId,
        storyName: story?.name || analysis.title || 'Untitled Story',
        storyDescription: story?.description || analysis.context || '',
        storyContent: story?.content || analysis.transcription || '',
        transcription: analysis.transcription,
        research,
        audioAnalysis: this.buildAudioAnalysis(timingMap, analysis),
        compressedAssets,
        timingMap,
        cinematographyGuidelines: cinematography,
        generationInstructions: this.buildGenerationInstructions(analysis),
        segments
      };
      
      // 6. Write to temporary file
      const filePath = await this.writeContextFile(contextFile, storyId);
      
      // Log file size and warn if approaching OpenAI limits
      const stats = await fsPromises.stat(filePath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      this.errorLogger.logInfo(storyId, `Master context file created: ${filePath} (${sizeMB} MB)`);
      
      // Warn if approaching OpenAI file size limits (512 MB max)
      if (stats.size > 100 * 1024 * 1024) { // 100 MB warning threshold
        this.errorLogger.logWarning(storyId,
          `Large context file: ${sizeMB} MB (OpenAI limit: 512 MB)`,
          { fileSize: stats.size, filePath }
        );
      }
      
      return filePath;
    } catch (error) {
      this.errorLogger.logCritical(storyId, 'Failed to build master context file', {
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }
  
  /**
   * Compress all assets for efficient Script genration
   */
  private async compressAssets(assets: Asset[]): Promise<CompressedAsset[]> {
    const compressedAssets: CompressedAsset[] = [];
    
    for (const asset of assets) {
      try {
        let compressed: Omit<CompressedAsset, 'fullDescription'>;
        
        switch (asset.type) {
          case 'character':
            compressed = this.compressor.compressCharacter(asset);
            break;
          case 'location':
            compressed = this.compressor.compressLocation(asset);
            break;
          case 'item':
            compressed = this.compressor.compressItem(asset);
            break;
          case 'vehicle':
            compressed = this.compressor.compressVehicle(asset);
            break;
          case 'animal':
            compressed = this.compressor.compressAnimal(asset);
            break;
          default:
            compressed = this.compressor.compressOther(asset);
        }
        
        compressedAssets.push({
          ...compressed,
          fullDescription: asset.description
        });
      } catch (error) {
        this.errorLogger.logWarning('system', `Failed to compress asset ${asset.id}: ${error instanceof Error ? error.message : String(error)}`);
        // Continue with other assets
      }
    }
    
    return compressedAssets;
  }
  
  /**
   * Parse full research context (no compression needed with file attachments)
   */
  private async parseFullResearch(analysis: any, researchText: string): Promise<any> {
    if (!researchText) {
      return {
        historicalSources: [],
        literarySources: [],
        culturalContext: [],
        artisticSources: [],
        emotionalSignificance: '',
        literalSignificance: '',
        protagonistAnalysis: {
          identityBackground: '',
          physicalCharacteristics: '',
          psychologicalSpiritualProfile: '',
          relationshipsDynamics: '',
          historicalCulturalContext: ''
        },
        locationAnalysis: {
          geographicalSpecifics: '',
          historicalContext: '',
          culturalReligiousSignificance: '',
          physicalDescription: '',
          emotionalAtmosphere: ''
        },
        temporalContext: {
          preciseTimeframe: '',
          historicalPeriodCharacteristics: '',
          culturalReligiousEnvironment: '',
          artisticIntellectualClimate: ''
        },
        themesNarrativeAnalysis: {
          surfaceNarrative: '',
          deeperThemesMeanings: '',
          literaryAnalysis: '',
          emotionalPsychologicalJourney: ''
        },
        visualCinematicApproach: {
          visualStyleAesthetic: '',
          colorPaletteLighting: '',
          costumeProductionDesign: '',
          soundMusicDirection: ''
        },
        purposeSignificance: {
          storytellersIntent: '',
          historicalImpact: '',
          contemporaryRelevance: '',
          emotionalSpiritualSignificance: ''
        }
      };
    }
    
    // Parse research sections (simplified parsing)
    const sections = this.parseResearchSections(researchText);
    
    return {
      historicalSources: this.extractHistoricalSources(sections),
      literarySources: this.extractLiterarySources(sections),
      culturalContext: this.extractCulturalContext(sections),
      artisticSources: this.extractArtisticSources(sections),
      emotionalSignificance: this.extractSection(sections, 'EMOTIONAL SIGNIFICANCE'),
      literalSignificance: this.extractSection(sections, 'LITERAL SIGNIFICANCE'),
      protagonistAnalysis: {
        identityBackground: this.extractSection(sections, 'WHO - IDENTITY'),
        physicalCharacteristics: this.extractSection(sections, 'WHO - PHYSICAL'),
        psychologicalSpiritualProfile: this.extractSection(sections, 'WHO - PSYCHOLOGICAL'),
        relationshipsDynamics: this.extractSection(sections, 'WHO - RELATIONSHIPS'),
        historicalCulturalContext: this.extractSection(sections, 'WHO - HISTORICAL')
      },
      locationAnalysis: {
        geographicalSpecifics: this.extractSection(sections, 'WHERE - GEOGRAPHICAL'),
        historicalContext: this.extractSection(sections, 'WHERE - HISTORICAL'),
        culturalReligiousSignificance: this.extractSection(sections, 'WHERE - CULTURAL'),
        physicalDescription: this.extractSection(sections, 'WHERE - PHYSICAL'),
        emotionalAtmosphere: this.extractSection(sections, 'WHERE - EMOTIONAL')
      },
      temporalContext: {
        preciseTimeframe: this.extractSection(sections, 'WHEN - PRECISE'),
        historicalPeriodCharacteristics: this.extractSection(sections, 'WHEN - HISTORICAL'),
        culturalReligiousEnvironment: this.extractSection(sections, 'WHEN - CULTURAL'),
        artisticIntellectualClimate: this.extractSection(sections, 'WHEN - ARTISTIC')
      },
      themesNarrativeAnalysis: {
        surfaceNarrative: this.extractSection(sections, 'WHAT - SURFACE'),
        deeperThemesMeanings: this.extractSection(sections, 'WHAT - DEEPER'),
        literaryAnalysis: this.extractSection(sections, 'WHAT - LITERARY'),
        emotionalPsychologicalJourney: this.extractSection(sections, 'WHAT - EMOTIONAL')
      },
      visualCinematicApproach: {
        visualStyleAesthetic: this.extractSection(sections, 'HOW - VISUAL STYLE'),
        colorPaletteLighting: this.extractSection(sections, 'HOW - COLOR'),
        costumeProductionDesign: this.extractSection(sections, 'HOW - COSTUME'),
        soundMusicDirection: this.extractSection(sections, 'HOW - SOUND')
      },
      purposeSignificance: {
        storytellersIntent: this.extractSection(sections, 'WHY - INTENT'),
        historicalImpact: this.extractSection(sections, 'WHY - HISTORICAL'),
        contemporaryRelevance: this.extractSection(sections, 'WHY - CONTEMPORARY'),
        emotionalSpiritualSignificance: this.extractSection(sections, 'WHY - EMOTIONAL')
      }
    };
  }
  
  /**
   * Build segments with pre-resolved assets
   */
  private async buildSegmentsWithAssets(
    timingSegments: any[],
    assets: CompressedAsset[]
  ): Promise<any[]> {
    return timingSegments.map((seg, index) => ({
      id: `segment_${index + 1}`,
      text: seg.text,
      duration: seg.duration,
      startTime: seg.startTime,
      rawVisualPrompt: seg.text, // Will be replaced with finalPrompt
      usedAssets: this.identifyUsedAssets(seg, assets)
    }));
  }
  
  /**
   * Identify which assets are used in each segment
   */
  private identifyUsedAssets(segment: any, assets: CompressedAsset[]): string[] {
    const assetIds: string[] = [];
    const segmentText = segment.text.toLowerCase();
    
    for (const asset of assets) {
      // Check if asset name is mentioned in segment text
      const assetName = asset.name.toLowerCase();
      if (segmentText.includes(assetName)) {
        assetIds.push(asset.id);
        continue;
      }
      
      // Check visual keywords
      for (const keyword of asset.visualKeywords) {
        if (segmentText.includes(keyword.toLowerCase())) {
          assetIds.push(asset.id);
          break;
        }
      }
    }
    
    return assetIds;
  }
  
  /**
   * Build cinematography guidelines
   */
  private buildCinematographyGuidelines(analysis: any): any {
    return {
      cameraMovements: 'Dynamic camera work that follows emotional beats and narrative flow',
      lightingPrinciples: 'Natural lighting with dramatic shadows and highlights',
      shotComposition: 'Rule of thirds with strong foreground/background relationships',
      visualContinuity: 'Maintain consistent visual style and character appearance across all segments'
    };
  }
  
  /**
   * Build generation instructions
   */
  private buildGenerationInstructions(analysis: any): any {
    return {
      model: 'sora',
      visualStyle: analysis.visualStyle || 'naturalistic',
      customStylePrompt: analysis.customStylePrompt,
      defaultDuration: 4,
      quality: 'medium',
      aspectRatio: '16:9',
      maxPromptChars: 400,
      audioSettings: {
        enableMusic: false,
        enableNarration: true,
        musicVolume: 0.7,
        narrationVolume: 1.0
      },
      preferredAssets: []
    };
  }
  
  /**
   * Build audio analysis context
   */
  private buildAudioAnalysis(timingMap: any, analysis: any): any {
    return {
      duration: timingMap.duration || 0,
      bitrate: analysis.bitrate || 128,
      sampleRate: analysis.sampleRate || 44100,
      channels: analysis.channels || 2,
      silences: analysis.silences || [],
      loudness: {
        average: analysis.loudness?.average || 0,
        peak: analysis.loudness?.peak || 0
      },
      estimatedTempo: analysis.tempo || 120
    };
  }
  
  /**
   * Write context file to temporary directory
   */
  private async writeContextFile(
    context: MasterContextFile,
    storyId: string
  ): Promise<string> {
    // Write directly to story source directory instead of temp
    const storyDir = path.join(
      this.workspaceRoot,
      'sora-output',
      'stories',
      context.storyName.toLowerCase().replace(/[^a-z0-9]/g, '_')
    );
    const sourceDir = path.join(storyDir, 'source');
    
    await fsPromises.mkdir(sourceDir, { recursive: true });
    
    const filePath = path.join(sourceDir, 'master_context.json');
    const jsonContent = JSON.stringify(context, null, 2);
    await fsPromises.writeFile(filePath, jsonContent, 'utf-8');
    
    return filePath;
  }
  
  // Helper methods for research parsing
  private parseResearchSections(researchText: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const lines = researchText.split('\n');
    let currentSection = '';
    let currentContent: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.match(/^[A-Z\s]+:$/) || trimmed.match(/^\d+\.\s+[A-Z\s]+$/)) {
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = trimmed.replace(/[:\d\.]/g, '').trim();
        currentContent = [];
      } else if (trimmed && currentSection) {
        currentContent.push(trimmed);
      }
    }
    
    if (currentSection && currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }
    
    return sections;
  }
  
  private extractSection(sections: Record<string, string>, key: string): string {
    return sections[key] || '';
  }
  
  private extractHistoricalSources(sections: Record<string, string>): string[] {
    const content = this.extractSection(sections, 'HISTORICAL SOURCES');
    return content ? content.split('\n').filter(line => line.trim()) : [];
  }
  
  private extractLiterarySources(sections: Record<string, string>): string[] {
    const content = this.extractSection(sections, 'LITERARY SOURCES');
    return content ? content.split('\n').filter(line => line.trim()) : [];
  }
  
  private extractCulturalContext(sections: Record<string, string>): string[] {
    const content = this.extractSection(sections, 'CULTURAL SOURCES');
    return content ? content.split('\n').filter(line => line.trim()) : [];
  }
  
  private extractArtisticSources(sections: Record<string, string>): string[] {
    const content = this.extractSection(sections, 'ARTISTIC SOURCES');
    return content ? content.split('\n').filter(line => line.trim()) : [];
  }
  
  private hashDescription(description: string): string {
    // Simple hash for description integrity
    let hash = 0;
    for (let i = 0; i < description.length; i++) {
      const char = description.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }
}