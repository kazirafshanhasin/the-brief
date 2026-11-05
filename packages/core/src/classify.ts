import { COUNTRIES } from "./countries";
import { normalizeText } from "./text";
import { TOPIC_KEYWORDS, type TopicId } from "./topics";

/** Extra names and demonyms that point to a country. Lowercase. */
const ALIASES: Record<string, string[]> = {
  US: ["united states", "u s", "usa", "america", "american", "americans", "washington", "white house", "pentagon"],
  GB: ["united kingdom", "uk", "britain", "british", "england", "scotland", "wales", "london", "downing street"],
  BD: ["bangladeshi", "dhaka", "chattogram", "chittagong"],
  IN: ["indian", "new delhi", "delhi", "mumbai", "kolkata", "bengaluru"],
  PK: ["pakistani", "islamabad", "karachi", "lahore"],
  CN: ["chinese", "beijing", "shanghai"],
  JP: ["japanese", "tokyo", "osaka"],
  KR: ["south korean", "seoul"],
  KP: ["north korean", "pyongyang"],
  RU: ["russian", "moscow", "kremlin"],
  UA: ["ukrainian", "kyiv"],
  DE: ["german", "berlin"],
  FR: ["french", "paris", "elysee"],
  IT: ["italian", "rome"],
  ES: ["spanish", "madrid"],
  TR: ["turkey", "turkish", "ankara", "istanbul"],
  IR: ["iranian", "tehran"],
  IL: ["israeli", "jerusalem", "tel aviv"],
  PS: ["palestine", "palestinian", "gaza", "west bank"],
  SA: ["saudi", "riyadh"],
  AE: ["uae", "emirati", "dubai", "abu dhabi"],
  EG: ["egyptian", "cairo"],
  NG: ["nigerian", "lagos", "abuja"],
  KE: ["kenyan", "nairobi"],
  ZA: ["south african", "johannesburg", "pretoria", "cape town"],
  BR: ["brazilian", "brasilia", "sao paulo", "rio de janeiro"],
  MX: ["mexican", "mexico city"],
  CA: ["canadian", "ottawa", "toronto"],
  AU: ["australian", "canberra", "sydney", "melbourne"],
  ID: ["indonesian", "jakarta"],
  PH: ["filipino", "philippine", "manila"],
  VN: ["vietnamese", "hanoi", "ho chi minh"],
  TH: ["thai", "bangkok"],
  MM: ["myanmar", "burma", "burmese", "yangon", "naypyitaw"],
  LK: ["sri lankan", "colombo"],
  NP: ["nepali", "nepalese", "kathmandu"],
  AF: ["afghan", "kabul"],
  HK: ["hong kong"],
  MO: ["macao", "macau"],
  TW: ["taiwanese", "taipei"],
  CD: ["dr congo", "drc", "democratic republic of the congo", "kinshasa"],
  CG: ["republic of the congo", "brazzaville"],
  CI: ["ivory coast", "cote d ivoire", "côte d’ivoire"],
  CZ: ["czech republic", "czech", "prague"],
  NL: ["dutch", "amsterdam", "the hague"],
  CV: ["cabo verde"],
  SZ: ["swaziland"],
  MK: ["macedonia"],
  VA: ["vatican", "holy see"],
};

interface Matcher {
  code: string;
  phrase: string;
}

let matchers: Matcher[] | null = null;
function getMatchers(): Matcher[] {
  if (matchers) return matchers;
  const list: Matcher[] = [];
  for (const c of COUNTRIES) {
    const base = normalizeText(c.name.replace(/\(.*?\)/g, "").replace(/&/g, "and"));
    if (base.length >= 4) list.push({ code: c.code, phrase: base });
    for (const alias of ALIASES[c.code] ?? []) list.push({ code: c.code, phrase: normalizeText(alias) });
  }
  // Longest phrases first so "papua new guinea" wins over "guinea", "niger" can't eat "nigeria".
  list.sort((a, b) => b.phrase.length - a.phrase.length);
  matchers = list;
  return list;
}

/** Country codes mentioned in text, most-mentioned first. */
export function detectCountries(text: string): string[] {
  let hay = ` ${normalizeText(text)} `;
  const counts = new Map<string, number>();
  for (const m of getMatchers()) {
    const needle = ` ${m.phrase} `;
    let idx = hay.indexOf(needle);
    while (idx !== -1) {
      counts.set(m.code, (counts.get(m.code) ?? 0) + 1);
      hay = `${hay.slice(0, idx)} ${"#".repeat(m.phrase.length)} ${hay.slice(idx + needle.length)}`;
      idx = hay.indexOf(needle);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
}

/**
 * Where did the event happen? Headline mentions win, then body mentions, then (as a last resort)
 * the publisher's own country. A US outlet writing about Japan → JP, not US.
 */
export function eventCountries(
  headline: string,
  body: string,
  publisherCountry: string | null,
): { event: string[]; affected: string[]; fromPublisher: boolean } {
  const inHeadline = detectCountries(headline);
  const inBody = detectCountries(body).filter((c) => !inHeadline.includes(c));
  if (inHeadline.length > 0) {
    return { event: inHeadline.slice(0, 2), affected: [...inHeadline, ...inBody].slice(0, 6), fromPublisher: false };
  }
  if (inBody.length > 0) {
    return { event: inBody.slice(0, 1), affected: inBody.slice(0, 6), fromPublisher: false };
  }
  const fallback = publisherCountry ? [publisherCountry] : [];
  return { event: fallback, affected: fallback, fromPublisher: true };
}

/** Keyword topic classification. `hint` is the feed's declared category, if any. */
export function classifyTopics(text: string, hint?: TopicId | null): TopicId[] {
  const hay = ` ${normalizeText(text)} `;
  const scores: [TopicId, number][] = [];
  for (const [topic, words] of Object.entries(TOPIC_KEYWORDS) as [TopicId, string[]][]) {
    let s = 0;
    for (const w of words) {
      const needle = ` ${normalizeText(w)} `;
      if (needle.trim() && hay.includes(needle)) s++;
    }
    if (hint === topic) s += 2;
    if (s > 0) scores.push([topic, s]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  const top = scores.slice(0, 3).map(([t]) => t);
  if (top.length === 0) return hint ? [hint] : ["world"];
  return top;
}
