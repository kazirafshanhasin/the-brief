import {
  DEFAULT_PREFERENCES,
  SupabaseRest,
  isCountryCode,
  isLanguageCode,
  isTopicId,
  isValidTimeZone,
  nextDigestAt,
  normalizeDigestTimes,
  rankFeed,
  type Preferences,
} from "@brief/core";
import { authenticate, newSecret, sha256Hex } from "./auth";
import { HttpError, json, listParam, readJson } from "./http";
import { isExpoPushToken } from "./push";
import { loadCandidates, loadCoverage, loadStoriesByIds, loadStoryDetail } from "./stories";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readerParams(url: URL) {
  const countries = listParam(url, "countries", 30).map((c) => c.toUpperCase()).filter(isCountryCode);
  const topics = listParam(url, "topics", 12).filter(isTopicId);
  const lang = url.searchParams.get("lang") ?? "en";
  const language = isLanguageCode(lang) ? lang : "en";
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 30) || 30));
  return { countries, topics, language, limit };
}

export async function handleFeed(url: URL, db: SupabaseRest): Promise<Response> {
  const p = readerParams(url);
  const [candidates, coverage] = await Promise.all([loadCandidates(db, p), loadCoverage(db, p.countries)]);
  const stories = rankFeed(candidates, { countries: p.countries, topics: p.topics, now: new Date() }, { limit: p.limit });
  return json({ stories, coverage, generated_at: new Date().toISOString() }, { cacheSeconds: 120 });
}

/** Explore: browse without touching saved preferences. One optional country/topic filter. */
export async function handleExplore(url: URL, db: SupabaseRest): Promise<Response> {
  const p = readerParams(url);
  const candidates = await loadCandidates(db, { ...p, hours: 36 });
  const stories = rankFeed(candidates, { countries: p.countries, topics: p.topics, now: new Date() }, {
    limit: p.limit,
    globalImportanceThreshold: p.countries.length || p.topics.length ? 5 : 1,
  });
  return json({ stories, generated_at: new Date().toISOString() }, { cacheSeconds: 180 });
}

export async function handleStory(url: URL, id: string, db: SupabaseRest): Promise<Response> {
  if (!UUID.test(id)) throw new HttpError(404, "Story not found");
  const { language } = readerParams(url);
  const story = await loadStoryDetail(db, id, language);
  if (!story) throw new HttpError(404, "Story not found");
  return json(story, { cacheSeconds: 300 });
}

export async function handleStoriesByIds(url: URL, db: SupabaseRest): Promise<Response> {
  const ids = listParam(url, "ids", 10).filter((i) => UUID.test(i));
  const { language } = readerParams(url);
  return json({ stories: await loadStoriesByIds(db, ids, language) }, { cacheSeconds: 300 });
}

export async function handleCoverage(url: URL, db: SupabaseRest): Promise<Response> {
  const { countries } = readerParams(url);
  return json({ coverage: await loadCoverage(db, countries) }, { cacheSeconds: 600 });
}

// ───────────── Anonymous installations ─────────────

export async function handleRegister(request: Request, db: SupabaseRest): Promise<Response> {
  const body = await readJson<{ platform?: string }>(request).catch(() => ({ platform: undefined }));
  const platform = ["ios", "android", "web"].includes(body.platform ?? "") ? body.platform : null;
  const secret = newSecret();
  const [row] = await db.insert<{ id: string }>(
    "installations",
    { secret_hash: await sha256Hex(secret), platform },
    { returning: true, select: "id" },
  );
  if (!row) throw new HttpError(500, "Could not register device");
  return json({ installation_id: row.id, secret }, { status: 201 });
}

export interface InstallationUpdate {
  preferences?: Partial<Preferences>;
  push_token?: string | null;
}

/** Validate a client preference payload. Returns a complete, normalized Preferences object. */
export function validatePreferences(input: Partial<Preferences>): Preferences {
  const p = { ...DEFAULT_PREFERENCES, ...input };
  const countries = [...new Set((p.countries ?? []).map((c) => String(c).toUpperCase()))];
  if (countries.length > 30 || !countries.every(isCountryCode)) throw new HttpError(422, "Invalid countries (max 30 ISO codes)");
  const topics = [...new Set(p.topics ?? [])];
  if (!topics.every((t) => isTopicId(String(t)))) throw new HttpError(422, "Invalid topics");
  if (!isLanguageCode(String(p.language))) throw new HttpError(422, "Unsupported language");
  if (!isValidTimeZone(String(p.timezone))) throw new HttpError(422, "Invalid time zone");
  const times = normalizeDigestTimes((p.digest_times ?? []).map(String));
  if (times.errors.length) throw new HttpError(422, times.errors.join(" "));
  return {
    countries,
    topics,
    language: p.language,
    timezone: p.timezone,
    digest_times: times.times,
    breaking_alerts: Boolean(p.breaking_alerts),
    push_enabled: Boolean(p.push_enabled),
  };
}

export async function handleUpdateInstallation(request: Request, db: SupabaseRest): Promise<Response> {
  const id = await authenticate(request, db);
  const body = await readJson<InstallationUpdate>(request);
  const now = new Date();

  const patch: Record<string, unknown> = { last_active_at: now.toISOString() };
  if (body.push_token !== undefined) {
    if (body.push_token !== null && !isExpoPushToken(body.push_token)) throw new HttpError(422, "Invalid push token");
    if (body.push_token) {
      // A token belongs to one device: detach it from any older installation (e.g. after reinstall).
      await db.update("installations", `push_token=eq.${encodeURIComponent(body.push_token)}&id=neq.${id}`, { push_token: null });
    }
    patch.push_token = body.push_token;
    patch.push_token_updated_at = now.toISOString();
  }
  await db.update("installations", `id=eq.${id}`, patch);

  let next: string | null = null;
  if (body.preferences) {
    const prefs = validatePreferences(body.preferences);
    await db.insert(
      "preferences",
      {
        installation_id: id,
        countries: prefs.countries,
        topics: prefs.topics,
        language: prefs.language,
        breaking_alerts: prefs.breaking_alerts && prefs.push_enabled,
        settings: { timezone: prefs.timezone, digest_times: prefs.digest_times, push_enabled: prefs.push_enabled },
        updated_at: now.toISOString(),
      },
      { onConflict: "installation_id", resolution: "merge" },
    );
    const times = prefs.push_enabled ? prefs.digest_times : [];
    next = nextDigestAt(times, prefs.timezone, now)?.toISOString() ?? null;
    await db.insert(
      "notification_schedules",
      { installation_id: id, timezone: prefs.timezone, local_times: times, next_due_at: next, claimed_at: null },
      { onConflict: "installation_id", resolution: "merge" },
    );
  }
  return json({ ok: true, next_digest_at: next });
}

/** Erase everything the server holds about this device. */
export async function handleDeleteInstallation(request: Request, db: SupabaseRest): Promise<Response> {
  const id = await authenticate(request, db);
  await db.delete("installations", `id=eq.${id}`); // cascades to preferences, schedules, deliveries
  return json({ ok: true, deleted: true });
}
