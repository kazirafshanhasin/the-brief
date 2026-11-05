import { SupabaseRest, SupabaseError } from "@brief/core";
import { dispatchNotifications } from "./cron";
import type { Env } from "./env";
import { HttpError, corsHeaders, json, withHeaders } from "./http";
import {
  handleCoverage,
  handleDeleteInstallation,
  handleExplore,
  handleFeed,
  handleRegister,
  handleStoriesByIds,
  handleStory,
  handleUpdateInstallation,
} from "./routes";

export type { Env };

function database(env: Env, fetchImpl?: typeof fetch): SupabaseRest {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new HttpError(503, "API is not configured");
  return new SupabaseRest(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, fetchImpl);
}

export async function route(request: Request, env: Env, fetchImpl?: typeof fetch): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;

  if (method === "GET" && path === "/v1/health") return json({ ok: true });
  const db = database(env, fetchImpl);

  if (method === "GET") {
    if (path === "/v1/feed") return handleFeed(url, db);
    if (path === "/v1/explore") return handleExplore(url, db);
    if (path === "/v1/coverage") return handleCoverage(url, db);
    if (path === "/v1/stories") return handleStoriesByIds(url, db);
    const story = /^\/v1\/stories\/([^/]+)$/.exec(path);
    if (story) return handleStory(url, story[1]!, db);
  }
  if (path === "/v1/installations" && method === "POST") return handleRegister(request, db);
  if (path === "/v1/installations/me") {
    if (method === "PUT") return handleUpdateInstallation(request, db);
    if (method === "DELETE") return handleDeleteInstallation(request, db);
  }
  throw new HttpError(404, "Not found");
}

/** Cache public GET responses at the edge so repeated feed requests don't hit the database. */
async function cached(request: Request, ctx: ExecutionContext, produce: () => Promise<Response>): Promise<Response> {
  if (request.method !== "GET") return produce();
  const url = new URL(request.url);
  url.searchParams.sort();
  const key = new Request(url.toString(), { method: "GET" });
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await produce();
  if (res.ok && /max-age=\d+/.test(res.headers.get("Cache-Control") ?? "")) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request, env.ALLOWED_ORIGINS);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const res = await cached(request, ctx, () => route(request, env));
      return withHeaders(res, cors);
    } catch (err) {
      if (err instanceof HttpError) return withHeaders(json({ error: err.message }, { status: err.status }), cors);
      console.error(err instanceof SupabaseError ? `${err.message}: ${err.body}` : err);
      return withHeaders(json({ error: "Internal error" }, { status: 500 }), cors);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      dispatchNotifications(env, database(env))
        .then((r) => {
          if (r.digests_claimed || r.breaking_stories) console.log(JSON.stringify(r));
        })
        .catch((err) => console.error("dispatch failed", err instanceof SupabaseError ? err.body : err)),
    );
  },
} satisfies ExportedHandler<Env>;
