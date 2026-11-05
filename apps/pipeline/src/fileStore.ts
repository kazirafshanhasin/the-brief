import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceConfig } from "./config";
import type { NewArticle } from "./normalize";
import { MemoryStore, type HealthRow, type SummaryRow } from "./store";

const DAY_MS = 86_400_000;
export const KEEP_STORY_DAYS = 7;
const KEEP_AI_USAGE_DAYS = 90;
/** Same window as the recent_story_articles view: new reports join stories from the last 48 hours. */
const RECENT_MS = 48 * 3_600_000;

export interface SourceHealth {
  source_id: string;
  last_fetch_at: string;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
  accepted_count: number;
  accepted_total: number;
}

export type AiUsage = Record<string, { calls: number; input: number; output: number }>;

/**
 * Store for GitHub-only static mode: the working state lives in JSON files in `dir` (the news-data
 * branch). Changes stay in memory until save(), so a run that crashes leaves the files untouched.
 */
export class FileStore extends MemoryStore {
  sourceHealth = new Map<string, SourceHealth>();
  aiUsage: AiUsage = {};

  constructor(private readonly dir: string, private readonly now: () => Date = () => new Date()) {
    super();
    for (const s of this.read<SourceConfig[]>("sources.json", [])) this.sources.set(s.id, s);
    for (const a of this.read<NewArticle[]>("articles.json", [])) this.articles.set(a.id, a);
    this.links = new Map(Object.entries(this.read<Record<string, string>>("links.json", {})));
    for (const c of this.read<(Record<string, unknown> & { id: string; language: string; first_seen_at: string })[]>("clusters.json", [])) this.clusters.set(c.id, c);
    for (const s of this.read<SummaryRow[]>("summaries.json", [])) this.summaries.set(`${s.story_id}:${s.language}`, s);
    for (const h of this.read<SourceHealth[]>("source_health.json", [])) this.sourceHealth.set(h.source_id, h);
    this.aiUsage = this.read<AiUsage>("ai_usage.json", {});
  }

  // A corrupt file throws on purpose: starting empty would overwrite days of stories.
  private read<T>(name: string, fallback: T): T {
    const path = join(this.dir, name);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
  }

  save() {
    mkdirSync(this.dir, { recursive: true });
    const files: Record<string, unknown> = {
      "sources.json": [...this.sources.values()],
      "articles.json": [...this.articles.values()],
      "links.json": Object.fromEntries(this.links),
      "clusters.json": [...this.clusters.values()],
      "summaries.json": [...this.summaries.values()],
      "source_health.json": [...this.sourceHealth.values()],
      "ai_usage.json": this.aiUsage,
    };
    for (const [name, value] of Object.entries(files)) {
      const path = join(this.dir, name);
      writeFileSync(`${path}.tmp`, JSON.stringify(value));
      renameSync(`${path}.tmp`, path);
    }
  }

  override async recordSourceHealth(rows: HealthRow[]) {
    const now = this.now().toISOString();
    for (const r of rows) {
      const prev = this.sourceHealth.get(r.source_id);
      this.sourceHealth.set(r.source_id, {
        source_id: r.source_id,
        last_fetch_at: now,
        last_success_at: r.ok ? now : (prev?.last_success_at ?? null),
        last_error: r.ok ? null : (r.error?.slice(0, 500) ?? "error"),
        consecutive_errors: r.ok ? 0 : (prev?.consecutive_errors ?? 0) + 1,
        accepted_count: r.accepted,
        accepted_total: (prev?.accepted_total ?? 0) + r.accepted,
      });
    }
  }

  override async recentStoryArticles() {
    const cutoff = this.now().getTime() - RECENT_MS;
    return (await super.recentStoryArticles()).filter((a) => Date.parse(a.published_at) > cutoff);
  }

  private today() {
    return this.now().toISOString().slice(0, 10);
  }

  override async aiCallsToday() {
    return this.aiUsage[this.today()]?.calls ?? 0;
  }

  override async recordAiUsage(calls: number, input = 0, output = 0) {
    if (calls === 0) return;
    const day = (this.aiUsage[this.today()] ??= { calls: 0, input: 0, output: 0 });
    day.calls += calls;
    day.input += input;
    day.output += output;
  }

  /** Prunes stories not updated for KEEP_STORY_DAYS, with their reports and summaries. */
  override async cleanup() {
    const now = this.now().getTime();
    const cutoff = now - KEEP_STORY_DAYS * DAY_MS;
    let stories = 0;
    for (const c of this.clusters.values()) {
      if (Date.parse(String(c.updated_at ?? c.first_seen_at)) >= cutoff) continue;
      this.clusters.delete(c.id);
      stories++;
    }
    for (const [key, s] of this.summaries) if (!this.clusters.has(s.story_id)) this.summaries.delete(key);
    for (const [articleId, storyId] of this.links) {
      if (this.clusters.has(storyId)) continue;
      this.links.delete(articleId);
      this.articles.delete(articleId);
    }
    for (const a of this.articles.values()) {
      if (!this.links.has(a.id) && Date.parse(a.published_at) < cutoff) this.articles.delete(a.id);
    }
    const usedSources = new Set([...this.articles.values()].map((a) => a.source_id));
    for (const s of this.sources.values()) {
      if (s.status === "discovered" && !usedSources.has(s.id)) this.sources.delete(s.id);
    }
    const usageCutoff = new Date(now - KEEP_AI_USAGE_DAYS * DAY_MS).toISOString().slice(0, 10);
    for (const day of Object.keys(this.aiUsage)) if (day < usageCutoff) delete this.aiUsage[day];
    return { stories };
  }
}
