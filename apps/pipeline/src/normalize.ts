import { COUNTRIES, canonicalUrl, domainOf, normalizeText } from "@brief/core";
import type { SourceConfig } from "./config";
import type { FeedItem, GdeltArticle } from "./feeds";
import { gdeltLanguage, parseGdeltDate } from "./feeds";

export interface NewArticle {
  id: string;
  canonical_url: string;
  url: string;
  source_id: string;
  headline: string;
  excerpt: string | null;
  language: string;
  publisher_country: string | null;
  origin: "rss" | "gdelt" | "official";
  published_at: string;
  metadata: Record<string, unknown>;
}

const MAX_EXCERPT = 600;
const MAX_AGE_MS = 48 * 3_600_000;

/** Excerpts are kept only when the source's rights allow it, and trimmed to a short length. */
export function permittedExcerpt(source: SourceConfig, description: string): string | null {
  if (source.rights === "headline_link") return null;
  const d = description.trim();
  if (d.length < 40) return null;
  return d.length > MAX_EXCERPT ? `${d.slice(0, MAX_EXCERPT).replace(/\s+\S*$/, "")}…` : d;
}

export function normalizeFeedItem(item: FeedItem, source: SourceConfig, now: Date, newId: () => string): NewArticle | null {
  const published = item.published_at ?? now.toISOString();
  const t = Date.parse(published);
  // Drop stale items and items dated in the future (bad feed clocks), allowing 15 min skew.
  if (now.getTime() - t > MAX_AGE_MS || t - now.getTime() > 15 * 60_000) return null;
  const url = canonicalUrl(item.url);
  return {
    id: newId(),
    canonical_url: url,
    url: item.url,
    source_id: source.id,
    headline: item.title.slice(0, 300),
    excerpt: permittedExcerpt(source, item.description),
    language: source.language,
    publisher_country: source.country,
    origin: source.official ? "official" : "rss",
    published_at: new Date(t).toISOString(),
    metadata: {},
  };
}

const COUNTRY_BY_SQUASHED = new Map(COUNTRIES.map((c) => [normalizeText(c.name).replace(/\s+/g, ""), c.code]));
COUNTRY_BY_SQUASHED.set("unitedstates", "US");
COUNTRY_BY_SQUASHED.set("unitedkingdom", "GB");
COUNTRY_BY_SQUASHED.set("turkey", "TR");
COUNTRY_BY_SQUASHED.set("southkorea", "KR");
COUNTRY_BY_SQUASHED.set("czechrepublic", "CZ");

export function gdeltCountry(name: string): string | null {
  return COUNTRY_BY_SQUASHED.get(normalizeText(name).replace(/\s+/g, "")) ?? null;
}

/** A GDELT hit is headline + link only. It is attributed to a configured source when the domain matches. */
export function normalizeGdelt(
  a: GdeltArticle,
  sourcesByDomain: Map<string, SourceConfig>,
  now: Date,
  newId: () => string,
): { article: NewArticle; discovered: SourceConfig | null } | null {
  const published = parseGdeltDate(a.seendate);
  if (!published || now.getTime() - Date.parse(published) > MAX_AGE_MS) return null;
  const domain = (a.domain || domainOf(a.url)).toLowerCase().replace(/^www\./, "");
  const known = sourcesByDomain.get(domain);
  if (known && known.status === "disabled") return null;
  const country = gdeltCountry(a.sourcecountry ?? "");
  const discovered: SourceConfig | null = known
    ? null
    : {
        id: `gdelt:${domain}`,
        name: domain,
        domain,
        country,
        language: gdeltLanguage(a.language ?? "English"),
        feed_url: null,
        default_topic: null,
        owner: null,
        official: false,
        rights: "headline_link",
        trust_score: 0.4,
        status: "discovered",
        terms_checked: false,
      };
  return {
    article: {
      id: newId(),
      canonical_url: canonicalUrl(a.url),
      url: a.url,
      source_id: known?.id ?? discovered!.id,
      headline: a.title.slice(0, 300),
      excerpt: null,
      language: gdeltLanguage(a.language ?? "English"),
      publisher_country: known?.country ?? country,
      origin: "gdelt",
      published_at: published,
      metadata: { gdelt: true },
    },
    discovered,
  };
}

/** Remove duplicate URLs within a batch, keeping the version with the longest excerpt. */
export function dedupeBatch(articles: NewArticle[]): NewArticle[] {
  const best = new Map<string, NewArticle>();
  for (const a of articles) {
    const prev = best.get(a.canonical_url);
    if (!prev || (a.excerpt?.length ?? 0) > (prev.excerpt?.length ?? 0)) best.set(a.canonical_url, a);
  }
  return [...best.values()];
}
