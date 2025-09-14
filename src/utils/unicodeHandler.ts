/**
 * Unicode and Arabic text handling utilities
 * Provides functions to clean and normalize text for database operations
 */

/**
 * Normalizes Arabic text by removing invisible Unicode characters and normalizing whitespace
 */
export function normalizeArabicText(text: string): string {
  if (!text) return text;
  
  // Remove invisible Unicode characters (like U+200E, U+200F, U+061C)
  let normalized = text
    .replace(/[\u200E\u200F\u061C\u200B\u200C\u200D\uFEFF]/g, '') // Remove invisible chars
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Remove problematic quotes and special characters that might cause SQL issues
  normalized = normalized
    .replace(/[""''`]/g, '"') // Normalize quotes
    .replace(/[^\p{L}\p{N}\p{P}\p{S}\p{Z}]/gu, '') // Keep only letters, numbers, punctuation, symbols, and spaces
    .trim();
  
  return normalized;
}

/**
 * Checks if text contains problematic Unicode characters
 */
export function hasProblematicUnicode(text: string): boolean {
  if (!text) return false;
  
  // Check for invisible Unicode characters
  const invisibleChars = /[\u200E\u200F\u061C\u200B\u200C\u200D\uFEFF]/;
  return invisibleChars.test(text);
}

/**
 * Safely handles text for database operations by normalizing if needed
 */
export function safeTextForDatabase(text: string): string {
  if (!text) return text;
  
  // If text has problematic Unicode, normalize it
  if (hasProblematicUnicode(text)) {
    return normalizeArabicText(text);
  }
  
  return text;
}

/**
 * Creates a safe SQL parameter by ensuring proper encoding
 */
export function createSafeSqlParameter(value: any): any {
  if (typeof value === 'string') {
    return safeTextForDatabase(value);
  }
  return value;
}
