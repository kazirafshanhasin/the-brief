import { REFERENCE_LANGUAGE } from "./languages";
import type { FeedStory } from "./types";

/** One row per story for a reader: their language, else the English reference version, labeled. */
export function pickLanguage(rows: FeedStory[], language: string): FeedStory[] {
  const best = new Map<string, FeedStory>();
  for (const r of rows) {
    if (r.language === language) best.set(r.id, r);
    else if (r.language === REFERENCE_LANGUAGE && !best.has(r.id)) best.set(r.id, { ...r, language_fallback: true });
  }
  return [...best.values()];
}

/** Initial weights from the PRD. Tune with reader feedback. */
export const RANKING_WEIGHTS = {
  topic: 0.35,
  country: 0.25,
  importance: 0.2,
  freshness: 0.15,
  confidence: 0.05,
} as const;

export interface RankingContext {
  countries: string[];
  topics: string[];
  now: Date;
  /** Hours for freshness to halve. */
  freshnessHalfLifeHours?: number;
}

export interface ScoreBreakdown {
  topic: number;
  country: number;
  importance: number;
  freshness: number;
  confidence: number;
  total: number;
  matchesInterests: boolean;
}

const NEUTRAL = 0.5;

export function scoreStory(story: FeedStory, ctx: RankingContext): ScoreBreakdown {
  const topicSet = new Set(ctx.topics);
  const countrySet = new Set(ctx.countries.map((c) => c.toUpperCase()));

  const topicMatch = story.topics.some((t) => topicSet.has(t));
  const topic = topicSet.size === 0 ? NEUTRAL : topicMatch ? 1 : 0;

  const eventMatch = story.event_countries.some((c) => countrySet.has(c));
  const affectedMatch = story.affected_countries.some((c) => countrySet.has(c));
  const country = countrySet.size === 0 ? NEUTRAL : eventMatch ? 1 : affectedMatch ? 0.6 : 0;

  const impNorm = clamp01((story.importance - 1) / 4);
  const breadth = clamp01(Math.log2(Math.max(1, story.source_count)) / 3); // 8+ sources → 1
  const importance = impNorm * 0.7 + breadth * 0.3;

  const ageHours = Math.max(0, (ctx.now.getTime() - Date.parse(story.updated_at)) / 3_600_000);
  const halfLife = ctx.freshnessHalfLifeHours ?? 12;
  const freshness = Math.pow(0.5, ageHours / halfLife);

  const confidence = clamp01(story.source_confidence);

  const w = RANKING_WEIGHTS;
  const total =
    w.topic * topic + w.country * country + w.importance * importance + w.freshness * freshness + w.confidence * confidence;

  // Full match = a chosen country AND a chosen topic. A story matching only one of them still
  // counts when it is reasonably important (importance ≥ 3), so a major Bangladesh story outside
  // the chosen topics, or a big technology story from an unchosen country, is not hidden.
  const countryOk = countrySet.size === 0 || eventMatch || affectedMatch;
  const topicOk = topicSet.size === 0 || topicMatch;
  const matchesInterests = (countryOk && topicOk) || ((countryOk || topicOk) && story.importance >= 3);

  return { topic, country, importance, freshness, confidence, total, matchesInterests };
}

export interface RankOptions {
  limit?: number;
  /** Importance threshold for stories outside the user's interests to still appear. */
  globalImportanceThreshold?: number;
  /** At most one out-of-interest global story per this many feed slots. */
  globalEvery?: number;
}

/**
 * Rank a candidate set for one reader:
 * 1. keep stories matching interests, plus major global developments (importance ≥ threshold);
 * 2. score with the PRD weights;
 * 3. greedy re-rank with a diversity penalty so one country or topic cannot dominate;
 * 4. cap out-of-interest global stories.
 */
export function rankFeed(stories: FeedStory[], ctx: RankingContext, opts: RankOptions = {}): FeedStory[] {
  const limit = opts.limit ?? 30;
  const threshold = opts.globalImportanceThreshold ?? 4;
  const globalEvery = opts.globalEvery ?? 6;

  // Consolidate duplicates defensively (same id can arrive from two queries).
  const unique = new Map<string, FeedStory>();
  for (const s of stories) if (!unique.has(s.id)) unique.set(s.id, s);

  type Cand = { story: FeedStory; score: ScoreBreakdown };
  const pool: Cand[] = [];
  for (const story of unique.values()) {
    const score = scoreStory(story, ctx);
    if (score.matchesInterests || story.importance >= threshold) pool.push({ story, score });
  }

  const picked: Cand[] = [];
  let globalCount = 0;
  while (picked.length < limit && pool.length > 0) {
    const recent = picked.slice(-5);
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]!;
      if (!c.score.matchesInterests && globalCount >= Math.floor(picked.length / globalEvery) + 1) continue;
      const pc = c.story.event_countries[0];
      const pt = c.story.topics[0];
      const sameCountry = pc ? recent.filter((r) => r.story.event_countries[0] === pc).length : 0;
      const sameTopic = pt ? recent.filter((r) => r.story.topics[0] === pt).length : 0;
      const adjusted = c.score.total * Math.pow(0.85, sameCountry) * Math.pow(0.9, sameTopic);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const [chosen] = pool.splice(bestIdx, 1);
    if (!chosen) break;
    if (!chosen.score.matchesInterests) globalCount++;
    picked.push(chosen);
  }
  return picked.map((p) => p.story);
}

/** Top three for a scheduled digest: interest-matching stories only, never headline-only. */
export function pickDigest(stories: FeedStory[], ctx: RankingContext, count = 3): FeedStory[] {
  return rankFeed(
    stories.filter((s) => s.kind === "summary"),
    ctx,
    { limit: count * 3, globalImportanceThreshold: 5 },
  ).slice(0, count);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}
