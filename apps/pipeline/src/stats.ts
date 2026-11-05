import {
  SUMMARY_RULES,
  classifyTopics,
  eventCountries,
  hasEnoughSourceText,
  independentSourceCount,
  isTopicId,
  normalizeText,
  splitSentences,
  type TopicId,
} from "@brief/core";

export interface ClusterArticle {
  id: string;
  headline: string;
  excerpt: string | null;
  language: string;
  url: string;
  published_at: string;
  publisher_country: string | null;
  source: {
    id: string;
    name: string;
    domain: string;
    owner: string | null;
    official: boolean;
    trust_score: number;
    rights: string;
    status: string;
    default_topic: string | null;
  } | null;
}

export interface ClusterState {
  id: string;
  language: string;
  first_seen_at: string;
  importance: number;
  sensitive: boolean;
  breaking_status: string;
  summarized_article_count: number;
  articles: ClusterArticle[];
}

export interface ClusterStats {
  article_count: number;
  source_count: number;
  source_confidence: number;
  event_countries: string[];
  affected_countries: string[];
  topics: TopicId[];
  importance: number;
  sensitive: boolean;
  updated_at: string;
}

const SENSITIVE_WORDS = [
  "killed", "dead", "deaths", "death toll", "attack", "attacks", "bomb", "bombing", "explosion", "shooting", "gunmen",
  "militants", "airstrike", "airstrikes", "missile", "war", "invasion", "troops", "hostage", "terror", "terrorist",
  "massacre", "riot", "coup", "casualties", "injured", "earthquake", "tsunami", "landslide", "election fraud", "rigged",
];

export function looksSensitive(text: string): boolean {
  const hay = ` ${normalizeText(text)} `;
  return SENSITIVE_WORDS.some((w) => hay.includes(` ${w} `));
}

/** Recompute a story's derived fields from all of its reports. Pure: no I/O. */
export function computeClusterStats(c: ClusterState): ClusterStats {
  const arts = c.articles;
  const sorted = [...arts].sort((a, b) => (b.source?.trust_score ?? 0) - (a.source?.trust_score ?? 0));
  const lead = sorted[0];
  const allText = arts.map((a) => `${a.headline}. ${a.excerpt ?? ""}`).join(" ");
  const headlines = arts.map((a) => a.headline).join(". ");

  const countries = eventCountries(headlines, arts.map((a) => a.excerpt ?? "").join(" "), lead?.publisher_country ?? null);
  const hint = lead?.source?.default_topic && isTopicId(lead.source.default_topic) ? lead.source.default_topic : null;
  const topics = classifyTopics(allText, hint);

  const source_count = independentSourceCount(
    arts.map((a) => ({
      domain: a.source?.domain ?? "",
      owner: a.source?.owner,
      official: a.source?.official,
      excerpt: a.excerpt ?? a.headline,
      published_at: a.published_at,
    })),
  );
  const trust = arts.map((a) => a.source?.trust_score ?? 0.4);
  const source_confidence = Math.round((trust.reduce((s, x) => s + x, 0) / Math.max(1, trust.length)) * 100) / 100;

  let heuristic = 1;
  if (arts.length >= 3) heuristic++;
  if (source_count >= 3) heuristic++;
  if (source_count >= 5) heuristic++;
  if (arts.some((a) => a.source?.official)) heuristic++;
  const importance = Math.min(5, Math.max(heuristic, c.importance));

  const updated_at = new Date(Math.max(...arts.map((a) => Date.parse(a.published_at)), Date.parse(c.first_seen_at))).toISOString();
  return {
    article_count: arts.length,
    source_count,
    source_confidence,
    event_countries: countries.event,
    affected_countries: countries.affected,
    topics,
    importance,
    sensitive: c.sensitive || looksSensitive(allText),
    updated_at,
  };
}

/** Authorized text available for summarizing: excerpts from sources whose rights allow it. */
export function authorizedExcerpts(c: ClusterState): ClusterArticle[] {
  return c.articles
    .filter((a) => a.excerpt && a.source && a.source.rights !== "headline_link")
    .sort((a, b) => (b.source?.trust_score ?? 0) - (a.source?.trust_score ?? 0))
    .slice(0, 5);
}

const EXTRACT_MAX_SENTENCES = 3;
const EXTRACT_MAX_WORDS = 80;
const LINK = "LINKREMOVED";
const EXTRACT_BOILERPLATE = /appeared first on|continue reading|read more|click here|LINKREMOVED|\||(…|\.\.\.)$/i;
const EXTRACT_FRAGMENT = /^(And|But|Or)\b|\b(I|We|we|Our|our|us)\b/;

function cleanSentences(excerpt: string, title: string): string[] {
  const picked: string[] = [];
  let words = 0;
  const text = excerpt.replace(/(https?:\/\/|www\.)\S+/g, LINK).replace(/\s*•\s*/g, ". ").replace(/\s+([.,;:!?])/g, "$1");
  for (const sentence of splitSentences(text)) {
    const count = sentence.split(/\s+/).length;
    const normalized = normalizeText(sentence);
    if (sentence.length < 20 || count > SUMMARY_RULES.maxWordsPerSentence || EXTRACT_BOILERPLATE.test(sentence) || EXTRACT_FRAGMENT.test(sentence)) continue;
    if (title.includes(normalized)) continue;
    if (picked.length >= EXTRACT_MAX_SENTENCES || words + count > EXTRACT_MAX_WORDS) break;
    picked.push(/[.!?"'”’)]$/.test(sentence) ? sentence : `${sentence}.`);
    words += count;
  }
  return picked;
}

/**
 * A short summary in one publisher's own words, from permitted excerpts in trust order. Nothing is
 * generated, so nothing can be invented. Null when no clean sentence is left: the story stays headline-only.
 */
export function extractSummary(excerpts: string[], headline: string): string | null {
  const title = normalizeText(headline);
  const options = excerpts.map((e) => cleanSentences(e, title));
  return (options.find((o) => o.length >= 2) ?? options.find((o) => o.length > 0))?.join(" ") ?? null;
}

export function canSummarize(c: ClusterState): boolean {
  return hasEnoughSourceText(authorizedExcerpts(c).map((a) => a.excerpt ?? ""));
}

/** Headline-only entries are shown only with some corroboration or from an approved publisher. */
export function canPublishHeadlineOnly(c: ClusterState, stats: ClusterStats): boolean {
  return stats.source_count >= 2 || c.articles.some((a) => a.source?.status === "approved");
}

export function needsSummary(
  c: ClusterState,
  stats: ClusterStats,
  existing: { kind: string } | undefined,
): boolean {
  if (!existing) return true;
  if (existing.kind === "headline_only" && canSummarize(c)) return true;
  return stats.article_count >= c.summarized_article_count + 3;
}

export { SUMMARY_RULES };
