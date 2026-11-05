import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { api } from "./api";

/**
 * Anonymous device credentials, kept in the Keychain (iOS) / Keystore (Android).
 * Created only when the reader turns on notifications — reading news needs no server record.
 */
const KEY = "brief.installation.v1";

interface Credentials {
  id: string;
  secret: string;
}

export async function getCredentials(): Promise<Credentials | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export async function ensureCredentials(): Promise<Credentials> {
  const existing = await getCredentials();
  if (existing) return existing;
  const r = await api.register(Platform.OS);
  const creds = { id: r.installation_id, secret: r.secret };
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
  return creds;
}

export function authHeader(c: Credentials): string {
  return `${c.id}.${c.secret}`;
}

/** Delete the server record (if any) and forget the credentials. */
export async function eraseCredentials(): Promise<void> {
  const c = await getCredentials();
  if (c) {
    try {
      await api.deleteInstallation(authHeader(c));
    } catch (err) {
      // 401 means the server already forgot us; anything else should be surfaced.
      if (!(err instanceof Error && "status" in err && (err as { status: number }).status === 401)) throw err;
    }
  }
  await SecureStore.deleteItemAsync(KEY);
}
