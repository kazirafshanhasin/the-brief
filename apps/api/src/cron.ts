import { BREAKING_RULES, SupabaseRest, inList, nextDigestAt, pickDigest, type FeedStory } from "@brief/core";
import type { Env } from "./env";
import { breakingMessage, digestMessage, sendPush, type PushMessage, type PushTicket } from "./push";
import { loadCandidates, loadStoriesByIds } from "./stories";

interface DueDigest {
  installation_id: string;
  push_token: string;
  timezone: string;
  local_times: string[];
  due_at: string;
  countries: string[] | null;
  topics: string[] | null;
  language: string | null;
}

export interface DispatchReport {
  digests_claimed: number;
  digests_sent: number;
  breaking_stories: number;
  breaking_sent: number;
  tokens_removed: number;
}

/** Runs every minute. Each part is idempotent: deliveries are keyed and unique per device. */
export async function dispatchNotifications(env: Env, db: SupabaseRest, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<DispatchReport> {
  const report: DispatchReport = { digests_claimed: 0, digests_sent: 0, breaking_stories: 0, breaking_sent: 0, tokens_removed: 0 };
  await sendDigests(env, db, now, fetchImpl, report);
  await sendBreaking(env, db, fetchImpl, report);
  return report;
}

async function sendDigests(env: Env, db: SupabaseRest, now: Date, fetchImpl: typeof fetch, report: DispatchReport) {
  const due = await db.rpc<DueDigest[]>("claim_due_digests", { max_rows: 100 });
  report.digests_claimed = due.length;
  if (due.length === 0) return;

  // Readers with identical preferences share one candidate query.
  const candidateCache = new Map<string, Promise<FeedStory[]>>();
  const messages: { msg: PushMessage; d: DueDigest; ids: string[] }[] = [];
  for (const d of due) {
    const countries = d.countries ?? [];
    const topics = d.topics ?? [];
    const language = d.language ?? "en";
    const key = `${language}|${[...countries].sort().join(",")}|${[...topics].sort().join(",")}`;
    if (!candidateCache.has(key)) candidateCache.set(key, loadCandidates(db, { countries, topics, language, hours: 24 }));
    const top = pickDigest(await candidateCache.get(key)!, { countries, topics, now });
    if (top.length > 0) {
      messages.push({ msg: digestMessage(d.push_token, top), d, ids: top.map((s) => s.id) });
    }
  }

  // Idempotency: only devices whose delivery row is newly inserted get a push.
  const rows = messages.map((m) => ({
    installation_id: m.d.installation_id,
    story_id: m.ids[0] ?? null,
    kind: "digest",
    dedupe_key: `digest:${m.d.due_at}`,
    status: "queued",
  }));
  const inserted = rows.length
    ? await db.insert<{ id: number; installation_id: string }>("notification_deliveries", rows, {
        onConflict: "installation_id,dedupe_key",
        resolution: "ignore",
        returning: true,
        select: "id,installation_id",
      })
    : [];
  const fresh = new Map(inserted.map((r) => [r.installation_id, r.id]));
  const toSend = messages.filter((m) => fresh.has(m.d.installation_id));
  const tickets = await sendPush(toSend.map((m) => m.msg), env.EXPO_ACCESS_TOKEN, fetchImpl);
  await recordTickets(db, toSend.map((m) => ({ deliveryId: fresh.get(m.d.installation_id)!, installationId: m.d.installation_id })), tickets, report);
  report.digests_sent = tickets.filter((t) => t.status === "ok").length;

  // Advance every claimed schedule, including those with nothing to send.
  for (const d of due) {
    const next = nextDigestAt(d.local_times, d.timezone, now);
    await db.update("notification_schedules", `installation_id=eq.${d.installation_id}`, {
      next_due_at: next?.toISOString() ?? null,
      claimed_at: null,
      last_sent_at: now.toISOString(),
    });
  }
}

async function sendBreaking(env: Env, db: SupabaseRest, fetchImpl: typeof fetch, report: DispatchReport) {
  // 'approved' is set by the pipeline for auto-cleared events, or by an editor for held ones.
  const stories = await db.select<{ id: string }>("story_clusters", "select=id&breaking_status=eq.approved&order=updated_at.desc&limit=3");
  report.breaking_stories = stories.length;
  for (const { id } of stories) {
    // Mark first so a slow run can't send the same story twice.
    await db.update("story_clusters", `id=eq.${id}&breaking_status=eq.approved`, { breaking_status: "sent" });
    const targets = await db.rpc<{ installation_id: string; push_token: string; language: string }[]>("breaking_targets", {
      p_story: id,
      p_cap: BREAKING_RULES.dailyCapPerUser,
    });
    if (targets.length === 0) continue;
    const langs = [...new Set(targets.map((t) => t.language))];
    const versions = new Map<string, FeedStory>();
    for (const lang of langs) {
      const [s] = await loadStoriesByIds(db, [id], lang);
      if (s) versions.set(lang, s);
    }
    const inserted = await db.insert<{ id: number; installation_id: string }>(
      "notification_deliveries",
      targets.map((t) => ({ installation_id: t.installation_id, story_id: id, kind: "breaking", dedupe_key: `breaking:${id}`, status: "queued" })),
      { onConflict: "installation_id,dedupe_key", resolution: "ignore", returning: true, select: "id,installation_id" },
    );
    const fresh = new Map(inserted.map((r) => [r.installation_id, r.id]));
    const send = targets.filter((t) => fresh.has(t.installation_id) && versions.has(t.language));
    const tickets = await sendPush(
      send.map((t) => breakingMessage(t.push_token, versions.get(t.language)!)),
      env.EXPO_ACCESS_TOKEN,
      fetchImpl,
    );
    await recordTickets(db, send.map((t) => ({ deliveryId: fresh.get(t.installation_id)!, installationId: t.installation_id })), tickets, report);
    report.breaking_sent += tickets.filter((t) => t.status === "ok").length;
  }
}

async function recordTickets(
  db: SupabaseRest,
  targets: { deliveryId: number; installationId: string }[],
  tickets: PushTicket[],
  report: DispatchReport,
) {
  const ok: number[] = [];
  const dead: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = tickets[i];
    const target = targets[i]!;
    if (t?.status === "ok") {
      ok.push(target.deliveryId);
    } else {
      await db.update("notification_deliveries", `id=eq.${target.deliveryId}`, { status: "error", error: (t?.message ?? "unknown").slice(0, 300) });
      // The app was uninstalled or the token rotated: stop sending to it.
      if (t?.details?.error === "DeviceNotRegistered") dead.push(target.installationId);
    }
  }
  if (ok.length) await db.update("notification_deliveries", `id=in.(${ok.join(",")})`, { status: "sent" });
  if (dead.length) {
    await db.update("installations", `id=in.${inList(dead)}`, { push_token: null });
    report.tokens_removed += dead.length;
  }
}
