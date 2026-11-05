import {
  REFERENCE_LANGUAGE,
  SupabaseRest,
  coverageLevel,
  inList,
  pgArray,
  type CoverageEntry,
  type FeedStory,
  type StoryDetail,
  type TopicId,
} from "@brief/core";

export interface FeedRow {
  id: string;
  language: string;
  headline: string;
  summary: string | null;
  kind: "summary" | "headline_only";
  event_countries: string[];
  affected_countries: string[];
  topics: TopicId[];
  importance: number;
  source_count: number;
  source_confidence: number | string;
  first_seen_at: string;
  updated_at: string;
  is_breaking: boolean;
  primary_source_name: string | null;
  primary_source_url: string | null;
  primary_source_country: string | null;
}

const FEED_COLUMNS =
  "id,language,headline,summary,kind,event_countries,affected_countries,topics,importance,source_count,source_confidence,first_seen_at,updated_at,is_breaking,primary_source_name,primary_source_url,primary_source_country";

export function toFeedStory(r: FeedRow, fallback = false): FeedStory {
  return {
    id: r.id,
    headline: r.headline,
    summary: r.summary,
    kind: r.kind,
    language: r.language,
    ...(fallback ? { language_fallback: true } : {}),
    event_countries: r.event_countries,
    affected_countries: r.affected_countries,
    topics: r.topics,
    importance: r.importance,
    source_count: r.source_count,
    source_confidence: Number(r.source_confidence),
    first_seen_at: r.first_seen_at,
    updated_at: r.updated_at,
    is_breaking: r.is_breaking,
    primary_source: r.primary_source_url
      ? { name: r.primary_source_name ?? new URL(r.primary_source_url).hostname, url: r.primary_source_url, country: r.primary_source_country }
      : null,
  };
}

export interface CandidateQuery {
  countries: string[];
  topics: string[];
  language: string;
  hours?: number;
  limit?: number;
}

/**
 * Candidates for one reader (SQL function feed_candidates): stories matching any selected
 * country/topic, plus major stories from anywhere. Stories missing in the reader's language
 * fall back to the English reference version.
 */
export async function loadCandidates(db: SupabaseRest, q: CandidateQuery): Promise<FeedStory[]> {
  const langs = q.language === REFERENCE_LANGUAGE ? [q.language] : [q.language, REFERENCE_LANGUAGE];
  const results = await Promise.all(
    langs.map((lang) =>
      db.rpc<FeedRow[]>("feed_candidates", {
        p_language: lang,
        p_countries: q.countries,
        p_topics: q.topics,
        p_hours: q.hours ?? 48,
        p_limit: q.limit ?? 250,
      }),
    ),
  );
  const byId = new Map<string, FeedStory>();
  results.forEach((rows, i) => {
    const lang = langs[i]!;
    for (const r of rows) {
      if (byId.has(r.id)) continue;
      byId.set(r.id, toFeedStory(r, lang !== q.language));
    }
  });
  return [...byId.values()];
}

export async function loadStoriesByIds(db: SupabaseRest, ids: string[], language: string): Promise<FeedStory[]> {
  if (ids.length === 0) return [];
  const langs = [...new Set([language, REFERENCE_LANGUAGE])];
  const rows = await db.select<FeedRow>("feed_items", `select=${FEED_COLUMNS}&id=in.${inList(ids)}&language=in.${inList(langs)}`);
  const best = new Map<string, FeedStory>();
  for (const r of rows) {
    const existing = best.get(r.id);
    if (!existing || r.language === language) best.set(r.id, toFeedStory(r, r.language !== language));
  }
  return ids.flatMap((id) => (best.has(id) ? [best.get(id)!] : []));
}

interface SourceRow {
  articles: {
    url: string;
    headline: string;
    published_at: string;
    sources: { name: string; domain: string; country: string | null } | null;
  } | null;
}

export async function loadStoryDetail(db: SupabaseRest, id: string, language: string): Promise<StoryDetail | null> {
  const [story] = await loadStoriesByIds(db, [id], language);
  if (!story) return null;
  const sourceRows = await db.select<SourceRow>(
    "story_sources",
    `select=articles(url,headline,published_at,sources(name,domain,country))&story_id=eq.${id}&limit=20`,
  );
  const sources = sourceRows
    .map((r) => r.articles)
    .filter((a): a is NonNullable<SourceRow["articles"]> => a !== null)
    .map((a) => ({
      name: a.sources?.name ?? new URL(a.url).hostname,
      domain: a.sources?.domain ?? new URL(a.url).hostname,
      country: a.sources?.country ?? null,
      url: a.url,
      headline: a.headline,
      published_at: a.published_at,
    }))
    .sort((a, b) => b.published_at.localeCompare(a.published_at));

  // Related coverage: other recent stories sharing an event country and a topic.
  let related: StoryDetail["related"] = [];
  if (story.event_countries.length && story.topics.length) {
    const rows = await db.select<{ id: string; headline: string; updated_at: string }>(
      "feed_items",
      `select=id,headline,updated_at&language=eq.${encodeURIComponent(story.language)}&id=neq.${id}` +
        `&event_countries=ov.${pgArray(story.event_countries)}&topics=ov.${pgArray(story.topics)}` +
        `&updated_at=gte.${new Date(Date.now() - 72 * 3_600_000).toISOString()}&order=updated_at.desc&limit=5`,
    );
    related = rows;
  }
  return { ...story, sources, related };
}

export async function loadCoverage(db: SupabaseRest, countries: string[]): Promise<CoverageEntry[]> {
  if (countries.length === 0) return [];
  const rows = await db.rpc<{ country: string; stories_48h: number }[]>("coverage_counts", { p_countries: countries });
  return rows.map((r) => ({ country: r.country, stories_48h: r.stories_48h, level: coverageLevel(r.stories_48h) }));
}
