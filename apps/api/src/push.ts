/** Expo Push API client. https://docs.expo.dev/push-notifications/sending-notifications/ */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId?: string;
  sound?: "default" | null;
  priority?: "default" | "normal" | "high";
}

export interface PushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH = 100;

export function isExpoPushToken(token: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token);
}

export async function sendPush(
  messages: PushMessage[],
  accessToken?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PushTicket[]> {
  const tickets: PushTicket[] = [];
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(batch) });
      const body = (await res.json()) as { data?: PushTicket[]; errors?: { message: string }[] };
      if (!res.ok || !body.data) {
        const msg = body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
        tickets.push(...batch.map(() => ({ status: "error" as const, message: msg })));
      } else {
        tickets.push(...body.data);
      }
    } catch (err) {
      tickets.push(...batch.map(() => ({ status: "error" as const, message: err instanceof Error ? err.message : String(err) })));
    }
  }
  return tickets;
}

export function digestMessage(token: string, headlines: { id: string; headline: string }[]): PushMessage {
  return {
    to: token,
    title: "Your Brief — Top 3 Stories",
    body: headlines.map((h, i) => `${i + 1}. ${h.headline}`).join("\n"),
    data: { type: "digest", ids: headlines.map((h) => h.id) },
    channelId: "digest",
    sound: "default",
    priority: "normal",
  };
}

export function breakingMessage(token: string, story: { id: string; headline: string }): PushMessage {
  return {
    to: token,
    title: "Breaking",
    body: story.headline,
    data: { type: "breaking", id: story.id },
    channelId: "breaking",
    sound: "default",
    priority: "high",
  };
}
