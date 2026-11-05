import { REFERENCE_LANGUAGE, assignClusters, evaluateBreaking } from "@brief/core";
import { translateBrief, writeBrief, type ModelCall } from "./ai";
import type { PipelineConfig, SourceConfig } from "./config";
import { gdeltUrl, parseFeed, parseGdelt } from "./feeds";
import { mapLimit } from "./http";
import { dedupeBatch, normalizeFeedItem, normalizeGdelt, type NewArticle } from "./normalize";
import {
  authorizedExcerpts,
  canPublishHeadlineOnly,
  canSummarize,
  computeClusterStats,
  needsSummary,
  type ClusterState,
  type ClusterStats,
} from "./stats";
import type { HealthRow, Store } from "./store";

export interface PipelineDeps {
  store: Store;
  model: ModelCall | null;
  fetchText: (url: string, kind: "feed" | "gdelt") => Promise<{ status: number; text: string }>;
  now: () => Date;
  newId: () => string;
  log: (msg: string) => void;
}

export interface PipelineReport {
  sources_fetched: number;
  source_errors: { id: string; error: string }[];
  items_seen: number;
  new_articles: number;
  new_stories: number;
  stories_touched: number;
  summaries_written: number;
  headline_only: number;
  summaries_failed: number;
  translations: number;
  breaking_approved: number;
  breaking_held: number;
  ai_calls: number;
  ai_budget_exhausted: boolean;
}

export async function runPipeline(cfg: PipelineConfig, deps: PipelineDeps): Promise<PipelineReport> {
  const { store, log } = deps;
  const now = deps.now();
  const report: PipelineReport = {
    sources_fetched: 0, source_errors: [], items_seen: 0, new_articles: 0, new_stories: 0, stories_touched: 0,
    summaries_written: 0, headline_only: 0, summaries_failed: 0, translations: 0, breaking_approved: 0,
    breaking_held: 0, ai_calls: 0, ai_budget_exhausted: false,
  };

  // 1. Source registry ---------------------------------------------------------------
  await store.syncSources(cfg.sources, "merge");
  const unchecked = cfg.sources.filter((s) => s.status === "approved" && !s.terms_checked);
  if (unchecked.length) log(`⚠ ${unchecked.length} approved source(s) have terms_checked=false — review before public launch.`);
  const approved = cfg.sources.filter((s) => s.status === "approved" && s.feed_url);

  // 2. Discover: RSS -----------------------------------------------------------------
  const collected: NewArticle[] = [];
  const health: HealthRow[] = [];
  await mapLimit(approved, 4, async (source: SourceConfig) => {
    try {
      const res = await deps.fetchText(source.feed_url!, "feed");
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      const items = parseFeed(res.text);
      report.items_seen += items.length;
      let accepted = 0;
      for (const item of items) {
        const a = normalizeFeedItem(item, source, now, deps.newId);
        if (a) {
          collected.push(a);
          accepted++;
        }
      }
      health.push({ source_id: source.id, ok: true, accepted });
      report.sources_fetched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.source_errors.push({ id: source.id, error: msg });
      health.push({ source_id: source.id, ok: false, error: msg, accepted: 0 });
    }
  });

  // 2b. Discover: GDELT (sequential, ≥5 s apart — enforced by fetchText for the gdelt kind) ----
  if (cfg.gdelt.enabled) {
    const byDomain = new Map(cfg.sources.map((s) => [s.domain, s]));
    const discovered = new Map<string, SourceConfig>();
    for (const q of cfg.gdelt.queries) {
      try {
        const res = await deps.fetchText(gdeltUrl(q, cfg.gdelt.timespan, cfg.gdelt.max_records), "gdelt");
        const hits = parseGdelt(res.text);
        report.items_seen += hits.length;
        for (const h of hits) {
          const n = normalizeGdelt(h, byDomain, now, deps.newId);
          if (!n) continue;
          collected.push(n.article);
          if (n.discovered) discovered.set(n.discovered.id, n.discovered);
        }
      } catch (err) {
        report.source_errors.push({ id: `gdelt:${q}`, error: err instanceof Error ? err.message : String(err) });
      }
    }
    // Discovered publishers are registered but never auto-approved.
    await store.syncSources([...discovered.values()], "ignore");
  }
  await store.recordSourceHealth(health);

  // 3. Normalize + dedupe ------------------------------------------------------------
  const batch = dedupeBatch(collected);
  const existing = await store.existingUrls(batch.map((a) => a.canonical_url));
  const fresh = batch.filter((a) => !existing.has(a.canonical_url));
  await store.insertArticles(fresh);
  report.new_articles = fresh.length;
  log(`Discovered ${report.items_seen} items, ${fresh.length} new articles from ${report.sources_fetched} feeds.`);

  // 4. Cluster ------------------------------------------------------------------------
  const recent = await store.recentStoryArticles();
  const newClusterIds = new Set<string>();
  const assignment = assignClusters(
    [...recent, ...fresh.map((a) => ({ id: a.id, title: a.headline, language: a.language, published_at: a.published_at }))],
    {
      newId: () => {
        const id = deps.newId();
        newClusterIds.add(id);
        return id;
      },
    },
  );
  const firstSeen = new Map<string, { language: string; at: string }>();
  for (const a of fresh) {
    const cid = assignment.get(a.id);
    if (cid && newClusterIds.has(cid)) {
      const prev = firstSeen.get(cid);
      if (!prev || a.published_at < prev.at) firstSeen.set(cid, { language: a.language, at: a.published_at });
    }
  }
  await store.createClusters([...firstSeen.entries()].map(([id, v]) => ({ id, language: v.language, first_seen_at: v.at })));
  await store.linkArticles(fresh.flatMap((a) => (assignment.has(a.id) ? [{ story_id: assignment.get(a.id)!, article_id: a.id }] : [])));
  report.new_stories = firstSeen.size;
  const touchedIds = [...new Set(fresh.map((a) => assignment.get(a.id)).filter((x): x is string => Boolean(x)))];
  report.stories_touched = touchedIds.length;

  // 5. Classify + recompute stats -----------------------------------------------------
  const clusters = await store.loadClusters(touchedIds);
  const stats = new Map<string, ClusterStats>();
  for (const c of clusters) {
    const s = computeClusterStats(c);
    stats.set(c.id, s);
    await store.updateCluster(c.id, { ...s });
  }

  // 6. Summarize (budgeted) -----------------------------------------------------------
  const summariesBy = await store.summaryLanguages(touchedIds);
  let callsToday = await store.aiCallsToday();
  const usage = { calls: 0, input: 0, output: 0 };
  const budgetLeft = () => callsToday + usage.calls < cfg.ai.dailyCallCap;

  const queue = clusters
    .filter((c) => needsSummary(c, stats.get(c.id)!, summariesBy.get(c.id)?.find((s) => s.language === REFERENCE_LANGUAGE)))
    .sort((a, b) => stats.get(b.id)!.importance - stats.get(a.id)!.importance || b.articles.length - a.articles.length);

  let aiWrites = 0;
  for (const c of queue) {
    const st = stats.get(c.id)!;
    const lead = [...c.articles].sort((a, b) => (b.source?.trust_score ?? 0) - (a.source?.trust_score ?? 0))[0];
    if (!lead) continue;
    let wrote = false;

    if (deps.model && canSummarize(c) && aiWrites < cfg.ai.maxSummariesPerRun) {
      if (!budgetLeft()) {
        report.ai_budget_exhausted = true;
      } else {
        aiWrites++;
        try {
          const excerpts = authorizedExcerpts(c).map((a) => ({
            publisher: a.source?.name ?? a.source?.domain ?? "Unknown",
            published_at: a.published_at,
            headline: a.headline,
            excerpt: a.excerpt ?? "",
          }));
          const r = await writeBrief(deps.model, excerpts);
          usage.calls += r.usage.calls;
          usage.input += r.usage.input;
          usage.output += r.usage.output;
          if (r.brief) {
            await store.upsertSummary({
              story_id: c.id, language: REFERENCE_LANGUAGE, headline: r.brief.headline, summary: r.brief.summary,
              kind: "summary", validation_status: "approved", validation_errors: [], model: cfg.ai.model,
            });
            const patch: Record<string, unknown> = {
              importance: Math.max(r.brief.importance, st.importance >= 4 ? st.importance : 1),
              sensitive: r.brief.sensitive || st.sensitive,
              summarized_article_count: st.article_count,
            };
            if (r.brief.topics.length) patch.topics = r.brief.topics;
            if (r.brief.event_countries.length) {
              patch.event_countries = r.brief.event_countries;
              patch.affected_countries = [...new Set([...r.brief.event_countries, ...r.brief.affected_countries])];
            }
            await store.updateCluster(c.id, patch);
            Object.assign(st, patch);
            report.summaries_written++;
            wrote = true;
          } else {
            report.summaries_failed++;
            log(`Summary rejected for ${c.id}: ${r.errors.join("; ")}`);
          }
        } catch (err) {
          report.summaries_failed++;
          log(`Model error for ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (!wrote) {
      // Never invent a summary from a headline: publish a labeled headline-only entry, or nothing.
      const existingEn = summariesBy.get(c.id)?.find((s) => s.language === REFERENCE_LANGUAGE);
      if (existingEn?.kind === "summary") continue;
      if (!canPublishHeadlineOnly(c, st)) continue;
      await store.upsertSummary({
        story_id: c.id, language: c.language, headline: lead.headline, summary: null, kind: "headline_only",
        validation_status: "approved", validation_errors: [], model: null,
      });
      await store.updateCluster(c.id, { summarized_article_count: st.article_count });
      report.headline_only++;
    }
  }

  // 7. Translations for major stories ---------------------------------------------------
  if (deps.model && cfg.translateLanguages.length) {
    const after = await store.summaryLanguages(touchedIds);
    for (const c of clusters) {
      const st = stats.get(c.id)!;
      const en = after.get(c.id)?.find((s) => s.language === REFERENCE_LANGUAGE && s.kind === "summary");
      if (!en || st.importance < 4) continue;
      for (const lang of cfg.translateLanguages) {
        if (lang === REFERENCE_LANGUAGE || after.get(c.id)?.some((s) => s.language === lang)) continue;
        if (!budgetLeft()) {
          report.ai_budget_exhausted = true;
          break;
        }
        try {
          const t = await translateBrief(deps.model, { headline: en.headline, summary: en.summary! }, lang);
          usage.calls++;
          usage.input += t.inputTokens;
          usage.output += t.outputTokens;
          if (t.result) {
            await store.upsertSummary({
              story_id: c.id, language: lang, headline: t.result.headline, summary: t.result.summary, kind: "summary",
              validation_status: "approved", validation_errors: [], model: cfg.ai.model,
            });
            report.translations++;
          }
        } catch (err) {
          log(`Translation error ${c.id}/${lang}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  await store.recordAiUsage(usage.calls, usage.input, usage.output);
  report.ai_calls = usage.calls;
  callsToday += usage.calls;

  // 8. Breaking-news decisions (delivery happens in the API worker) -----------------------
  const finalSummaries = await store.summaryLanguages(touchedIds);
  for (const c of clusters) {
    if (c.breaking_status !== "none") continue;
    const st = stats.get(c.id)!;
    const hasSummary = finalSummaries.get(c.id)?.some((s) => s.kind === "summary");
    if (!hasSummary || st.importance < 4) continue;
    const d = evaluateBreaking(
      {
        importance: st.importance,
        sensitive: st.sensitive,
        first_seen_at: c.first_seen_at,
        already_alerted: false,
        articles: c.articles.map((a) => ({
          domain: a.source?.domain ?? "",
          owner: a.source?.owner,
          official: a.source?.official,
          excerpt: a.excerpt ?? a.headline,
          published_at: a.published_at,
        })),
      },
      now,
    );
    if (d.decision === "send") {
      await store.updateCluster(c.id, { breaking_status: "approved", breaking_reason: `independent sources: ${d.independent_sources}` });
      report.breaking_approved++;
    } else if (d.decision === "hold") {
      await store.updateCluster(c.id, { breaking_status: "held", breaking_reason: d.reasons.join("; ") });
      report.breaking_held++;
    }
  }

  // 9. Housekeeping once a day (first run after 00:00 UTC) -------------------------------
  if (now.getUTCHours() === 0 && now.getUTCMinutes() < 35) await store.cleanup();

  return report;
}
