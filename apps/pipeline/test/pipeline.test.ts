import { describe, expect, it } from "vitest";
import { interpretBrief, parseJsonObject } from "../src/ai";
import type { PipelineConfig, SourceConfig } from "../src/config";
import { loadSourcesFile } from "../src/config";
import { parseFeed, parseGdelt, parseGdeltDate } from "../src/feeds";
import { gdeltCountry } from "../src/normalize";
import { runPipeline } from "../src/pipeline";
import { MemoryStore } from "../src/store";

const NOW = new Date("2026-11-03T12:00:00Z");

const rss = (items: { t: string; d: string; link: string; at: string }[]) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>X</title>
${items.map((i) => `<item><title><![CDATA[${i.t}]]></title><link>${i.link}</link><description><![CDATA[<p>${i.d}</p>]]></description><pubDate>${new Date(i.at).toUTCString()}</pubDate></item>`).join("")}
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom headline</title><link rel="alternate" href="https://atom.example/a1"/><summary>Atom summary text</summary><updated>2026-11-03T10:00:00Z</updated></entry></feed>`;

const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<item><title>RDF headline</title><link>https://dw.example/r1</link><description>RDF text</description><dc:date>2026-11-03T09:00:00Z</dc:date></item></rdf:RDF>`;

describe("feed parsing", () => {
  it("parses RSS 2.0, Atom and RDF", () => {
    const r = parseFeed(rss([{ t: "Hello &amp; world", d: "Body <b>bold</b>", link: "https://x.example/1", at: "2026-11-03T08:00:00Z" }]));
    expect(r[0]).toMatchObject({ title: "Hello & world", description: "Body bold", url: "https://x.example/1" });
    expect(parseFeed(atom)[0]).toMatchObject({ title: "Atom headline", url: "https://atom.example/a1", published_at: "2026-11-03T10:00:00.000Z" });
    expect(parseFeed(rdf)[0]).toMatchObject({ title: "RDF headline", url: "https://dw.example/r1" });
  });
  it("reads titles wrapped in raw markup, as The Daily Star's feed has them", () => {
    const xml = `<rss version="2.0"><channel><item><title><a href="/news/x" hreflang="en">PM seeks help on crisis</a></title><link>https://x.example/1</link><pubDate>Wed, 04 Nov 26 13:57:20 +0600</pubDate></item></channel></rss>`;
    expect(parseFeed(xml)[0]).toMatchObject({ title: "PM seeks help on crisis", published_at: "2026-11-04T07:57:20.000Z" });
  });
  it("parses GDELT results and tolerates errors", () => {
    expect(parseGdeltDate("20261103T101500Z")).toBe("2026-11-03T10:15:00.000Z");
    expect(parseGdelt("Invalid query")).toEqual([]);
    expect(gdeltCountry("Bangladesh")).toBe("BD");
    expect(gdeltCountry("United States")).toBe("US");
  });
  it("ships a valid source registry", () => {
    const { sources } = loadSourcesFile();
    expect(sources.length).toBeGreaterThan(10);
  });
});

describe("model output handling", () => {
  it("extracts JSON from fenced replies", () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("rejects summaries with invented numbers", () => {
    const r = interpretBrief(
      JSON.stringify({ headline: "Rates up", summary: "The bank raised rates to 12 percent. Markets reacted.", importance: 3 }),
      "The bank raised rates to 10 percent.",
    );
    expect(r.brief).toBeNull();
    expect(r.errors.join()).toMatch(/12/);
  });
});

const longText = (topic: string) =>
  `${topic} officials said on Tuesday that the measures would take effect next month across the country. The government described the package as necessary to stabilise prices, while opposition lawmakers questioned its cost and timing. Analysts quoted by the newspaper expect further announcements this week.`;

function cfg(sources: SourceConfig[]): PipelineConfig {
  return {
    supabaseUrl: "", supabaseKey: "", dryRun: true, userAgent: "test", translateLanguages: ["bn"], sources,
    ai: { provider: "openai", apiKey: "k", model: "test-model", baseUrl: "", dailyCallCap: 100, maxSummariesPerRun: 10 },
    gdelt: { enabled: true, timespan: "2h", max_records: 10, queries: ["q"] },
  };
}

const src = (id: string, domain: string, country: string, extra: Partial<SourceConfig> = {}): SourceConfig => ({
  id, name: id.toUpperCase(), domain, country, language: "en", feed_url: `https://${domain}/rss`, default_topic: null,
  owner: id, official: false, rights: "headline_excerpt_link", trust_score: 0.8, status: "approved", terms_checked: true, ...extra,
});

describe("end-to-end pipeline (in memory)", () => {
  it("ingests, clusters, summarizes, translates and flags breaking news", async () => {
    const store = new MemoryStore();
    let n = 0;
    const feeds: Record<string, string> = {
      "https://one.example/rss": rss([
        { t: "Bangladesh central bank raises policy rate to curb inflation", d: longText("Bangladesh Bank"), link: "https://one.example/a", at: "2026-11-03T11:00:00Z" },
        { t: "Local cricket club opens new ground", d: "Short.", link: "https://one.example/b", at: "2026-11-03T10:00:00Z" },
      ]),
      "https://two.example/rss": rss([
        { t: "Bangladesh central bank raises policy rate as inflation persists", d: "Separately reported: the decision by Bangladesh Bank follows months of high food prices, and exporters warned of higher borrowing costs for factories and traders nationwide.", link: "https://two.example/x?utm_source=rss", at: "2026-11-03T11:30:00Z" },
      ]),
      "https://bad.example/rss": "",
    };
    const gdelt = JSON.stringify({
      articles: [
        { url: "https://three.example/c", title: "Bangladesh central bank raises policy rate amid inflation pressure", seendate: "20261103T113000Z", domain: "three.example", language: "English", sourcecountry: "Bangladesh" },
      ],
    });
    const calls: string[] = [];
    const report = await runPipeline(
      cfg([
        src("one", "one.example", "BD", { official: true }),
        src("two", "two.example", "US"),
        src("bad", "bad.example", "GB"),
      ]),
      {
        store,
        now: () => NOW,
        newId: () => `id${++n}`,
        log: () => {},
        fetchText: async (url, kind) => {
          if (kind === "gdelt") return { status: 200, text: gdelt };
          if (url.includes("bad.example")) return { status: 500, text: "" };
          return { status: 200, text: feeds[url] ?? "" };
        },
        model: async (system, user) => {
          calls.push(system.includes("translate") ? "translate" : "summary");
          if (system.includes("translate")) {
            return { text: JSON.stringify({ headline: "বাংলাদেশ ব্যাংক নীতি সুদহার বাড়াল", summary: "বাংলাদেশ ব্যাংক নীতি সুদহার বাড়িয়েছে। মূল্যস্ফীতি নিয়ন্ত্রণ এর লক্ষ্য।" }), inputTokens: 50, outputTokens: 40 };
          }
          expect(user).toContain("Bangladesh Bank");
          return {
            text: JSON.stringify({
              headline: "Bangladesh Bank raises policy rate to curb inflation",
              summary: "Bangladesh's central bank raised its policy rate to curb inflation. Exporters warned of higher borrowing costs for factories and traders.",
              topics: ["finance", "business"], event_countries: ["BD"], affected_countries: ["BD"], importance: 4, sensitive: false,
              enough_information: true,
            }),
            inputTokens: 300, outputTokens: 60,
          };
        },
      },
    );

    expect(report.source_errors.map((e) => e.id)).toEqual(["bad"]);
    expect(report.new_articles).toBe(4); // 2 + 1 RSS, 1 GDELT
    expect(report.new_stories).toBe(2); // rate story (3 reports) + cricket
    expect(report.summaries_written).toBe(1);
    expect(report.translations).toBe(1);
    expect(report.breaking_approved).toBe(1);
    expect(calls).toEqual(["summary", "translate"]);

    const rateStory = [...store.clusters.values()].find((c) => c.breaking_status === "approved")!;
    expect(rateStory.event_countries).toEqual(["BD"]);
    expect(rateStory.topics).toContain("finance");
    const langs = [...store.summaries.values()].filter((s) => s.story_id === rateStory.id).map((s) => s.language).sort();
    expect(langs).toEqual(["bn", "en"]);
    // The single-source cricket item had too little text: approved publisher → headline-only, no AI call.
    const cricket = [...store.summaries.values()].find((s) => s.headline.includes("cricket"));
    expect(cricket?.kind).toBe("headline_only");
    expect(cricket?.summary).toBeNull();
    // Discovered GDELT publishers are registered but not approved.
    expect(store.sources.get("gdelt:three.example")?.status).toBe("discovered");

    // Second run with the same feeds: nothing new, no extra AI calls.
    const again = await runPipeline(cfg([src("one", "one.example", "BD"), src("two", "two.example", "US")]), {
      store, now: () => NOW, newId: () => `id${++n}`, log: () => {},
      fetchText: async (url, kind) => ({ status: 200, text: kind === "gdelt" ? gdelt : (feeds[url] ?? "") }),
      model: async () => { throw new Error("should not be called"); },
    });
    expect(again.new_articles).toBe(0);
    expect(again.ai_calls).toBe(0);
  });

  it("respects the daily AI budget", async () => {
    const store = new MemoryStore();
    store.aiCalls = 100; // cap already reached today
    let n = 0;
    const report = await runPipeline(cfg([src("one", "one.example", "BD")]), {
      store, now: () => NOW, newId: () => `b${++n}`, log: () => {},
      fetchText: async (_u, kind) => ({
        status: 200,
        text: kind === "gdelt" ? "{}" : rss([{ t: "Parliament approves new education budget for schools", d: longText("Education"), link: "https://one.example/e", at: "2026-11-03T11:00:00Z" }]),
      }),
      model: async () => { throw new Error("budget should block this"); },
    });
    expect(report.ai_budget_exhausted).toBe(true);
    expect(report.headline_only).toBe(1);
  });
});
