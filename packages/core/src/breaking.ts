import { jaccard, titleTokens } from "./text";

export interface BreakingArticle {
  domain: string;
  /** Ownership group from the source registry (e.g. two outlets owned by one company). */
  owner?: string | null;
  /** Primary official source (government, central bank, agency) from the registry. */
  official?: boolean;
  excerpt: string;
  published_at: string;
}

export interface BreakingCandidate {
  importance: number;
  sensitive: boolean;
  first_seen_at: string;
  articles: BreakingArticle[];
  already_alerted: boolean;
}

export interface BreakingDecision {
  decision: "send" | "hold" | "reject";
  reasons: string[];
  independent_sources: number;
}

export const BREAKING_RULES = {
  minImportance: 4,
  minIndependentSources: 2,
  /** Newest report must be at most this old. */
  maxAgeMinutes: 120,
  /** The event itself must be new — not an old story picking up coverage. */
  maxEventAgeHours: 6,
  /** Excerpts more similar than this are treated as one syndicated (wire) report. */
  syndicationSimilarity: 0.7,
  dailyCapPerUser: 2,
} as const;

/**
 * Count genuinely independent reports. Same domain or owner counts once, and near-identical
 * excerpts (five outlets running one wire story) count once.
 */
export function independentSourceCount(articles: BreakingArticle[]): number {
  const groups: { key: string; tokens: Set<string> }[] = [];
  for (const a of articles) {
    const key = (a.owner || rootDomain(a.domain)).toLowerCase();
    const tokens = titleTokens(a.excerpt);
    const dup = groups.some(
      (g) => g.key === key || (tokens.size >= 8 && jaccard(g.tokens, tokens) >= BREAKING_RULES.syndicationSimilarity),
    );
    if (!dup) groups.push({ key, tokens });
  }
  return groups.length;
}

export function evaluateBreaking(c: BreakingCandidate, now: Date): BreakingDecision {
  const reasons: string[] = [];
  const independent = independentSourceCount(c.articles);
  const hasOfficial = c.articles.some((a) => a.official);

  if (c.already_alerted) return { decision: "reject", reasons: ["equivalent alert already delivered"], independent_sources: independent };
  if (c.importance < BREAKING_RULES.minImportance) reasons.push(`importance ${c.importance} below ${BREAKING_RULES.minImportance}`);
  if (independent < BREAKING_RULES.minIndependentSources && !hasOfficial) {
    reasons.push(`only ${independent} independent source(s) and no official primary source`);
  }
  const newest = Math.max(...c.articles.map((a) => Date.parse(a.published_at)), 0);
  if ((now.getTime() - newest) / 60_000 > BREAKING_RULES.maxAgeMinutes) reasons.push("no recent report");
  if ((now.getTime() - Date.parse(c.first_seen_at)) / 3_600_000 > BREAKING_RULES.maxEventAgeHours) reasons.push("event is not new");

  if (reasons.length > 0) return { decision: "reject", reasons, independent_sources: independent };
  if (c.sensitive) {
    return {
      decision: "hold",
      reasons: ["sensitive topic (conflict, disaster or disputed claim) — needs editorial review"],
      independent_sources: independent,
    };
  }
  return { decision: "send", reasons: [], independent_sources: independent };
}

export function canSendBreakingToUser(sentToday: number, critical = false): boolean {
  return critical || sentToday < BREAKING_RULES.dailyCapPerUser;
}

function rootDomain(domain: string): string {
  const parts = domain.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  // Handle common second-level public suffixes (co.uk, com.bd, co.jp …).
  const sld = parts[parts.length - 2]!;
  if (["co", "com", "net", "org", "gov", "ac", "edu"].includes(sld) && parts.length >= 3) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}
