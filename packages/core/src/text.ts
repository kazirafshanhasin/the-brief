const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the this to was were will with after over says say said amid new more than not but".split(
    " ",
  ),
);

/** Lowercase, strip punctuation (Unicode-aware), collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant tokens of a headline, used for clustering. */
export function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const tok of normalizeText(title).split(" ")) {
    if (tok.length < 2 || STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Split into sentences. Handles ., !, ? and the Devanagari/Bengali danda and CJK full stop. */
export function splitSentences(text: string): string[] {
  const DOT = "․"; // placeholder for dots that do not end a sentence
  const cleaned = text
    .replace(/\s+/g, " ")
    .trim()
    // Initialisms: U.S., U.K., e.g. — and decimals: 9.5
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (m) => m.replace(/\./g, DOT))
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`)
    .replace(/\b(Mr|Mrs|Ms|Dr|St|No|vs|Inc|Ltd|Jr|Sr|Gen|Lt|Col|Prof)\./g, `$1${DOT}`);
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?।。！？۔؟]+(?:[.!?।。！？۔؟]+["'”’)]?|$)/g) ?? [cleaned];
  return parts.map((p) => p.trim().replace(new RegExp(DOT, "g"), ".")).filter((s) => s.length > 0);
}

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|cmpid$|ocid$|at_|s_cid$|spm$)/i;

/** Canonical form of an article URL: https, no fragment, no tracking params, no trailing slash. */
export function canonicalUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input.trim();
  }
  url.hash = "";
  if (url.protocol === "http:") url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  const keep: [string, string][] = [];
  url.searchParams.forEach((v, k) => {
    if (!TRACKING_PARAMS.test(k)) keep.push([k, v]);
  });
  keep.sort(([a], [b]) => a.localeCompare(b));
  url.search = keep.length ? `?${new URLSearchParams(keep).toString()}` : "";
  return url.toString();
}

export function domainOf(input: string): string {
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Strip HTML tags and decode the common entities found in RSS descriptions. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}
