import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SAVED_KEY, usePrefs } from "./prefs";

/** Saved stories live on this device only (no account, no sync between devices). */
export interface SavedStory {
  id: string;
  headline: string;
  summary: string | null;
  where: string;
  saved_at: string;
}

interface SavedContextValue {
  saved: SavedStory[];
  isSaved: (id: string) => boolean;
  toggle: (s: Omit<SavedStory, "saved_at">) => void;
}

const SavedContext = createContext<SavedContextValue | null>(null);

export function SavedProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<SavedStory[]>([]);
  const { prefs } = usePrefs();

  // Reload whenever prefs reset (e.g. after "Erase my data").
  const resetMarker = prefs?.onboarded;
  useEffect(() => {
    AsyncStorage.getItem(SAVED_KEY)
      .then((raw) => setSaved(raw ? (JSON.parse(raw) as SavedStory[]) : []))
      .catch(() => setSaved([]));
  }, [resetMarker]);

  const toggle = useCallback((s: Omit<SavedStory, "saved_at">) => {
    setSaved((prev) => {
      const next = prev.some((x) => x.id === s.id)
        ? prev.filter((x) => x.id !== s.id)
        : [{ ...s, saved_at: new Date().toISOString() }, ...prev].slice(0, 200);
      AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(() => ({ saved, isSaved: (id: string) => saved.some((s) => s.id === id), toggle }), [saved, toggle]);
  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

export function useSaved(): SavedContextValue {
  const ctx = useContext(SavedContext);
  if (!ctx) throw new Error("useSaved must be used inside SavedProvider");
  return ctx;
}
