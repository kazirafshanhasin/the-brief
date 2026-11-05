import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCalendars } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PREFERENCES, type Preferences, type TextSize } from "@brief/core/client";
import { api } from "./api";
import { authHeader, ensureCredentials, eraseCredentials, getCredentials } from "./credentials";
import { registerForPush } from "./push";

export interface AppPrefs extends Preferences {
  onboarded: boolean;
  textSize: TextSize;
  theme: "system" | "light" | "dark";
}

const KEY = "brief.prefs.v1";
const SAVED_KEY = "brief.saved.v1";

function deviceTimeZone(): string {
  try {
    return getCalendars()[0]?.timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}

const defaults = (): AppPrefs => ({
  ...DEFAULT_PREFERENCES,
  timezone: deviceTimeZone(),
  onboarded: false,
  textSize: "medium",
  theme: "system",
});

interface PrefsContextValue {
  prefs: AppPrefs | null;
  update: (patch: Partial<AppPrefs>) => void;
  /** Turn notifications on (asks permission) or off. Returns an error message on failure. */
  setNotifications: (enabled: boolean) => Promise<string | null>;
  syncError: string | null;
  eraseAll: () => Promise<void>;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

function serverPrefs(p: AppPrefs): Preferences {
  const { onboarded: _o, textSize: _t, theme: _th, ...rest } = p;
  return rest;
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AppPrefs | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        const stored = raw ? (JSON.parse(raw) as Partial<AppPrefs>) : {};
        // Keep the time zone current when the reader travels.
        setPrefs({ ...defaults(), ...stored, timezone: deviceTimeZone() });
      })
      .catch(() => setPrefs(defaults()));
  }, []);

  /** Push the delivery-relevant settings to the server (only if this device has registered). */
  const sync = useCallback((p: AppPrefs) => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      const creds = await getCredentials();
      if (!creds) return;
      try {
        await api.updateInstallation(authHeader(creds), { preferences: serverPrefs(p) });
        setSyncError(null);
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : "Couldn’t update notification settings.");
      }
    }, 800);
  }, []);

  const update = useCallback(
    (patch: Partial<AppPrefs>) => {
      setPrefs((prev) => {
        const next = { ...(prev ?? defaults()), ...patch };
        AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
        const serverKeys: (keyof Preferences)[] = ["countries", "topics", "language", "timezone", "digest_times", "breaking_alerts"];
        if (next.push_enabled && serverKeys.some((k) => k in patch)) sync(next);
        return next;
      });
    },
    [sync],
  );

  const setNotifications = useCallback(
    async (enabled: boolean): Promise<string | null> => {
      const current = prefs ?? defaults();
      if (!enabled) {
        const next = { ...current, push_enabled: false };
        update({ push_enabled: false });
        const creds = await getCredentials();
        if (creds) {
          try {
            await api.updateInstallation(authHeader(creds), { push_token: null, preferences: serverPrefs(next) });
          } catch (e) {
            return e instanceof Error ? e.message : "Couldn’t turn notifications off on the server.";
          }
        }
        return null;
      }
      const push = await registerForPush();
      if (!push.ok) return push.reason;
      try {
        const creds = await ensureCredentials();
        const next = { ...current, push_enabled: true };
        await api.updateInstallation(authHeader(creds), { push_token: push.token, preferences: serverPrefs(next) });
        update({ push_enabled: true });
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn’t turn on notifications.";
      }
    },
    [prefs, update],
  );

  const eraseAll = useCallback(async () => {
    await eraseCredentials();
    await AsyncStorage.multiRemove([KEY, SAVED_KEY]);
    setPrefs(defaults());
  }, []);

  const value = useMemo(() => ({ prefs, update, setNotifications, syncError, eraseAll }), [prefs, update, setNotifications, syncError, eraseAll]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside PrefsProvider");
  return ctx;
}

export { SAVED_KEY };
