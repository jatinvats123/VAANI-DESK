/**
 * Coarse language tagging for call analytics (`calls.language`) — not used for
 * routing decisions, the prompt handles language mirroring. Heuristic on
 * purpose: fast, deterministic, no model call.
 */

// U+0900–U+097F is the whole Devanagari block. It contains combining marks,
// which the lint rule flags in character classes — here matching them is the
// point: we count Devanagari codepoints, not grapheme clusters.
const DEVANAGARI_RANGE = "\\u0900-\\u097F";
// eslint-disable-next-line no-misleading-character-class -- see above
const DEVANAGARI_RE = new RegExp(`[${DEVANAGARI_RANGE}]`, "gu");
// eslint-disable-next-line no-misleading-character-class -- see above
const NON_WORD_RE = new RegExp(`[^a-z${DEVANAGARI_RANGE}]+`, "u");

const ROMAN_HINDI_HINTS = [
  "hai",
  "haan",
  "nahi",
  "nahin",
  "kya",
  "kal",
  "aaj",
  "baje",
  "karna",
  "chahiye",
  "milega",
  "kitna",
  "kitne",
  "rupaye",
  "shaam",
  "subah",
  "theek",
  "bhaiya",
  "didi",
  "namaste",
  "bol",
  "boliye",
  "kar",
  "do",
  "mein",
  "aap",
];

export type DetectedLanguage = "hindi" | "hinglish" | "english";

export function detectLanguageHint(text: string): DetectedLanguage {
  const trimmed = text.trim();
  if (trimmed === "") return "english";

  const devanagariCount = (trimmed.match(DEVANAGARI_RE) ?? []).length;
  if (devanagariCount / trimmed.length > 0.3) return "hindi";

  const words = trimmed.toLowerCase().split(NON_WORD_RE).filter(Boolean);
  if (words.length === 0) return "english";
  const hindiHits = words.filter((word) => ROMAN_HINDI_HINTS.includes(word)).length;
  return hindiHits / words.length >= 0.15 ? "hinglish" : "english";
}

/** Dominant language across a call's caller turns. */
export function dominantLanguage(turnTexts: string[]): DetectedLanguage {
  const counts: Record<DetectedLanguage, number> = { hindi: 0, hinglish: 0, english: 0 };
  for (const text of turnTexts) counts[detectLanguageHint(text)]++;
  if (counts.hindi === 0 && counts.hinglish === 0) return "english";
  return (Object.entries(counts) as Array<[DetectedLanguage, number]>).sort(
    (a, b) => b[1] - a[1],
  )[0]![0];
}
