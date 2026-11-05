import { describe, expect, it } from "vitest";
import { dispatchNotifications } from "../src/cron";
import { route } from "../src/index";
import { validatePreferences } from "../src/routes";
import { sha256Hex } from "../src/auth";

const env = { SUPABASE_URL: "https://db.example", SUPABASE_SECRET_KEY: "sb_secret_test", ALLOWED_ORIGINS: "https://brief.example" };

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
}

/** A tiny fake of Supabase REST + Expo push, programmable per test. */
function fakeBackend(handlers: Record<string, (c: Call) => unknown>) {
  const calls: Call[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const c: Call = {
      method: init?.method ?? "GET",
      path: url.hostname === "exp.host" ? "expo" : url.pathname.replace("/rest/v1/", ""),
      query: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init?.headers),
    };
    calls.push(c);
    const key = `${c.method} ${c.path}`;
    const h = handlers[key] ?? handlers[c.path];
    const out = h ? h(c) : [];
    return new Response(out === undefined ? "" : JSON.stringify(out), { status: 200 });
  };
  return { calls, fetch: impl as typeof fetch };
}

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, language: "en", headline: `Story ${id}`, summary: "One sentence. Two sentences.", kind: "summary",
  event_countries: ["BD"], affected_countries: ["BD"], topics: ["business"], importance: 3, source_count: 2,
  source_confidence: "0.80", first_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  is_breaking: false, primary_source_name: "Daily", primary_source_url: "https://daily.example/a", primary_source_country: "BD", ...over,
});

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("preferences validation", () => {
  it("normalizes valid input", () => {
    const p = validatePreferences({ countries: ["bd", "JP"], topics: ["technology"], language: "en", timezone: "Asia/Dhaka", digest_times: ["18:00", "08:00"], push_enabled: true });
    expect(p.countries).toEqual(["BD", "JP"]);
    expect(p.digest_times).toEqual(["08:00", "18:00"]);
  });
  it("rejects invalid input", () => {
    expect(() => validatePreferences({ countries: ["XX"] })).toThrow(/countries/);
    expect(() => validatePreferences({ timezone: "Mars/Base" })).toThrow(/time zone/);
    expect(() => validatePreferences({ digest_times: ["25:00"] })).toThrow(/valid 24-hour/);
  });
});

describe("feed endpoint", () => {
  it("ranks candidates and returns coverage", async () => {
    const be = fakeBackend({
      "rpc/feed_candidates": () => [row(UUID(1)), row(UUID(2), { event_countries: ["JP"], affected_countries: ["JP"], topics: ["technology"], importance: 2 })],
      "rpc/coverage_counts": () => [{ country: "BD", stories_48h: 9 }, { country: "JP", stories_48h: 1 }],
    });
    const res = await route(new Request("https://api.example/v1/feed?countries=BD,JP&topics=business&lang=en"), env, be.fetch);
    const data = (await res.json()) as { stories: { id: string }[]; coverage: { country: string; level: string }[] };
    expect(data.stories.map((s) => s.id)).toEqual([UUID(1)]); // JP tech (importance 2, topic mismatch) filtered
    expect(data.coverage).toEqual([
      { country: "BD", stories_48h: 9, level: "good" },
      { country: "JP", stories_48h: 1, level: "limited" },
    ]);
    expect(res.headers.get("Cache-Control")).toContain("max-age=120");
    // New-style secret keys go in the apikey header only.
    const rpc = be.calls.find((c) => c.path === "rpc/feed_candidates")!;
    expect(rpc.headers.get("apikey")).toBe("sb_secret_test");
    expect(rpc.headers.get("Authorization")).toBeNull();
    expect(rpc.body).toMatchObject({ p_language: "en", p_countries: ["BD", "JP"], p_topics: ["business"] });
  });

  it("falls back to English when a translation is missing", async () => {
    const be = fakeBackend({
      "rpc/feed_candidates": (c) => ((c.body as { p_language: string }).p_language === "bn" ? [] : [row(UUID(3))]),
      "rpc/coverage_counts": () => [],
    });
    const res = await route(new Request("https://api.example/v1/feed?countries=BD&lang=bn"), env, be.fetch);
    const data = (await res.json()) as { stories: { language_fallback?: boolean }[] };
    expect(data.stories[0]?.language_fallback).toBe(true);
  });

  it("404s unknown stories and routes", async () => {
    const be = fakeBackend({});
    await expect(route(new Request("https://api.example/v1/stories/not-a-uuid"), env, be.fetch)).rejects.toMatchObject({ status: 404 });
    await expect(route(new Request("https://api.example/v1/nope"), env, be.fetch)).rejects.toMatchObject({ status: 404 });
  });
});

describe("anonymous installations", () => {
  it("registers, then requires the secret to update", async () => {
    let stored = "";
    const be = fakeBackend({
      "POST installations": (c) => {
        stored = (c.body as { secret_hash: string }).secret_hash;
        return [{ id: UUID(9) }];
      },
      "GET installations": () => [{ id: UUID(9), secret_hash: stored }],
      "PATCH installations": () => undefined,
      "POST preferences": () => undefined,
      "POST notification_schedules": () => undefined,
    });
    const reg = await route(new Request("https://api.example/v1/installations", { method: "POST", body: '{"platform":"ios"}' }), env, be.fetch);
    const { installation_id, secret } = (await reg.json()) as { installation_id: string; secret: string };
    expect(installation_id).toBe(UUID(9));
    expect(stored).toBe(await sha256Hex(secret));
    expect(stored).not.toContain(secret); // only the hash is stored

    const body = JSON.stringify({
      push_token: "ExponentPushToken[abc123]",
      preferences: { countries: ["BD"], topics: [], language: "en", timezone: "Asia/Dhaka", digest_times: ["08:00"], breaking_alerts: true, push_enabled: true },
    });
    const ok = await route(
      new Request("https://api.example/v1/installations/me", { method: "PUT", body, headers: { Authorization: `Bearer ${installation_id}.${secret}` } }),
      env,
      be.fetch,
    );
    const out = (await ok.json()) as { next_digest_at: string };
    expect(out.next_digest_at).toMatch(/T02:00:00\.000Z$/); // 08:00 Dhaka = 02:00 UTC
    const sched = be.calls.find((c) => c.path === "notification_schedules")!;
    expect(sched.body).toMatchObject({ timezone: "Asia/Dhaka", local_times: ["08:00"] });

    await expect(
      route(new Request("https://api.example/v1/installations/me", { method: "PUT", body, headers: { Authorization: `Bearer ${installation_id}.wrong-secret-wrong-secret` } }), env, be.fetch),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      route(new Request("https://api.example/v1/installations/me", { method: "DELETE" }), env, be.fetch),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("notification dispatcher", () => {
  it("sends top-3 digests once and drops dead tokens", async () => {
    const due = [
      { installation_id: UUID(1), push_token: "ExponentPushToken[a]", timezone: "Asia/Dhaka", local_times: ["08:00"], due_at: "2026-11-04T02:00:00Z", countries: ["BD"], topics: [], language: "en" },
      { installation_id: UUID(2), push_token: "ExponentPushToken[b]", timezone: "Asia/Dhaka", local_times: ["08:00", "20:00"], due_at: "2026-11-04T02:00:00Z", countries: ["BD"], topics: [], language: "en" },
    ];
    const be = fakeBackend({
      "rpc/claim_due_digests": () => due,
      "rpc/feed_candidates": () => [row(UUID(11)), row(UUID(12)), row(UUID(13)), row(UUID(14), { kind: "headline_only", summary: null, importance: 5 })],
      "POST notification_deliveries": (c) => (c.body as { installation_id: string }[]).map((r, i) => ({ id: i + 1, installation_id: r.installation_id })),
      "GET story_clusters": () => [],
      expo: (c) => ({
        data: (c.body as unknown[]).map((_, i) => (i === 0 ? { status: "ok", id: "t1" } : { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } })),
      }),
    });
    const r = await dispatchNotifications(env, new (await import("@brief/core")).SupabaseRest(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, be.fetch), new Date("2026-11-04T02:00:30Z"), be.fetch);
    expect(r).toMatchObject({ digests_claimed: 2, digests_sent: 1, tokens_removed: 1 });
    const push = be.calls.find((c) => c.path === "expo")!;
    const msgs = push.body as { title: string; body: string; data: { ids: string[] } }[];
    expect(msgs[0]!.title).toBe("Your Brief — Top 3 Stories");
    expect(msgs[0]!.data.ids).toHaveLength(3);
    expect(msgs[0]!.data.ids).not.toContain(UUID(14)); // headline-only never in digests
    // Feed candidates were loaded once for both readers (same preferences).
    expect(be.calls.filter((c) => c.path === "rpc/feed_candidates")).toHaveLength(1);
    // Schedules advanced: reader 2's next digest is 20:00 Dhaka = 14:00 UTC.
    const updates = be.calls.filter((c) => c.method === "PATCH" && c.path === "notification_schedules");
    expect((updates[1]!.body as { next_due_at: string }).next_due_at).toBe("2026-11-04T14:00:00.000Z");
    const tokenPatch = be.calls.find((c) => c.method === "PATCH" && c.path === "installations")!;
    expect(tokenPatch.body).toEqual({ push_token: null });
  });

  it("sends approved breaking stories to targets in their language", async () => {
    const be = fakeBackend({
      "rpc/claim_due_digests": () => [],
      "GET story_clusters": () => [{ id: UUID(50) }],
      "PATCH story_clusters": () => undefined,
      "rpc/breaking_targets": () => [
        { installation_id: UUID(1), push_token: "ExponentPushToken[a]", language: "en" },
        { installation_id: UUID(2), push_token: "ExponentPushToken[b]", language: "bn" },
      ],
      "GET feed_items": (c) =>
        c.query.get("language")?.includes("bn") ? [row(UUID(50), { language: "bn", headline: "বাংলা শিরোনাম" }), row(UUID(50))] : [row(UUID(50))],
      "POST notification_deliveries": (c) => (c.body as { installation_id: string }[]).map((r, i) => ({ id: i + 1, installation_id: r.installation_id })),
      expo: (c) => ({ data: (c.body as unknown[]).map(() => ({ status: "ok" })) }),
    });
    const { SupabaseRest } = await import("@brief/core");
    const r = await dispatchNotifications(env, new SupabaseRest(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, be.fetch), new Date(), be.fetch);
    expect(r.breaking_sent).toBe(2);
    const msgs = be.calls.find((c) => c.path === "expo")!.body as { body: string; title: string }[];
    expect(msgs.map((m) => m.body)).toEqual(["Story " + UUID(50), "বাংলা শিরোনাম"]);
    // Story marked as sent before delivery so it can't be sent twice.
    const mark = be.calls.find((c) => c.method === "PATCH" && c.path === "story_clusters")!;
    expect(mark.body).toEqual({ breaking_status: "sent" });
  });
});
