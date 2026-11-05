import { XMLParser } from "fast-xml-parser";
import { canonicalUrl, domainOf, stripHtml } from "@brief/core";

export interface FeedItem {
  title: string;
  url: string;
  description: string;
  published_at: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  removeNSPrefix: true,
  processEntities: true,
  htmlEntities: true,
});

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#text" in o) return text(o["#text"]);
    if ("@_href" in o) return text(o["@_href"]);
    // Raw markup without CDATA, for example <title><a href="...">Headline</a></title>.
    return Object.entries(o).filter(([k]) => !k.startsWith("@_")).map(([, child]) => text(child)).join(" ").trim();
  }
  return "";
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function toIso(value: string): string | null {
  if (!value) return null;
  const t = Date.parse(value.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function atomLink(links: unknown): string {
  const list = asArray(links as Record<string, string> | Record<string, string>[]);
  const alt = list.find((l) => typeof l === "object" && (!l["@_rel"] || l["@_rel"] === "alternate")) ?? list[0];
  return text(alt);
}

/** Parse RSS 2.0, RSS 1.0 (RDF) and Atom into a flat list of items. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  let raw: Record<string, unknown>[] = [];
  let kind: "rss" | "atom" = "rss";
  if (doc.rss?.channel) raw = asArray(doc.rss.channel.item);
  else if (doc.RDF) raw = asArray(doc.RDF.item);
  else if (doc.feed) {
    raw = asArray(doc.feed.entry);
    kind = "atom";
  }
  const items: FeedItem[] = [];
  for (const it of raw) {
    const title = stripHtml(text(it.title));
    const link = kind === "atom" ? atomLink(it.link) : text(it.link) || text(it.guid);
    const description = stripHtml(
      text(kind === "atom" ? (it.summary ?? it.content) : (it.description ?? it.encoded ?? it.summary)),
    );
    const published = toIso(text(it.pubDate ?? it.published ?? it.updated ?? it.date));
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({ title, url: link.trim(), description, published_at: published });
  }
  return items;
}

export interface GdeltArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  language: string;
  sourcecountry: string;
}

const GDELT_LANG: Record<string, string> = {
  english: "en", bengali: "bn", hindi: "hi", arabic: "ar", spanish: "es", french: "fr", portuguese: "pt",
  german: "de", chinese: "zh", japanese: "ja", indonesian: "id", urdu: "ur", russian: "ru", italian: "it", turkish: "tr",
};

export function gdeltLanguage(name: string): string {
  return GDELT_LANG[name.toLowerCase()] ?? name.slice(0, 2).toLowerCase();
}

/** GDELT seendate looks like 20261103T101500Z. */
export function parseGdeltDate(s: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

export function gdeltUrl(query: string, timespan: string, maxRecords: number): string {
  const p = new URLSearchParams({ query, mode: "ArtList", format: "json", sort: "DateDesc", timespan, maxrecords: String(maxRecords) });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${p.toString()}`;
}

export function parseGdelt(json: string): GdeltArticle[] {
  try {
    const data = JSON.parse(json) as { articles?: GdeltArticle[] };
    return (data.articles ?? []).filter((a) => a.url && a.title);
  } catch {
    return []; // GDELT returns plain-text errors for bad queries
  }
}

export { canonicalUrl, domainOf };
