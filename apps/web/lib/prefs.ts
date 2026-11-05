"use client";

import { useSyncExternalStore } from "react";
import type { Preferences, TextSize } from "@brief/core";

/** Everything the website remembers lives in this browser only (no account, no cookies). */
export interface WebPrefs extends Preferences {
  onboarded: boolean;
  textSize: TextSize;
  theme: "system" | "light" | "dark";
}

const KEY = "brief.prefs.v1";
const SAVED_KEY = "brief.saved.v1";
const EVENT = "brief:storage";

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function defaultPrefs(): WebPrefs {
  return {
    countries: [],
    topics: [],
    language: "en",
    timezone: browserTimeZone(),
    digest_times: ["08:00"],
    breaking_alerts: false,
    push_enabled: false,
    onboarded: false,
    textSize: "medium",
    theme: "system",
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode: preferences last for this tab only */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

// Snapshot caching: useSyncExternalStore needs a stable reference while the raw value is unchanged.
let prefsRaw: string | null | undefined;
let prefsValue: WebPrefs | null = null;
function prefsSnapshot(): WebPrefs {
  const raw = read(KEY);
  if (raw !== prefsRaw || !prefsValue) {
    prefsRaw = raw;
    try {
      prefsValue = raw ? { ...defaultPrefs(), ...(JSON.parse(raw) as Partial<WebPrefs>) } : defaultPrefs();
    } catch {
      prefsValue = defaultPrefs();
    }
  }
  return prefsValue;
}

/** Null during server render and the first client render (prevents hydration mismatches). */
export function usePrefs(): WebPrefs | null {
  return useSyncExternalStore(subscribe, prefsSnapshot, () => null);
}

export function savePrefs(next: Partial<WebPrefs>) {
  write(KEY, JSON.stringify({ ...prefsSnapshot(), ...next }));
}

export function resetAll() {
  write(KEY, null);
  write(SAVED_KEY, null);
}

// ───────── Saved stories ─────────

export interface SavedStory {
  id: string;
  headline: string;
  summary: string | null;
  where: string;
  saved_at: string;
}

let savedRaw: string | null | undefined;
let savedValue: SavedStory[] = [];
function savedSnapshot(): SavedStory[] {
  const raw = read(SAVED_KEY);
  if (raw !== savedRaw) {
    savedRaw = raw;
    try {
      savedValue = raw ? (JSON.parse(raw) as SavedStory[]) : [];
    } catch {
      savedValue = [];
    }
  }
  return savedValue;
}
const EMPTY: SavedStory[] = [];

export function useSaved(): SavedStory[] {
  return useSyncExternalStore(subscribe, savedSnapshot, () => EMPTY);
}

export function toggleSaved(story: Omit<SavedStory, "saved_at">) {
  const list = savedSnapshot();
  const next = list.some((s) => s.id === story.id)
    ? list.filter((s) => s.id !== story.id)
    : [{ ...story, saved_at: new Date().toISOString() }, ...list].slice(0, 200);
  write(SAVED_KEY, JSON.stringify(next));
}
