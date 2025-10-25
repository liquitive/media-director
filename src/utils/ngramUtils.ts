/**
 * N-gram overlap detection for repetition blocking
 * Used to prevent prompt repetition across segments
 */

/**
 * Generate n-grams from text
 * @param text Input text
 * @param n Size of n-gram (default 4)
 * @returns Set of n-grams
 */
export function ngrams(text: string, n: number): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  
  const grams = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.add(tokens.slice(i, i + n).join(' '));
  }
  return grams;
}

/**
 * Calculate overlap ratio between two texts
 * @param textA First text
 * @param textB Second text
 * @param n N-gram size (default 4)
 * @returns Overlap ratio (0-1)
 */
export function overlapRatio(textA: string, textB: string, n: number = 4): number {
  const gramsA = ngrams(textA, n);
  const gramsB = ngrams(textB, n);
  
  const intersection = [...gramsA].filter(g => gramsB.has(g)).length;
  const smaller = Math.min(gramsA.size, gramsB.size);
  
  return smaller > 0 ? intersection / smaller : 0;
}

/**
 * Check if current text is too similar to recent texts
 * @param current Current text
 * @param recent Array of recent texts
 * @param n N-gram size (default 4)
 * @param threshold Similarity threshold (default 0.25)
 * @returns True if too similar
 */
export function isTooSimilar(
  current: string,
  recent: string[],
  n: number = 4,
  threshold: number = 0.25
): boolean {
  return recent.some(prev => overlapRatio(current, prev, n) > threshold);
}

/**
 * Find which segment in recent is most similar
 * @param current Current text
 * @param recent Array of recent texts
 * @param n N-gram size (default 4)
 * @returns Object with index and overlap ratio, or null
 */
export function findSimilarSegment(
  current: string,
  recent: string[],
  n: number = 4
): { index: number; overlap: number } | null {
  let maxOverlap = 0;
  let maxIndex = -1;
  
  recent.forEach((prev, idx) => {
    const overlap = overlapRatio(current, prev, n);
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      maxIndex = idx;
    }
  });
  
  return maxIndex >= 0 ? { index: maxIndex, overlap: maxOverlap } : null;
}


