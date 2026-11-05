import type { CoverageEntry, FeedStory, Preferences, StoryDetail } from "@brief/core/client";
import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
    });
  } catch {
    throw new ApiError(0, "No connection. Check your internet and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  return body;
}

function qs(p: Record<string, string | string[]>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    const value = Array.isArray(v) ? v.join(",") : v;
    if (value) s.set(k, value);
  }
  const out = s.toString();
  return out ? `?${out}` : "";
}

export const api = {
  feed: (q: { countries: string[]; topics: string[]; lang: string }) =>
    request<{ stories: FeedStory[]; coverage: CoverageEntry[] }>(`/v1/feed${qs(q)}`),
  explore: (q: { countries: string[]; topics: string[]; lang: string }) => request<{ stories: FeedStory[] }>(`/v1/explore${qs(q)}`),
  story: (id: string, lang: string) => request<StoryDetail>(`/v1/stories/${encodeURIComponent(id)}${qs({ lang })}`),
  storiesByIds: (ids: string[], lang: string) => request<{ stories: FeedStory[] }>(`/v1/stories${qs({ ids, lang })}`),

  register: (platform: string) =>
    request<{ installation_id: string; secret: string }>("/v1/installations", { method: "POST", body: JSON.stringify({ platform }) }),
  updateInstallation: (auth: string, body: { preferences?: Preferences; push_token?: string | null }) =>
    request<{ ok: true; next_digest_at: string | null }>("/v1/installations/me", {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth}` },
      body: JSON.stringify(body),
    }),
  deleteInstallation: (auth: string) =>
    request<{ ok: true }>("/v1/installations/me", { method: "DELETE", headers: { Authorization: `Bearer ${auth}` } }),
};
