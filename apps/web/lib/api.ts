import { coverageLevel, pickLanguage, rankFeed, type CoverageEntry, type FeedStory, type StaticMeta } from "@brief/core";

/** The site's path on its host. Set NEXT_PUBLIC_BASE_PATH when building (see next.config.ts). */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const EXPLORE_HOURS = 36;

/** Fetches a public data file written by the news pipeline. */
async function get<T>(file: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_PATH}/data/${file}`, { signal, cache: "no-cache" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export async function fetchFeed(q: { countries: string[]; topics: string[]; lang: string }, signal?: AbortSignal) {
  const [rows, meta] = await Promise.all([get<FeedStory[]>("stories.json", signal), get<StaticMeta>("meta.json", signal)]);
  const stories = rankFeed(pickLanguage(rows, q.lang), { countries: q.countries, topics: q.topics, now: new Date() });
  const coverage: CoverageEntry[] = q.countries.map((country) => {
    const stories_48h = meta.story_counts_48h[country] ?? 0;
    return { country, stories_48h, level: coverageLevel(stories_48h) };
  });
  return { stories, coverage };
}

export async function fetchExplore(q: { countries: string[]; topics: string[]; lang: string }, signal?: AbortSignal) {
  const rows = await get<FeedStory[]>("stories.json", signal);
  const now = new Date();
  const recent = rows.filter((r) => now.getTime() - Date.parse(r.updated_at) < EXPLORE_HOURS * 3_600_000);
  const stories = rankFeed(pickLanguage(recent, q.lang), { countries: q.countries, topics: q.topics, now }, {
    globalImportanceThreshold: q.countries.length || q.topics.length ? 5 : 1,
  });
  return { stories };
}
