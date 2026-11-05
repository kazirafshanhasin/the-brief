import { jaccard, titleTokens } from "./text";

export interface ClusterableArticle {
  id: string;
  title: string;
  language: string;
  published_at: string;
  /** Present for articles already assigned in earlier runs. */
  cluster_id?: string | null;
}

export interface ClusterOptions {
  /** Minimum headline similarity to join a cluster. */
  threshold?: number;
  /** Articles further apart than this cannot share a cluster. */
  windowHours?: number;
  /** Factory for new cluster ids. */
  newId: () => string;
}

/**
 * Assign each unclustered article to an existing cluster (via its most similar already-clustered
 * article in the same language and time window) or to a new cluster. Deterministic: articles
 * are processed oldest first. Returns article id → cluster id for the articles it assigned.
 */
export function assignClusters(articles: ClusterableArticle[], opts: ClusterOptions): Map<string, string> {
  const threshold = opts.threshold ?? 0.45;
  const windowMs = (opts.windowHours ?? 48) * 3_600_000;

  const sorted = [...articles].sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
  const assigned: { tokens: Set<string>; language: string; at: number; cluster: string }[] = [];
  const result = new Map<string, string>();

  for (const a of sorted) {
    if (a.cluster_id) {
      assigned.push({ tokens: titleTokens(a.title), language: a.language, at: Date.parse(a.published_at), cluster: a.cluster_id });
    }
  }

  for (const a of sorted) {
    if (a.cluster_id) continue;
    const tokens = titleTokens(a.title);
    const at = Date.parse(a.published_at);
    let best: { cluster: string; sim: number } | null = null;
    for (const other of assigned) {
      if (other.language !== a.language) continue;
      if (Math.abs(other.at - at) > windowMs) continue;
      const sim = jaccard(tokens, other.tokens);
      let shared = 0;
      for (const t of tokens) if (other.tokens.has(t)) shared++;
      if (sim >= threshold && shared >= 3 && (!best || sim > best.sim)) best = { cluster: other.cluster, sim };
    }
    const cluster = best?.cluster ?? opts.newId();
    result.set(a.id, cluster);
    assigned.push({ tokens, language: a.language, at, cluster });
  }
  return result;
}
