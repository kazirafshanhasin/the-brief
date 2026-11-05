import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PipelineConfig, SourceConfig } from "../src/config";
import { loadConfig } from "../src/config";
import { FileStore } from "../src/fileStore";
import type { NewArticle } from "../src/normalize";
import { runPipeline } from "../src/pipeline";
import { buildStaticData, writeStaticData } from "../src/staticData";
import type { SummaryRow } from "../src/store";

const NOW = new Date("2026-11-04T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const tempDir = () => mkdtempSync(join(tmpdir(), "brief-"));

const source = (id: string, extra: Partial<SourceConfig> = {}): SourceConfig => ({
  id, name: id.toUpperCase(), domain: `${id}.example`, country: "BD", language: "en", feed_url: `https://${id}.example/rss`, default_topic: null,
  owner: id, official: false, rights: "headline_excerpt_link", trust_score: 0.8, status: "approved", terms_checked: true, ...extra,
});

const article = (id: string, sourceId: string, at: string): NewArticle => ({
  id, canonical_url: `https://${sourceId}.example/${id}`, url: `https://${sourceId}.example/${id}`, source_id: sourceId, headline: `Headline ${id}`,
  excerpt: null, language: "en", publisher_country: "BD", origin: "rss", published_at: at, metadata: {},
});

const summary = (storyId: string, language = "en", extra: Partial<SummaryRow> = {}): SummaryRow => ({
  story_id: storyId, language, headline: `${storyId} in ${language}`, summary: null, kind: "headline_only", validation_status: "approved", validation_errors: [], model: null, ...extra,
});

/** Adds one story with its reports and approved summary. */
async function addStory(store: FileStore, id: string, at: string, sources: string[], extra: Record<string, unknown> = {}) {
  await store.createClusters([{ id, language: "en", first_seen_at: at }]);
  await store.updateCluster(id, { updated_at: at, event_countries: ["BD"], affected_countries: ["BD"], topics: ["business"], source_count: sources.length, ...extra });
  const articles = sources.map((s, i) => article(`${id}-${i}`, s, at));
  await store.insertArticles(articles);
  await store.linkArticles(articles.map((a) => ({ story_id: id, article_id: a.id })));
  await store.upsertSummary(summary(id));
}

describe("FileStore", () => {
  it("keeps state across runs, so the next run sees nothing new", async () => {
    const dir = tempDir();
    const cfg: PipelineConfig = {
      supabaseUrl: "", supabaseKey: "", dryRun: false, userAgent: "test", translateLanguages: [], sources: [source("one")],
      ai: { provider: "none", apiKey: "", model: "", baseUrl: "", dailyCallCap: 0, maxSummariesPerRun: 0 },
      gdelt: { enabled: false, timespan: "2h", max_records: 10, queries: [] },
    };
    const feed = `<rss version="2.0"><channel><item><title>Dhaka opens new metro line</title><link>https://one.example/a</link><pubDate>${NOW.toUTCString()}</pubDate></item></channel></rss>`;
    let n = 0;
    const run = async () => {
      const store = new FileStore(dir, () => NOW);
      const report = await runPipeline(cfg, {
        store, model: null, now: () => NOW, newId: () => `id${++n}`, log: () => {},
        fetchText: async () => ({ status: 200, text: feed }),
      });
      store.save();
      return { report, store };
    };

    const first = await run();
    expect(first.report).toMatchObject({ new_articles: 1, new_stories: 1, headline_only: 1 });
    const second = await run();
    expect(second.report.new_articles).toBe(0);
    expect(second.store.clusters.size).toBe(1);
    expect([...second.store.summaries.values()][0]).toMatchObject({ kind: "headline_only", summary: null });
    expect(second.store.sourceHealth.get("one")).toMatchObject({ accepted_total: 2, consecutive_errors: 0 });
  });

  it("prunes stories older than 7 days with their reports and summaries", async () => {
    const dir = tempDir();
    const store = new FileStore(dir, () => NOW);
    await store.syncSources([source("one"), source("found", { status: "discovered" })], "merge");
    await addStory(store, "old", hoursAgo(8 * 24), ["one"]);
    await addStory(store, "kept", hoursAgo(6 * 24), ["one"]);

    expect(await store.cleanup()).toEqual({ stories: 1 });
    store.save();

    const reloaded = new FileStore(dir, () => NOW);
    expect([...reloaded.clusters.keys()]).toEqual(["kept"]);
    expect([...reloaded.articles.keys()]).toEqual(["kept-0"]);
    expect([...reloaded.links.values()]).toEqual(["kept"]);
    expect([...reloaded.summaries.keys()]).toEqual(["kept:en"]);
    // An approved source stays; a discovered one no article uses is dropped.
    expect([...reloaded.sources.keys()]).toEqual(["one"]);
  });

  it("only joins new reports to articles from the last 48 hours", async () => {
    const store = new FileStore(tempDir(), () => NOW);
    await addStory(store, "recent", hoursAgo(47), ["one"]);
    await addStory(store, "older", hoursAgo(49), ["one"]);
    expect((await store.recentStoryArticles()).map((a) => a.cluster_id)).toEqual(["recent"]);
  });

  it("counts AI calls per day and failures per source", async () => {
    let now = NOW;
    const store = new FileStore(tempDir(), () => now);
    await store.recordAiUsage(3, 100, 20);
    await store.recordAiUsage(2, 50, 10);
    expect(await store.aiCallsToday()).toBe(5);
    expect(store.aiUsage["2026-11-04"]).toEqual({ calls: 5, input: 150, output: 30 });
    now = new Date("2026-11-05T00:10:00Z");
    expect(await store.aiCallsToday()).toBe(0);

    await store.recordSourceHealth([{ source_id: "one", ok: false, error: "HTTP 500", accepted: 0 }]);
    await store.recordSourceHealth([{ source_id: "one", ok: false, error: "HTTP 500", accepted: 0 }]);
    expect(store.sourceHealth.get("one")).toMatchObject({ consecutive_errors: 2, last_error: "HTTP 500", last_success_at: null });
  });

  it("refuses to start from a corrupt state file", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "clusters.json"), "{not json");
    expect(() => new FileStore(dir)).toThrow();
  });
});

describe("static data writer", () => {
  async function fixture() {
    const store = new FileStore(tempDir(), () => NOW);
    await store.syncSources([source("low", { trust_score: 0.5 }), source("high", { trust_score: 0.9, name: "High Times", country: "GB" })], "merge");
    await addStory(store, "fresh", hoursAgo(2), ["low", "high"], { breaking_status: "approved", importance: 4, source_confidence: 0.7 });
    await store.upsertSummary(summary("fresh", "bn"));
    await store.upsertSummary(summary("fresh", "hi", { validation_status: "rejected" }));
    await addStory(store, "other", hoursAgo(5), ["low"], { breaking_status: "held" });
    await addStory(store, "aged", hoursAgo(60), ["low"]);
    await store.createClusters([{ id: "unsummarized", language: "en", first_seen_at: hoursAgo(1) }]);
    return store;
  }

  it("publishes approved language versions of stories from the last 48 hours", async () => {
    const { stories, meta } = buildStaticData(await fixture(), NOW);
    expect(stories.map((s) => `${s.id}:${s.language}`).sort()).toEqual(["fresh:bn", "fresh:en", "other:en"]);
    expect(meta).toEqual({ generated_at: NOW.toISOString(), story_counts_48h: { BD: 2 } });

    const fresh = stories.find((s) => s.id === "fresh" && s.language === "en")!;
    expect(fresh).toMatchObject({ importance: 4, source_count: 2, source_confidence: 0.7, is_breaking: true, kind: "headline_only", summary: null });
    expect(fresh.primary_source).toEqual({ name: "High Times", url: "https://high.example/fresh-1", country: "GB" });
    expect(stories.find((s) => s.id === "other")!.is_breaking).toBe(false);
  });

  it("writes a detail file for every kept story, with sources, related and versions", async () => {
    const { details } = buildStaticData(await fixture(), NOW);
    expect(details.map((d) => d.id).sort()).toEqual(["aged", "fresh", "other"]);
    const fresh = details.find((d) => d.id === "fresh")!;
    expect(fresh.language).toBe("en");
    expect(fresh.versions.map((v) => v.language).sort()).toEqual(["bn", "en"]);
    expect(fresh.sources.map((s) => s.name).sort()).toEqual(["High Times", "LOW"]);
    expect(fresh.related.map((r) => r.id)).toEqual(["other", "aged"]);
  });

  it("writes the public files and removes files of pruned stories", async () => {
    const dir = tempDir();
    const store = await fixture();
    writeStaticData(dir, buildStaticData(store, NOW));
    expect(existsSync(join(dir, "story", "aged.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).story_counts_48h.BD).toBe(2);
    expect(JSON.parse(readFileSync(join(dir, "stories.json"), "utf8"))).toHaveLength(3);

    store.clusters.delete("aged");
    writeStaticData(dir, buildStaticData(store, NOW));
    expect(existsSync(join(dir, "story", "aged.json"))).toBe(false);
    expect(existsSync(join(dir, "story", "fresh.json"))).toBe(true);
  });
});

describe("static mode config", () => {
  it("needs no Supabase settings and treats empty Actions variables as unset", () => {
    const cfg = loadConfig([], { DATA_DIR: "state", PUBLIC_DATA_DIR: "public", AI_PROVIDER: "", AI_DAILY_CALL_CAP: "", MAX_SUMMARIES_PER_RUN: "" });
    expect(cfg.ai).toMatchObject({ provider: "none", dailyCallCap: 400, maxSummariesPerRun: 40 });
    expect(() => loadConfig([], {})).toThrow(/SUPABASE_URL/);
    expect(() => loadConfig([], { DATA_DIR: "state" })).toThrow(/PUBLIC_DATA_DIR/);
  });
});
