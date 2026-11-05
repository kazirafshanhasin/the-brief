export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit & { cacheSeconds?: number } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  if (init.cacheSeconds && init.cacheSeconds > 0) {
    headers.set("Cache-Control", `public, max-age=${init.cacheSeconds}, s-maxage=${init.cacheSeconds}`);
  } else if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

export function corsHeaders(request: Request, allowed: string | undefined): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  const list = (allowed ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.includes(origin) && !list.includes("*")) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function withHeaders(res: Response, extra: Record<string, string>): Response {
  if (Object.keys(extra).length === 0) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  return out;
}

export async function readJson<T>(request: Request, maxBytes = 16_384): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request body too large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export function listParam(url: URL, name: string, max: number): string[] {
  const raw = url.searchParams.get(name);
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, max);
}
