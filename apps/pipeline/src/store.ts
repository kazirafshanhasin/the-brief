import { SupabaseRest, inList, type ClusterableArticle } from "@brief/core";
import type { SourceConfig } from "./config";
import type { NewArticle } from "./normalize";
import type { ClusterArticle, ClusterState } from "./stats";

export interface SummaryRow {
  story_id: string;
  language: string;
  headline: string;
  summary: string | null;
  kind: "summary" | "headline_only";
  validation_status: "approved" | "rejected" | "pending";
  validation_errors: string[];
  model: string | null;
}

export interface HealthRow {
  source_id: string;
  ok: boolean;
  error?: string;
  accepted: number;
}

export interface Store {
  syncSources(sources: SourceConfig[], mode: "merge" | "ignore"): Promise<void>;
  recordSourceHealth(rows: HealthRow[]): Promise<void>;
  existingUrls(urls: string[]): Promise<Set<string>>;
  insertArticles(rows: NewArticle[]): Promise<void>;
  recentStoryArticles(): Promise<ClusterableArticle[]>;
  createClusters(rows: { id: string; language: string; first_seen_at: string }[]): Promise<void>;
  linkArticles(pairs: { story_id: string; article_id: string }[]): Promise<void>;
  loadClusters(ids: string[]): Promise<ClusterState[]>;
  updateCluster(id: string, patch: Record<string, unknown>): Promise<void>;
  summaryLanguages(ids: string[]): Promise<Map<string, { language: string; kind: string; headline: string; summary: string | null }[]>>;
  upsertSummary(row: SummaryRow): Promise<void>;
  aiCallsToday(): Promise<number>;
  recordAiUsage(calls: number, input: number, output: number): Promise<void>;
  cleanup(): Promise<unknown>;
}

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

interface RawCluster {
  id: string;
  language: string;
  first_seen_at: string;
  importance: number;
  sensitive: boolean;
  breaking_status: string;
  summarized_article_count: number;
  story_sources: { articles: (Omit<ClusterArticle, "source"> & { sources: ClusterArticle["source"] }) | null }[];
}

export class SupabaseStore implements Store {
  constructor(private readonly db: SupabaseRest) {}

  async syncSources(sources: SourceConfig[], mode: "merge" | "ignore") {
    if (sources.length === 0) return;
    const rows = sources.map((s) => ({
      id: s.id, name: s.name, domain: s.domain, country: s.country, language: s.language, feed_url: s.feed_url,
      default_topic: s.default_topic, owner: s.owner, official: Boolean(s.official), rights: s.rights,
      trust_score: s.trust_score, status: s.status, terms_checked: s.terms_checked, updated_at: new Date().toISOString(),
    }));
    for (const part of chunk(rows, 200)) await this.db.insert("sources", part, { onConflict: "id", resolution: mode });
  }

  async recordSourceHealth(rows: HealthRow[]) {
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.source_id);
    const prev = await this.db.select<{ source_id: string; consecutive_errors: number; accepted_total: number }>(
      "source_health",
      `select=source_id,consecutive_errors,accepted_total&source_id=in.${inList(ids)}`,
    );
    const byId = new Map(prev.map((p) => [p.source_id, p]));
    const now = new Date().toISOString();
    const out = rows.map((r) => {
      const p = byId.get(r.source_id);
      return {
        source_id: r.source_id,
        last_fetch_at: now,
        ...(r.ok ? { last_success_at: now, last_error: null } : { last_error: r.error?.slice(0, 500) ?? "error" }),
        consecutive_errors: r.ok ? 0 : (p?.consecutive_errors ?? 0) + 1,
        accepted_count: r.accepted,
        accepted_total: (p?.accepted_total ?? 0) + r.accepted,
        updated_at: now,
      };
    });
    await this.db.insert("source_health", out, { onConflict: "source_id", resolution: "merge" });
  }

  async existingUrls(urls: string[]) {
    const found = new Set<string>();
    for (const part of chunk(urls, 80)) {
      const rows = await this.db.select<{ canonical_url: string }>("articles", `select=canonical_url&canonical_url=in.${inList(part)}`);
      for (const r of rows) found.add(r.canonical_url);
    }
    return found;
  }

  async insertArticles(rows: NewArticle[]) {
    for (const part of chunk(rows, 200)) await this.db.insert("articles", part, { onConflict: "canonical_url", resolution: "ignore" });
  }

  async recentStoryArticles() {
    const rows = await this.db.select<{ id: string; headline: string; language: string; published_at: string; story_id: string }>(
      "recent_story_articles",
      "select=id,headline,language,published_at,story_id&limit=5000",
    );
    return rows.map((r) => ({ id: r.id, title: r.headline, language: r.language, published_at: r.published_at, cluster_id: r.story_id }));
  }

  async createClusters(rows: { id: string; language: string; first_seen_at: string }[]) {
    for (const part of chunk(rows, 200)) await this.db.insert("story_clusters", part.map((r) => ({ ...r, updated_at: r.first_seen_at })));
  }

  async linkArticles(pairs: { story_id: string; article_id: string }[]) {
    for (const part of chunk(pairs, 200)) await this.db.insert("story_sources", part, { onConflict: "article_id", resolution: "ignore" });
  }

  async loadClusters(ids: string[]) {
    const out: ClusterState[] = [];
    const select =
      "id,language,first_seen_at,importance,sensitive,breaking_status,summarized_article_count," +
      "story_sources(articles(id,headline,excerpt,language,url,published_at,publisher_country," +
      "sources(id,name,domain,owner,official,trust_score,rights,status,default_topic)))";
    for (const part of chunk(ids, 50)) {
      const rows = await this.db.select<RawCluster>("story_clusters", `select=${select}&id=in.${inList(part)}`);
      for (const r of rows) {
        out.push({
          id: r.id,
          language: r.language,
          first_seen_at: r.first_seen_at,
          importance: r.importance,
          sensitive: r.sensitive,
          breaking_status: r.breaking_status,
          summarized_article_count: r.summarized_article_count,
          articles: r.story_sources
            .map((s) => s.articles)
            .filter((a): a is NonNullable<typeof a> => a !== null)
            .map(({ sources, ...a }) => ({ ...a, source: sources })),
        });
      }
    }
    return out;
  }

  async updateCluster(id: string, patch: Record<string, unknown>) {
    await this.db.update("story_clusters", `id=eq.${id}`, patch);
  }

  async summaryLanguages(ids: string[]) {
    const map = new Map<string, { language: string; kind: string; headline: string; summary: string | null }[]>();
    for (const part of chunk(ids, 80)) {
      const rows = await this.db.select<{ story_id: string; language: string; kind: string; headline: string; summary: string | null }>(
        "summaries",
        `select=story_id,language,kind,headline,summary&validation_status=eq.approved&story_id=in.${inList(part)}`,
      );
      for (const r of rows) map.set(r.story_id, [...(map.get(r.story_id) ?? []), r]);
    }
    return map;
  }

  async upsertSummary(row: SummaryRow) {
    await this.db.insert("summaries", { ...row, updated_at: new Date().toISOString() }, { onConflict: "story_id,language", resolution: "merge" });
  }

  async aiCallsToday() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.db.select<{ calls: number }>("ai_usage", `select=calls&day=eq.${today}`);
    return rows[0]?.calls ?? 0;
  }

  async recordAiUsage(calls: number, input: number, output: number) {
    if (calls === 0) return;
    await this.db.rpc("record_ai_usage", { p_calls: calls, p_input: input, p_output: output });
  }

  cleanup() {
    return this.db.rpc("cleanup_old_content");
  }
}

/** In-memory store for --dry-run and tests. */
export class MemoryStore implements Store {
  sources = new Map<string, SourceConfig>();
  health: HealthRow[] = [];
  articles = new Map<string, NewArticle>();
  links = new Map<string, string>(); // article → story
  clusters = new Map<string, Record<string, unknown> & { id: string; language: string; first_seen_at: string }>();
  summaries = new Map<string, SummaryRow>();
  aiCalls = 0;

  async syncSources(sources: SourceConfig[], mode: "merge" | "ignore") {
    for (const s of sources) if (mode === "merge" || !this.sources.has(s.id)) this.sources.set(s.id, s);
  }
  async recordSourceHealth(rows: HealthRow[]) {
    this.health.push(...rows);
  }
  async existingUrls(urls: string[]) {
    const all = new Set([...this.articles.values()].map((a) => a.canonical_url));
    return new Set(urls.filter((u) => all.has(u)));
  }
  async insertArticles(rows: NewArticle[]) {
    for (const r of rows) this.articles.set(r.id, r);
  }
  async recentStoryArticles() {
    return [...this.links.entries()].map(([aid, sid]) => {
      const a = this.articles.get(aid)!;
      return { id: a.id, title: a.headline, language: a.language, published_at: a.published_at, cluster_id: sid };
    });
  }
  async createClusters(rows: { id: string; language: string; first_seen_at: string }[]) {
    for (const r of rows) this.clusters.set(r.id, { importance: 1, sensitive: false, breaking_status: "none", summarized_article_count: 0, ...r });
  }
  async linkArticles(pairs: { story_id: string; article_id: string }[]) {
    for (const p of pairs) this.links.set(p.article_id, p.story_id);
  }
  async loadClusters(ids: string[]) {
    return ids.flatMap((id) => {
      const c = this.clusters.get(id);
      if (!c) return [];
      const articles: ClusterArticle[] = [...this.links.entries()]
        .filter(([, sid]) => sid === id)
        .map(([aid]) => {
          const a = this.articles.get(aid)!;
          const s = this.sources.get(a.source_id);
          return {
            id: a.id, headline: a.headline, excerpt: a.excerpt, language: a.language, url: a.url,
            published_at: a.published_at, publisher_country: a.publisher_country,
            source: s ? { id: s.id, name: s.name, domain: s.domain, owner: s.owner, official: Boolean(s.official), trust_score: s.trust_score, rights: s.rights, status: s.status, default_topic: s.default_topic } : null,
          };
        });
      return [{
        id, language: c.language, first_seen_at: c.first_seen_at, importance: Number(c.importance ?? 1), sensitive: Boolean(c.sensitive),
        breaking_status: String(c.breaking_status ?? "none"), summarized_article_count: Number(c.summarized_article_count ?? 0), articles,
      }];
    });
  }
  async updateCluster(id: string, patch: Record<string, unknown>) {
    const c = this.clusters.get(id);
    if (c) this.clusters.set(id, { ...c, ...patch });
  }
  async summaryLanguages(ids: string[]) {
    const map = new Map<string, { language: string; kind: string; headline: string; summary: string | null }[]>();
    for (const s of this.summaries.values()) {
      if (ids.includes(s.story_id) && s.validation_status === "approved") map.set(s.story_id, [...(map.get(s.story_id) ?? []), s]);
    }
    return map;
  }
  async upsertSummary(row: SummaryRow) {
    this.summaries.set(`${row.story_id}:${row.language}`, row);
  }
  async aiCallsToday() {
    return this.aiCalls;
  }
  async recordAiUsage(calls: number) {
    this.aiCalls += calls;
  }
  async cleanup(): Promise<unknown> {
    return null;
  }
}
