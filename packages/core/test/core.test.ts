import { describe, expect, it } from "vitest";
import {
  COUNTRIES,
  assignClusters,
  canonicalUrl,
  classifyTopics,
  coverageLevel,
  detectCountries,
  evaluateBreaking,
  eventCountries,
  independentSourceCount,
  nextDigestAt,
  normalizeDigestTimes,
  pickDigest,
  pickLanguage,
  rankFeed,
  splitSentences,
  validateSummary,
  zonedToUtc,
  type FeedStory,
} from "../src/index";

const now = new Date("2026-11-03T12:00:00Z");

function story(p: Partial<FeedStory> & { id: string }): FeedStory {
  return {
    headline: `Headline ${p.id}`,
    summary: "One. Two.",
    kind: "summary",
    language: "en",
    event_countries: ["BD"],
    affected_countries: ["BD"],
    topics: ["business"],
    importance: 3,
    source_count: 2,
    source_confidence: 0.8,
    first_seen_at: now.toISOString(),
    updated_at: now.toISOString(),
    primary_source: null,
    ...p,
  };
}

describe("countries", () => {
  it("lists every country once", () => {
    expect(COUNTRIES.length).toBe(250);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
  });
});

describe("text", () => {
  it("canonicalizes URLs", () => {
    expect(canonicalUrl("http://www.Example.com/a/b/?utm_source=x&id=2#top")).toBe("https://example.com/a/b?id=2");
  });
  it("splits sentences without breaking on abbreviations", () => {
    expect(splitSentences("The U.S. economy grew. Prices rose! Will it last?")).toEqual([
      "The U.S. economy grew.",
      "Prices rose!",
      "Will it last?",
    ]);
  });
});

describe("classification", () => {
  it("assigns a US outlet's story about Japan to Japan", () => {
    const r = eventCountries("Japan's central bank raises rates", "Tokyo officials said...", "US");
    expect(r.event).toEqual(["JP"]);
    expect(r.fromPublisher).toBe(false);
  });
  it("prefers longer country names", () => {
    expect(detectCountries("Floods in Papua New Guinea")).toEqual(["PG"]);
    expect(detectCountries("Nigeria and Niger sign deal").sort()).toEqual(["NE", "NG"]);
  });
  it("falls back to publisher country", () => {
    expect(eventCountries("Budget passed", "", "BD")).toMatchObject({ event: ["BD"], fromPublisher: true });
  });
  it("classifies topics by keywords", () => {
    expect(classifyTopics("Central bank holds interest rate as inflation cools")).toContain("finance");
    expect(classifyTopics("Nothing matches here", "sports")).toEqual(["sports"]);
  });
});

describe("clustering", () => {
  it("groups reports about the same event and keeps others apart", () => {
    let n = 0;
    const ids = assignClusters(
      [
        { id: "a", title: "Cyclone Remal makes landfall in southern Bangladesh coast", language: "en", published_at: "2026-11-03T08:00:00Z" },
        { id: "b", title: "Cyclone Remal makes landfall on Bangladesh coast, thousands evacuated", language: "en", published_at: "2026-11-03T09:00:00Z" },
        { id: "c", title: "Japan unveils new semiconductor subsidy package", language: "en", published_at: "2026-11-03T09:30:00Z" },
      ],
      { newId: () => `c${++n}` },
    );
    expect(ids.get("a")).toBe(ids.get("b"));
    expect(ids.get("c")).not.toBe(ids.get("a"));
  });
  it("joins existing clusters from earlier runs", () => {
    const ids = assignClusters(
      [
        { id: "old", title: "Parliament passes new national budget for 2027", language: "en", published_at: "2026-11-03T06:00:00Z", cluster_id: "K" },
        { id: "new", title: "Parliament passes national budget for 2027 after debate", language: "en", published_at: "2026-11-03T10:00:00Z" },
      ],
      { newId: () => "fresh" },
    );
    expect(ids.get("new")).toBe("K");
  });
});

describe("ranking", () => {
  it("prefers matching interests and caps one country dominating", () => {
    const stories = [
      ...Array.from({ length: 6 }, (_, i) => story({ id: `bd${i}`, event_countries: ["BD"], topics: ["business"] })),
      story({ id: "jp", event_countries: ["JP"], affected_countries: ["JP"], topics: ["business"], importance: 3 }),
      story({ id: "unrelated", event_countries: ["BR"], affected_countries: ["BR"], topics: ["sports"], importance: 2 }),
    ];
    const ranked = rankFeed(stories, { countries: ["BD", "JP"], topics: ["business"], now });
    expect(ranked.map((s) => s.id)).not.toContain("unrelated");
    expect(ranked.findIndex((s) => s.id === "jp")).toBeLessThan(5);
  });
  it("includes major global developments outside interests, but rarely", () => {
    const stories = [
      ...Array.from({ length: 10 }, (_, i) => story({ id: `m${i}` })),
      story({ id: "g1", event_countries: ["FR"], affected_countries: ["FR"], topics: ["world"], importance: 5 }),
      story({ id: "g2", event_countries: ["MX"], affected_countries: ["MX"], topics: ["world"], importance: 5 }),
    ];
    const ranked = rankFeed(stories, { countries: ["BD"], topics: ["business"], now }, { limit: 6 });
    expect(ranked.filter((s) => s.id.startsWith("g")).length).toBe(1);
  });
  it("digest never uses headline-only entries", () => {
    const d = pickDigest(
      [story({ id: "h", kind: "headline_only", summary: null, importance: 5 }), story({ id: "s1" }), story({ id: "s2" })],
      { countries: ["BD"], topics: [], now },
    );
    expect(d.map((s) => s.id)).toEqual(expect.not.arrayContaining(["h"]));
  });
  it("picks the reader's language, else English with a label, else nothing", () => {
    const rows = [
      story({ id: "both", language: "en" }),
      story({ id: "both", language: "bn", headline: "Bangla" }),
      story({ id: "english", language: "en" }),
      story({ id: "french", language: "fr" }),
    ];
    const picked = pickLanguage(rows, "bn");
    expect(picked.map((s) => [s.id, s.language, s.language_fallback])).toEqual([
      ["both", "bn", undefined],
      ["english", "en", true],
    ]);
    expect(pickLanguage(rows, "en").map((s) => s.id)).toEqual(["both", "english"]);
  });
});

describe("scheduling", () => {
  it("computes the next digest in Asia/Dhaka (UTC+6)", () => {
    // 12:00Z = 18:00 Dhaka → next 08:00 is tomorrow 02:00Z; 20:00 today = 14:00Z.
    expect(nextDigestAt(["08:00", "20:00"], "Asia/Dhaka", now)?.toISOString()).toBe("2026-11-03T14:00:00.000Z");
    expect(nextDigestAt(["08:00"], "Asia/Dhaka", now)?.toISOString()).toBe("2026-11-04T02:00:00.000Z");
  });
  it("handles DST gaps and overlaps", () => {
    // US spring forward 2027-03-14: 02:30 does not exist in New York → 03:30 EDT (07:30Z).
    expect(zonedToUtc({ year: 2027, month: 3, day: 14, hour: 2, minute: 30 }, "America/New_York").toISOString()).toBe(
      "2027-03-14T07:30:00.000Z",
    );
    // Fall back 2026-11-01: 01:30 happens twice → first occurrence (EDT, 05:30Z).
    expect(zonedToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York").toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });
  it("validates digest times", () => {
    expect(normalizeDigestTimes(["18:00", "08:00", "8:00"]).times).toEqual(["08:00", "18:00"]);
    expect(normalizeDigestTimes(["08:00", "08:30"]).errors.length).toBe(1);
    expect(normalizeDigestTimes(["01:00", "05:00", "09:00", "13:00"]).times.length).toBe(3);
  });
});

describe("breaking news", () => {
  const wire = "The earthquake of magnitude 7.1 struck off the coast early on Tuesday, the national seismology agency said, and residents were urged to move to higher ground.";
  it("treats syndicated wire copies as one source", () => {
    expect(
      independentSourceCount([
        { domain: "a.com", excerpt: wire, published_at: now.toISOString() },
        { domain: "b.com", excerpt: wire, published_at: now.toISOString() },
        { domain: "c.co.uk", excerpt: wire, published_at: now.toISOString() },
      ]),
    ).toBe(1);
  });
  const base = {
    importance: 5,
    sensitive: false,
    first_seen_at: "2026-11-03T11:00:00Z",
    already_alerted: false,
    articles: [
      { domain: "a.com", excerpt: wire, published_at: "2026-11-03T11:30:00Z" },
      { domain: "b.org", excerpt: "Officials confirmed a strong quake and issued a tsunami warning for coastal districts while schools closed.", published_at: "2026-11-03T11:40:00Z" },
    ],
  };
  it("sends corroborated, recent, important events", () => {
    expect(evaluateBreaking(base, now).decision).toBe("send");
  });
  it("holds sensitive events for review", () => {
    expect(evaluateBreaking({ ...base, sensitive: true }, now).decision).toBe("hold");
  });
  it("rejects single-source events and duplicates", () => {
    expect(evaluateBreaking({ ...base, articles: base.articles.slice(0, 1) }, now).decision).toBe("reject");
    expect(evaluateBreaking({ ...base, already_alerted: true }, now).decision).toBe("reject");
  });
});

describe("summary validation", () => {
  const source = "The central bank raised its policy rate to 10 percent on Monday, citing inflation of 9.5 percent.";
  it("accepts a faithful 2–4 sentence summary", () => {
    const r = validateSummary("Central bank raises rate to 10%", "The central bank raised its policy rate to 10 percent. It cited inflation of 9.5 percent.", source);
    expect(r).toEqual({ ok: true, errors: [] });
  });
  it("rejects invented numbers, wrong length and links", () => {
    expect(validateSummary("Rate rise", "The bank raised rates to 12 percent. Markets fell.", source).errors.join()).toMatch(/12/);
    expect(validateSummary("Rate rise", "Only one sentence.", source).ok).toBe(false);
    expect(validateSummary("Rate rise", "Read more at https://x.com. Then two.", source).ok).toBe(false);
  });
});

describe("coverage", () => {
  it("levels", () => {
    expect([coverageLevel(0), coverageLevel(2), coverageLevel(9)]).toEqual(["none", "limited", "good"]);
  });
});
