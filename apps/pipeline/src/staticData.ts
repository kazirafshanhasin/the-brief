import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REFERENCE_LANGUAGE, type FeedStory, type StaticMeta, type StaticStoryDetail, type StorySource, type TopicId } from "@brief/core";
import type { MemoryStore } from "./store";

const HOUR_MS = 3_600_000;
const FEED_HOURS = 48;
const RELATED_HOURS = 72;
const MAX_SOURCES = 20;
const MAX_RELATED = 5;

export interface StaticData {
  /** One row per story and approved language, from the last 48 hours. */
  stories: FeedStory[];
  /** Every story still kept, so saved and shared links work until the story is pruned. */
  details: StaticStoryDetail[];
  meta: StaticMeta;
}

const list = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
const overlaps = (a: string[], b: string[]) => a.some((x) => b.includes(x));

/** The public files' content, using the same joins and windows as the feed_items view and the API. */
export function buildStaticData(store: MemoryStore, now: Date): StaticData {
  const articlesByStory = new Map<string, string[]>();
  for (const [articleId, storyId] of store.links) articlesByStory.set(storyId, [...(articlesByStory.get(storyId) ?? []), articleId]);

  const rows: FeedStory[] = [];
  const sourcesByStory = new Map<string, StorySource[]>();
  for (const c of store.clusters.values()) {
    const versions = [...store.summaries.values()].filter((s) => s.story_id === c.id && s.validation_status === "approved");
    if (versions.length === 0) continue;

    const reports = (articlesByStory.get(c.id) ?? []).flatMap((id) => {
      const article = store.articles.get(id);
      return article ? [{ article, source: store.sources.get(article.source_id) }] : [];
    });
    const primary = [...reports].sort(
      (a, b) => (b.source?.trust_score ?? 0) - (a.source?.trust_score ?? 0) || a.article.published_at.localeCompare(b.article.published_at),
    )[0];
    const hostname = (url: string) => new URL(url).hostname;
    sourcesByStory.set(
      c.id,
      reports
        .map(({ article: a, source: s }) => ({
          name: s?.name ?? hostname(a.url),
          domain: s?.domain ?? hostname(a.url),
          country: s?.country ?? null,
          url: a.url,
          headline: a.headline,
          published_at: a.published_at,
        }))
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
        .slice(0, MAX_SOURCES),
    );

    for (const v of versions) {
      rows.push({
        id: c.id,
        headline: v.headline,
        summary: v.summary,
        kind: v.kind,
        language: v.language,
        event_countries: list<string>(c.event_countries),
        affected_countries: list<string>(c.affected_countries),
        topics: list<TopicId>(c.topics),
        importance: Number(c.importance ?? 1),
        source_count: Number(c.source_count ?? 1),
        source_confidence: Number(c.source_confidence ?? 0),
        first_seen_at: c.first_seen_at,
        updated_at: String(c.updated_at ?? c.first_seen_at),
        // Nothing sends alerts in static mode, so a story that passed the breaking rules stays "approved".
        is_breaking: c.breaking_status === "approved" || c.breaking_status === "sent",
        primary_source: primary
          ? { name: primary.source?.name ?? hostname(primary.article.url), url: primary.article.url, country: primary.source?.country ?? null }
          : null,
      });
    }
  }
  rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const feedCutoff = now.getTime() - FEED_HOURS * HOUR_MS;
  const relatedCutoff = now.getTime() - RELATED_HOURS * HOUR_MS;
  const stories = rows.filter((r) => Date.parse(r.updated_at) > feedCutoff);

  const story_counts_48h: Record<string, number> = {};
  for (const id of new Set(stories.map((s) => s.id))) {
    for (const country of stories.find((s) => s.id === id)!.event_countries) story_counts_48h[country] = (story_counts_48h[country] ?? 0) + 1;
  }

  const rowsByStory = new Map<string, FeedStory[]>();
  for (const r of rows) rowsByStory.set(r.id, [...(rowsByStory.get(r.id) ?? []), r]);

  const details = [...rowsByStory.entries()].map(([id, versions]): StaticStoryDetail => {
    const base = versions.find((v) => v.language === REFERENCE_LANGUAGE) ?? versions[0]!;
    const related = rows
      .filter(
        (r) =>
          r.id !== id &&
          r.language === base.language &&
          Date.parse(r.updated_at) >= relatedCutoff &&
          overlaps(r.event_countries, base.event_countries) &&
          overlaps(r.topics, base.topics),
      )
      .slice(0, MAX_RELATED)
      .map((r) => ({ id: r.id, headline: r.headline, updated_at: r.updated_at }));
    return {
      ...base,
      sources: sourcesByStory.get(id) ?? [],
      related,
      versions: versions.map((v) => ({ language: v.language, headline: v.headline, summary: v.summary, kind: v.kind })),
    };
  });

  return { stories, details, meta: { generated_at: now.toISOString(), story_counts_48h } };
}

/** Writes stories.json, meta.json and story/<id>.json. Files of pruned stories are removed. */
export function writeStaticData(dir: string, data: StaticData) {
  const storyDir = join(dir, "story");
  rmSync(storyDir, { recursive: true, force: true });
  mkdirSync(storyDir, { recursive: true });
  writeFileSync(join(dir, "stories.json"), JSON.stringify(data.stories));
  writeFileSync(join(dir, "meta.json"), JSON.stringify(data.meta));
  for (const d of data.details) writeFileSync(join(storyDir, `${d.id}.json`), JSON.stringify(d));
}
