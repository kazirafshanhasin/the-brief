/**
 * Minimal Supabase (PostgREST) client over fetch. Works in Node 20+ and Cloudflare Workers.
 * Server-side only: it is constructed with the project's secret key.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class SupabaseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export interface InsertOptions {
  onConflict?: string;
  /** "merge" = upsert, "ignore" = insert … on conflict do nothing. */
  resolution?: "merge" | "ignore";
  returning?: boolean;
  select?: string;
}

export class SupabaseRest {
  private readonly base: string;
  constructor(
    url: string,
    private readonly key: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {
    this.base = `${url.replace(/\/+$/, "")}/rest/v1`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { apikey: this.key, "Content-Type": "application/json", ...extra };
    // Legacy service_role keys are JWTs and go in Authorization; new sb_secret_ keys use apikey only.
    if (!this.key.startsWith("sb_")) h.Authorization = `Bearer ${this.key}`;
    return h;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.base}/${path}`, init);
    const text = await res.text();
    if (!res.ok) throw new SupabaseError(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]} → ${res.status}`, res.status, text);
    return (text ? JSON.parse(text) : null) as T;
  }

  /** `query` is a PostgREST query string, e.g. "select=id,name&status=eq.approved&limit=10". */
  select<T>(table: string, query = "select=*"): Promise<T[]> {
    return this.request<T[]>(`${table}?${query}`, { method: "GET", headers: this.headers() });
  }

  async insert<T = unknown>(table: string, rows: object | object[], opts: InsertOptions = {}): Promise<T[]> {
    const params = new URLSearchParams();
    if (opts.onConflict) params.set("on_conflict", opts.onConflict);
    if (opts.returning && opts.select) params.set("select", opts.select);
    const prefer = [opts.returning ? "return=representation" : "return=minimal"];
    if (opts.resolution === "merge") prefer.push("resolution=merge-duplicates");
    if (opts.resolution === "ignore") prefer.push("resolution=ignore-duplicates");
    const qs = params.toString();
    const out = await this.request<T[] | null>(`${table}${qs ? `?${qs}` : ""}`, {
      method: "POST",
      headers: this.headers({ Prefer: prefer.join(",") }),
      body: JSON.stringify(rows),
    });
    return out ?? [];
  }

  async update<T = unknown>(table: string, filter: string, patch: object, returning = false): Promise<T[]> {
    const out = await this.request<T[] | null>(`${table}?${filter}`, {
      method: "PATCH",
      headers: this.headers({ Prefer: returning ? "return=representation" : "return=minimal" }),
      body: JSON.stringify(patch),
    });
    return out ?? [];
  }

  async delete(table: string, filter: string): Promise<void> {
    await this.request(`${table}?${filter}`, { method: "DELETE", headers: this.headers({ Prefer: "return=minimal" }) });
  }

  rpc<T>(fn: string, args: object = {}): Promise<T> {
    return this.request<T>(`rpc/${fn}`, { method: "POST", headers: this.headers(), body: JSON.stringify(args) });
  }
}

/** Quote values for PostgREST `in.(…)` filters. */
export function inList(values: string[]): string {
  return `(${values.map((v) => `"${v.replace(/["\\]/g, (m) => `\\${m}`)}"`).join(",")})`;
}

/** Postgres array literal for `ov.`/`cs.` filters: {BD,US}. */
export function pgArray(values: string[]): string {
  return `{${values.map((v) => (/^[A-Za-z0-9_-]+$/.test(v) ? v : `"${v.replace(/["\\]/g, (m) => `\\${m}`)}"`)).join(",")}}`;
}
