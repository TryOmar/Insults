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
 * Validate Arabic insults by rejecting text containing forbidden "said" words.
 * These words break the database since the insult should contain only the insult itself,
 * not phrases like "he said insult".
 */
export function validateSayWordArabic(text: string): { valid: boolean; error?: string } {
  // Skip validation if text contains no Arabic letters
  if (!/[\u0600-\u06FF]/.test(text)) { return { valid: true }; }

  // List of forbidden words (all conjugations of قال/يقول)
  const forbiddenWords = [
    // --- ذكر (قال) ---
    'قال','قالو','قالوا','قاله','قالها','قالهم','قالك','قالكم','قالكن','قالنا','قالة',
    'قالي','قالولي','قالولك','قالولكم','قالولنا','قالوله','قالولها','قالوها','قالوه',
    'قلت','قلتما','قلتم','قلتن','قلنا',
    'يقولي','يقول','يقولوا','يقولون','يقولولي','يقولنا','يقولن',
    'بيقول','بيقولوا','بيقولون','بيقولي','بيقولولي','بيقولنا','بيقولك','بيقولكم','بيقولكن',
    'بيقولها','بيقولهم',
    'بقول','بقولك','بقولكم','بقولنا','بقولهم',
    'قلك','قلكم','قلكن','قلهم','قلها','قلو',

    // --- أنثى (قالت) ---
    'قالت','قالتلي','قالتلك','قالتلكم','قالتلنا',
    'قلتي','قلتن',
    'تقول','تقولين','تقولوا','تقولون','تقولن','تقوللي','تقولولي','تقولنا',
    'بتقول','بتقولوا','بتقولولي','بتقوللي','بتقولنا','بتقولي','بيتقولي'
  ];

  // Split input text into words (case-insensitive)
  const words = text.toLowerCase().split(/\s+/);
  
  // Check if any forbidden word exists in the input
  for (const word of words) {
    if (forbiddenWords.includes(word)) {
      return {
        valid: false,
        error: `**Insult field error:** You must write only the insult without "${word}".\n` +
               `*For additional context or explanations, use the note field.*\n` +
               `\`Example:\` /blame @user insults: dog note: he says dog when he does XYZ`
      };        
    }
  }
  
  return { valid: true };
}

/**
 * Validate English insults by rejecting text containing forbidden "say/tell" words.
 * The insult field should contain only the insult itself, not phrases like "he said insult".
 */
export function validateSayWordEnglish(text: string): { valid: boolean; error?: string } {
  const forbiddenWords = [
    'say', 'says', 'said', 'saying',
    'tell', 'tells', 'told', 'telling'
  ];

  // Split input text into words (case-insensitive)
  const words = text.toLowerCase().split(/\s+/);

  // Check if any forbidden word exists in the input
  for (const word of words) {
    if (forbiddenWords.includes(word)) {
      return {
        valid: false,
        error: `**Insult field error:** You must write only the insult without "${word}".\n` +
               `*For additional context or explanations, use the note field.*\n` +
               `\`Example:\` /blame @user insults: dog note: he says dog when he does XYZ`
      };        
    }
  }

  return { valid: true };
}

/**
 * Validate insult rules:
 * - Must not be empty
 * - Up to 3 words
 * - Each word ≤ 20 chars
 * - Total length ≤ 100
 * - No "said/say/tell" words in Arabic or English
 */
export function validateInsultInput(raw: string | null): string | null {
  if (!raw) return null;

  const cleaned = canonicalizeInsult(raw, 100);
  if (cleaned.length === 0) return null;

  // Check for forbidden "said" words in Arabic and English
  const ar = validateSayWordArabic(cleaned);
  if (!ar.valid) {
    throw new Error(ar.error!);
  }
  const en = validateSayWordEnglish(cleaned);
  if (!en.valid) {
    throw new Error(en.error!);
  }

  const words = cleaned.split(" ");
  if (words.length > 3) {
    throw new Error("Insult too long. Enter only the insult, no descriptions, no stories, no extra text.");
  }
  for (const w of words) {
    if (w.length > 20) {
      throw new Error("Insult word too long. Keep each insult short and simple.");
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
