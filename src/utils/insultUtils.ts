/**
 * Canonicalize insult input:
 * - Trim leading/trailing spaces
 * - Collapse multiple spaces into one
 * - Preserve case, Arabic, emojis, symbols
 * - Cut to maxLen if too long
 */
export function canonicalizeInsult(raw: string, maxLen = 100): string {
  let cleaned = raw.trim().replace(/\s+/g, " ");
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
  return cleaned;
}

/**
 * Validate insult rules:
 * - Must not be empty
 * - Up to 3 words
 * - Each word ≤ 20 chars
 * - Total length ≤ 100
 */
export function validateInsultInput(raw: string | null): string | null {
  if (!raw) return null;

  const cleaned = canonicalizeInsult(raw, 100);
  if (cleaned.length === 0) return null;

  const words = cleaned.split(" ");
  if (words.length > 3) {
    throw new Error("Insult too long. Enter only the insult, no descriptions, no stories, no extra text.");
  }
  for (const w of words) {
    if (w.length > 20) {
      throw new Error("Each word must be 20 characters or less.");
    }
  }
  return cleaned;
}

/**
 * Validate note:
 * - Must not exceed 1000 chars
 */
export function validateNoteInput(note: string | null): string | null {
  if (!note) return null;
  if (note.length > 1000) {
    throw new Error(
      "Note too long. Please add a short description, link, or evidence."
    );
  }
  return note;
}

/**
 * Generate n-grams from chat message:
 * Produces 1–3 word sequences, canonicalized.
 */
export function generateInsultCandidates(message: string): string[] {
  const words = message.trim().split(/\s+/);
  const candidates: string[] = [];
  for (let size = 1; size <= 3; size++) {
    for (let i = 0; i <= words.length - size; i++) {
      const phrase = words.slice(i, i + size).join(" ");
      candidates.push(canonicalizeInsult(phrase));
    }
  }
  return candidates;
}
