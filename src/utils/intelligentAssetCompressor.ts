/**
 * Intelligent Asset Compressor - Creates compressed anchors for Script genration
 * Focuses on extracting critical visual consistency markers
 */

import { Asset } from '../models/story';
import { CompressedAsset } from '../types/asset.types';

export class IntelligentAssetCompressor {
  
  /**
   * Compress a character asset into a 50-75 token anchor
   */
  compressCharacter(asset: Asset): Omit<CompressedAsset, 'fullDescription'> {
    const visualMarkers = {
      age: this.extractAge(asset.description),
      physique: this.extractPhysique(asset.description),
      facialFeatures: this.extractFacialFeatures(asset.description),
      hair: this.extractHair(asset.description),
      eyes: this.extractEyes(asset.description), // CRITICAL: Exact eye color
      clothing: this.extractClothing(asset.description),
      distinguishing: this.extractDistinguishing(asset.description)
    };
    
    // Build compressed anchor (50-75 tokens)
    const compressedAnchor = [
      visualMarkers.age,
      visualMarkers.physique,
      visualMarkers.facialFeatures,
      visualMarkers.hair,
      visualMarkers.eyes,  // "deep brown eyes" - consistent!
      visualMarkers.clothing,
      visualMarkers.distinguishing
    ].filter(Boolean).join(', ');
    
    return {
      id: asset.id,
      type: 'character',
      name: asset.name,
      compressedAnchor,
      visualKeywords: this.extractKeywords(visualMarkers),
      emotionalArc: this.inferEmotionalArc(asset),
      referenceImage: asset.reference_image
    };
  }
  
  /**
   * Compress a location asset
   */
  compressLocation(asset: Asset): Omit<CompressedAsset, 'fullDescription'> {
    const locationMarkers = {
      setting: this.extractSetting(asset.description),
      atmosphere: this.extractAtmosphere(asset.description),
      lighting: this.extractLighting(asset.description),
      architecture: this.extractArchitecture(asset),
      vegetation: this.extractVegetation(asset.description),
      distinguishing: this.extractDistinguishing(asset.description)
    };
    
    const compressedAnchor = [
      locationMarkers.setting,
      locationMarkers.atmosphere,
      locationMarkers.lighting,
      locationMarkers.architecture,
      locationMarkers.vegetation,
      locationMarkers.distinguishing
    ].filter(Boolean).join(', ');
    
    return {
      id: asset.id,
      type: 'location',
      name: asset.name,
      compressedAnchor,
      visualKeywords: this.extractKeywords(locationMarkers),
      lightingProgression: this.inferLightingProgression(asset),
      referenceImage: asset.reference_image
    };
  }
  
  /**
   * Compress an item asset
   */
  compressItem(asset: Asset): Omit<CompressedAsset, 'fullDescription'> {
    const itemMarkers = {
      material: this.extractMaterial(asset.description),
      size: this.extractSize(asset.description),
      color: this.extractColor(asset.description),
      distinguishing: this.extractDistinguishing(asset.description)
    };
    
    const compressedAnchor = [
      itemMarkers.material,
      itemMarkers.size,
      itemMarkers.color,
      itemMarkers.distinguishing
    ].filter(Boolean).join(', ');
    
    return {
      id: asset.id,
      type: 'item',
      name: asset.name,
      compressedAnchor,
      visualKeywords: this.extractKeywords(itemMarkers),
      referenceImage: asset.reference_image
    };
  }
  
  /**
   * Compress a vehicle asset
   */
  compressVehicle(asset: Asset): Omit<CompressedAsset, 'fullDescription'> {
    const vehicleMarkers = {
      type: this.extractVehicleType(asset.description),
      material: this.extractMaterial(asset.description),
      color: this.extractColor(asset.description),
      distinguishing: this.extractDistinguishing(asset.description)
    };
    
    const compressedAnchor = [
      vehicleMarkers.type,
      vehicleMarkers.material,
      vehicleMarkers.color,
      vehicleMarkers.distinguishing
    ].filter(Boolean).join(', ');
    
    return {
      id: asset.id,
      type: 'vehicle',
      name: asset.name,
      compressedAnchor,
      visualKeywords: this.extractKeywords(vehicleMarkers),
      referenceImage: asset.reference_image
    };
  }
  
  /**
   * Compress an animal asset
   */
  compressAnimal(asset: Asset): Omit<CompressedAsset, 'fullDescription'> {
    const animalMarkers = {
      species: this.extractSpecies(asset.description),
      size: this.extractSize(asset.description),
      color: this.extractColor(asset.description),
      distinguishing: this.extractDistinguishing(asset.description)
    };
    
    const compressedAnchor = [
      animalMarkers.species,
      animalMarkers.size,
      animalMarkers.color,
      animalMarkers.distinguishing
    ].filter(Boolean).join(', ');
    
    return {
      id: asset.id,
      type: 'animal',
      name: asset.name,
      compressedAnchor,
      visualKeywords: this.extractKeywords(animalMarkers),
      referenceImage: asset.reference_image
    };
  }
  
  /**
   * Main compression method - routes to type-specific compressor
   */
  compress(asset: Asset): Omit<CompressedAsset, 'fullDescription'> {
    switch (asset.type) {
      case 'character':
        return this.compressCharacter(asset);
      case 'location':
        return this.compressLocation(asset);
      case 'item':
        return this.compressItem(asset);
      case 'vehicle':
        return this.compressVehicle(asset);
      case 'animal':
        return this.compressAnimal(asset);
      default:
        throw new Error(`Unsupported asset type: ${asset.type}`);
    }
  }
  
  // Character extraction methods
  private extractAge(description: string): string {
    const agePatterns = [
      /(young|youthful|teenage|adolescent)/i,
      /(middle-aged|mature|adult)/i,
      /(elderly|old|aged|ancient)/i,
      /(ancient|timeless|eternal)/i
    ];
    
    for (const pattern of agePatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  private extractPhysique(description: string): string {
    const physiquePatterns = [
      /(tall|short|average height)/i,
      /(slender|thin|lean|muscular|stocky|robust)/i,
      /(graceful|imposing|powerful|delicate)/i
    ];
    
    for (const pattern of physiquePatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  private extractFacialFeatures(description: string): string {
    const facePatterns = [
      /(angular|round|oval|square) face/i,
      /(prominent|strong|delicate|sharp) features/i,
      /(weathered|smooth|wrinkled|youthful) skin/i
    ];
    
    for (const pattern of facePatterns) {
      const match = description.match(pattern);
      if (match) return match[0].toLowerCase();
    }
    
    return '';
  }
  
  private extractHair(description: string): string {
    const hairPatterns = [
      /(long|short|medium|shoulder-length) hair/i,
      /(curly|straight|wavy|thick|thin) hair/i,
      /(blonde|brown|black|gray|white|silver|red) hair/i,
      /(bald|balding)/i
    ];
    
    for (const pattern of hairPatterns) {
      const match = description.match(pattern);
      if (match) return match[0].toLowerCase();
    }
    
    return '';
  }
  
  private extractEyes(description: string): string {
    // CRITICAL: Extract exact eye description
    const eyePatterns = [
      /eyes?:?\s+([^.;]+)/i,
      /(\w+\s+eyes)/i,
      /eyes?\s+([^,]+)/i,
      /(deep|bright|piercing|gentle|kind|fierce)\s+(brown|blue|green|hazel|gray|amber|black)\s+eyes/i
    ];
    
    for (const pattern of eyePatterns) {
      const match = description.match(pattern);
      if (match) return match[1].trim();
    }
    
    return '';
  }
  
  private extractClothing(description: string): string {
    const clothingPatterns = [
      /(robes|tunic|toga|cloak|gown|dress|shirt|pants|trousers)/i,
      /(white|black|brown|blue|red|gold|silver|purple)\s+(robes|clothing|garments)/i,
      /(simple|elaborate|ornate|plain|elegant|humble)\s+(clothing|attire|garments)/i
    ];
    
    for (const pattern of clothingPatterns) {
      const match = description.match(pattern);
      if (match) return match[0].toLowerCase();
    }
    
    return '';
  }
  
  private extractDistinguishing(description: string): string {
    const distinguishingPatterns = [
      /(scar|mark|tattoo|birthmark|wound)/i,
      /(staff|rod|scepter|scroll|book|instrument)/i,
      /(glowing|radiant|luminous|divine|ethereal)/i,
      /(beard|mustache|goatee)/i
    ];
    
    for (const pattern of distinguishingPatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  // Location extraction methods
  private extractSetting(description: string): string {
    const settingPatterns = [
      /(island|mountain|valley|desert|forest|city|village|temple|palace|garden)/i,
      /(coastal|inland|remote|isolated|populated|deserted)/i
    ];
    
    for (const pattern of settingPatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  private extractAtmosphere(description: string): string {
    const atmospherePatterns = [
      /(peaceful|serene|tranquil|calm|quiet)/i,
      /(dramatic|intense|mysterious|eerie|foreboding)/i,
      /(sacred|holy|divine|spiritual|reverent)/i
    ];
    
    for (const pattern of atmospherePatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  private extractLighting(description: string): string {
    const lightingPatterns = [
      /(bright|dim|soft|harsh|golden|silver|warm|cool)\s+(light|lighting|illumination)/i,
      /(sunlight|moonlight|starlight|firelight|candlelight)/i,
      /(glowing|radiant|luminous|shimmering)/i
    ];
    
    for (const pattern of lightingPatterns) {
      const match = description.match(pattern);
      if (match) return match[0].toLowerCase();
    }
    
    return '';
  }
  
  private extractArchitecture(asset: Asset): string {
    if (asset.visual_attributes?.architecture) {
      return asset.visual_attributes.architecture;
    }
    
    const archPatterns = [
      /(stone|marble|wooden|brick|mud|clay)\s+(buildings|structures|walls|columns)/i,
      /(temple|palace|house|hut|tent|dwelling)/i,
      /(ancient|modern|classical|gothic|roman|greek)/i
    ];
    
    for (const pattern of archPatterns) {
      const match = asset.description.match(pattern);
      if (match) return match[0].toLowerCase();
    }
    
    return '';
  }
  
  private extractVegetation(description: string): string {
    const vegetationPatterns = [
      /(trees|forest|garden|meadow|grassland|desert|barren)/i,
      /(olive|palm|cedar|oak|pine|cypress|fig)/i,
      /(lush|sparse|dense|thick|thin|abundant|scarce)/i
    ];
    
    for (const pattern of vegetationPatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  // Item extraction methods
  private extractMaterial(description: string): string {
    const materialPatterns = [
      /(wooden|stone|metal|gold|silver|bronze|iron|clay|leather|fabric)/i,
      /(ancient|old|weathered|new|polished|rough|smooth)/i
    ];
    
    for (const pattern of materialPatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  private extractSize(description: string): string {
    const sizePatterns = [
      /(large|big|huge|massive|enormous|giant)/i,
      /(small|tiny|miniature|petite|compact)/i,
      /(medium|average|moderate|standard)/i
    ];
    
    for (const pattern of sizePatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  private extractColor(description: string): string {
    const colorPatterns = [
      /(white|black|brown|red|blue|green|yellow|purple|gold|silver|bronze)/i,
      /(bright|dark|light|pale|deep|rich|vibrant|muted)/i
    ];
    
    for (const pattern of colorPatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  // Vehicle extraction methods
  private extractVehicleType(description: string): string {
    const vehiclePatterns = [
      /(chariot|cart|wagon|boat|ship|vessel|raft)/i,
      /(horse|donkey|camel|ox|mule)-drawn/i,
      /(sailing|rowing|paddling)/i
    ];
    
    for (const pattern of vehiclePatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  // Animal extraction methods
  private extractSpecies(description: string): string {
    const speciesPatterns = [
      /(lamb|sheep|goat|ox|bull|cow|horse|donkey|camel|lion|eagle|dove|serpent|snake)/i,
      /(wild|domestic|tame|feral|sacred|divine)/i
    ];
    
    for (const pattern of speciesPatterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    
    return '';
  }
  
  // Utility methods
  private extractKeywords(markers: Record<string, string>): string[] {
    const keywords: string[] = [];
    
    for (const [key, value] of Object.entries(markers)) {
      if (value) {
        // Split compound phrases and add individual words
        const words = value.split(/[\s,]+/).filter(word => word.length > 2);
        keywords.push(...words);
      }
    }
    
    // Return top 4-6 keywords
    return keywords.slice(0, 6);
  }
  
  private inferEmotionalArc(asset: Asset): string {
    if (asset.type !== 'character') return '';
    
    const description = asset.description.toLowerCase();
    
    if (description.includes('suffering') || description.includes('exile') || description.includes('persecution')) {
      return 'suffering-to-redemption';
    }
    if (description.includes('revelation') || description.includes('vision') || description.includes('prophecy')) {
      return 'revelation-and-awe';
    }
    if (description.includes('divine') || description.includes('holy') || description.includes('sacred')) {
      return 'divine-presence';
    }
    
    return 'narrative-progression';
  }
  
  private inferLightingProgression(asset: Asset): string {
    if (asset.type !== 'location') return '';
    
    const description = asset.description.toLowerCase();
    
    if (description.includes('dawn') || description.includes('morning')) {
      return 'dawn-to-daylight';
    }
    if (description.includes('dusk') || description.includes('evening') || description.includes('sunset')) {
      return 'dusk-to-twilight';
    }
    if (description.includes('night') || description.includes('darkness')) {
      return 'nighttime-illumination';
    }
    
    return 'natural-lighting';
  }
  
  /**
   * Compress other type asset
   */
  compressOther(asset: Asset): Omit<CompressedAsset, 'fullDescription'> {
    const otherMarkers = {
      appearance: this.extractAppearance(asset.description),
      function: this.extractFunction(asset.description),
      distinguishing: this.extractDistinguishing(asset.description)
    };
    
    const compressedAnchor = [
      otherMarkers.appearance,
      otherMarkers.function,
      otherMarkers.distinguishing
    ].filter(Boolean).join(', ');
    
    return {
      id: asset.id,
      type: 'other',
      name: asset.name,
      compressedAnchor,
      visualKeywords: this.extractKeywords(otherMarkers),
      referenceImage: asset.reference_image
    };
  }
  
  private extractAppearance(description: string): string {
    // Extract appearance description
    const patterns = [
      /appearance[:\s]+([^.;]+)/i,
      /looks?\s+([^.;]+)/i,
      /appears?\s+([^.;]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match) return match[1].trim();
    }
    
    return '';
  }
  
  private extractFunction(description: string): string {
    // Extract function or purpose
    const patterns = [
      /function[:\s]+([^.;]+)/i,
      /purpose[:\s]+([^.;]+)/i,
      /used\s+for\s+([^.;]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match) return match[1].trim();
    }
    
    return '';
  }
}





