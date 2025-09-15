export interface ParsedIds {
  processed: number[];
  skipped: number[];
}

/**
 * Parse a free-form string and extract unique numeric IDs up to a maximum.
 * Returns processed IDs (deduped, limited) and any skipped due to the cap.
 */
export function parseNumericIds(input: string, max: number): ParsedIds {
  const allMatches = input.match(/\d+/g) || [];
  const numbers = allMatches
    .map((value) => parseInt(value, 10))
    .filter((value) => Number.isFinite(value));

  const unique = [...new Set(numbers)];
  return {
    processed: unique.slice(0, max),
    skipped: unique.slice(max),
  };
}


