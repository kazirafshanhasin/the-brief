import { splitSentences } from "./text";

export interface SummaryCheck {
  ok: boolean;
  errors: string[];
}

export const SUMMARY_RULES = {
  minSentences: 2,
  maxSentences: 4,
  maxWords: 110,
  maxWordsPerSentence: 45,
  maxHeadlineWords: 16,
  /** Minimum authorized source text (characters) before a full summary may be written. */
  minSourceChars: 280,
} as const;

/** Whether a cluster has enough authorized text to summarize, else it becomes headline-only. */
export function hasEnoughSourceText(texts: string[]): boolean {
  return texts.join(" ").trim().length >= SUMMARY_RULES.minSourceChars;
}

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.$/, ""));
}

/**
 * Deterministic checks run on every AI summary before it is published:
 * shape (2–4 sentences, length), no links/first-person/meta talk, and every number in the
 * summary must appear in the authorized source text (a cheap guard against invented facts).
 */
export function validateSummary(headline: string, summary: string, sourceText: string): SummaryCheck {
  const errors: string[] = [];
  const sentences = splitSentences(summary);
  if (sentences.length < SUMMARY_RULES.minSentences || sentences.length > SUMMARY_RULES.maxSentences) {
    errors.push(`summary has ${sentences.length} sentences (needs ${SUMMARY_RULES.minSentences}–${SUMMARY_RULES.maxSentences})`);
  }
  const words = summary.trim().split(/\s+/).filter(Boolean).length;
  if (words > SUMMARY_RULES.maxWords) errors.push(`summary too long (${words} words)`);
  for (const s of sentences) {
    if (s.split(/\s+/).length > SUMMARY_RULES.maxWordsPerSentence) {
      errors.push("a sentence is too long");
      break;
    }
  }
  const hw = headline.trim().split(/\s+/).filter(Boolean).length;
  if (hw === 0 || hw > SUMMARY_RULES.maxHeadlineWords) errors.push(`headline must be 1–${SUMMARY_RULES.maxHeadlineWords} words`);

  const both = `${headline} ${summary}`;
  if (/https?:\/\/|www\./i.test(both)) errors.push("contains a link");
  if (/\b(I|we|our|us)\b/.test(summary.replace(/\bU\.?S\.?\b/g, ""))) errors.push("uses first person");
  if (/\b(this article|the article|the report says|as an ai|summary:)\b/i.test(both)) errors.push("meta commentary");

  const sourceNumbers = new Set(numbersIn(sourceText));
  const missing = numbersIn(both).filter((n) => !sourceNumbers.has(n));
  if (missing.length > 0) errors.push(`numbers not found in sources: ${[...new Set(missing)].join(", ")}`);

  return { ok: errors.length === 0, errors };
}
