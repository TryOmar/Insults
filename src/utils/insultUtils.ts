/**
 * Maximum number of words allowed in an insult
 * This constant controls the maximum insult length across all validation and scanning functions
 */
export const MAX_INSULT_WORDS = 3;

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

  // Full forbidden words list (male and female combined, common → less common)
  const forbiddenWords = [
    // Male / general (past & present)
    'قال', 'قالي', 'قلي', 'قلتلي', 'قلتلك', 'قاله', 'قالها', 'قالهم', 'قالك', 'قالنا', 'قالوا', 'قالو',
    'قلت', 'قلته', 'قلتها', 'قلنا', 'قلتم', 'قلها',
    'بيقول', 'بيقولي', 'بيقوله', 'بيقولها', 'بيقولهم', 'بيقولك', 'بيقولنا', 'بيقولوا', 'بيقولو',
    'بيقله', 'بيقلك', 'بيقلنا', 'بيقلهم', 'بيقلوه', 'بيقلوها', 'بقول', 'بقولك', 'بقولنا', 'بقولهم',
    'قالولي','قالولك','قالولنا','قالوله','قالوها','قالوه','قلتما','قلتم','قلتن',
    'يقول','يقولوا','يقولون','يقولي','يقولنا','يقولن','يقولولي','بيقولكم','بيقولها',
    'بيؤول','بيئول',

    // Male / شتم verbs (past & present)
    'شتم','شتمت','شتمني','شتمنا','شتمتك','شتمتني','شتمهم','شتمتها','شتمتوا',
    'بيشتم','بيشتمني','بيشتمنا','بيشتمهم','بشتم','بشتمك','بشتمني',

    // Female / general (past & present)
    'قالت','قاليتي','قلتي','قالتلي','قلتلي','قالتلك','قالتلكم','قلتن','قلتهن','قالتلنا','قالتها','قالتهم','قالتهن',
    'تقول','تقولين','تقولوا','تقولن','تقوللي','تقولنا','تقولولي',
    'بتقول','بتقولي','بتقلها','بتقلهم','بتقلنا','بتقولها','بتقولهم','بتقولنا','بتقلني','بتقوله','بتقلك','بتقلن','بتقلكم','بيتقولي','بتقوللي','بتقولوا','بتقولولي',

    // Female / شتم verbs (past & present)
    'شتمت','شتمني','شتمنا','شتمتها','بتشتم','بتشتمني','بتشتمنا'
  ];



  // Split input text into words (case-insensitive)
  const words = text.toLowerCase().split(/\s+/);
  
  // Check if any forbidden word exists in the input
  for (const word of words) {
    if (forbiddenWords.includes(word)) {
      return {
        valid: false,
        error: `❌ Only write the insult without "${word}".\n` +
               `Use the note for extra context.\n` +
               `Example: /blame @user insult: \`dog\` note: \`he says dog when he does XYZ\``
      };               
    }
  }
  
  return { valid: true };
}


/**
 * Validate English insults by rejecting text containing forbidden "say/tell" words
 * or common insulting words. The insult field should contain only the insult itself.
 */
export function validateSayWordEnglish(text: string): { valid: boolean; error?: string } {
  // Skip validation if text contains no English letters
  if (!/[a-zA-Z]/.test(text)) { return { valid: true }; }

  // Most common forbidden words list
  const forbiddenWords = [
    // Say verbs
    'say','says','said','saying',
    // Tell verbs
    'tell','tells','told','telling',
    // Common general insult words
    'insult','insults','insulted','insulting',
    'swear','swears','swore','sworn','swearing',
    'curse','curses','cursed','cursing',
    'abuse','abuses','abused','abusing'
  ];

  // Split input text into words (case-insensitive)
  const words = text.toLowerCase().split(/\s+/);

  // Check if any forbidden word exists in the input
  for (const word of words) {
    if (forbiddenWords.includes(word)) {
      return {
        valid: false,
        error: `❌ Only write the insult without "${word}".\n` +
               `Use the note for extra context.\n` +
               `Example: /blame @user insult: \`dog\` note: \`he says dog when he does XYZ\``
      };      
    }
  }

  return { valid: true };
}

/**
 * Validate insult rules:
 * - Must not be empty
 * - Up to MAX_INSULT_WORDS words
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
  if (words.length > MAX_INSULT_WORDS) {
    throw new Error(`Insult too long. Enter only the insult, no descriptions, no stories, no extra text. Maximum ${MAX_INSULT_WORDS} words allowed.`);
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
 * Scan message for insults using maximum match algorithm:
 * - Store insults (max MAX_INSULT_WORDS words) in a hash set
 * - Split message into words
 * - Scan left to right, and at each position check from longest to shortest word matches
 * - On match, record it and skip ahead by its length
 * - Returns only the maximum matches found
 */
export function scanMessageForMaxMatches(message: string, insultSet: Set<string>): string[] {
  const words = message.trim().split(/\s+/);
  const matches: string[] = [];
  
  for (let i = 0; i < words.length; i++) {
    let matched = false;
    
    // Check from longest to shortest word matches (MAX_INSULT_WORDS down to 1)
    for (let wordCount = MAX_INSULT_WORDS; wordCount >= 1; wordCount--) {
      if (i + wordCount - 1 < words.length) {
        const phrase = canonicalizeInsult(words.slice(i, i + wordCount).join(" "));
        if (insultSet.has(phrase)) {
          matches.push(phrase);
          i += wordCount - 1; // Skip ahead by (wordCount - 1) positions (we'll increment by 1 in the loop)
          matched = true;
          break; // Found a match, no need to check shorter phrases
        }
      }
    }
  }
  
  return matches;
}