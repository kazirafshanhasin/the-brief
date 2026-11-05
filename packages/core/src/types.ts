import type { TopicId } from "./topics";

/** A story as served to clients (web + apps). One story = one cluster of reports about one event. */
export interface FeedStory {
  id: string;
  headline: string;
  /** 2–4 sentence summary. Null for headline-only entries (not enough authorized text to summarize). */
  summary: string | null;
  kind: "summary" | "headline_only";
  language: string;
  /** True when the requested language was unavailable and the reference (English) version is shown. */
  language_fallback?: boolean;
  /** Countries where the event happened. */
  event_countries: string[];
  /** Countries materially affected (may include event countries). */
  affected_countries: string[];
  topics: TopicId[];
  /** 1 (minor) – 5 (major). */
  importance: number;
  /** Number of independent reporting sources in the cluster. */
  source_count: number;
  /** Average trust score of sources, 0–1. */
  source_confidence: number;
  first_seen_at: string;
  updated_at: string;
  primary_source: { name: string; url: string; country: string | null } | null;
  is_breaking?: boolean;
}

export interface StorySource {
  name: string;
  domain: string;
  country: string | null;
  url: string;
  headline: string;
  published_at: string;
}

export interface StoryDetail extends FeedStory {
  sources: StorySource[];
  related: Pick<FeedStory, "id" | "headline" | "updated_at">[];
}

/** GitHub-only static mode: a story's public detail file, with every approved language version. */
export interface StaticStoryDetail extends StoryDetail {
  versions: Pick<FeedStory, "language" | "headline" | "summary" | "kind">[];
}

/** GitHub-only static mode: the public meta.json file. */
export interface StaticMeta {
  generated_at: string;
  /** Stories per event country in the last 48 hours, for limited-coverage notices. */
  story_counts_48h: Record<string, number>;
}

export interface Preferences {
  countries: string[];
  topics: TopicId[];
  language: string;
  timezone: string;
  /** Local times, "HH:MM", 24-hour, max 3. */
  digest_times: string[];
  breaking_alerts: boolean;
  push_enabled: boolean;
}

export interface CoverageEntry {
  country: string;
  stories_48h: number;
  level: "good" | "limited" | "none";
}

export const DEFAULT_PREFERENCES: Preferences = {
  countries: [],
  topics: [],
  language: "en",
  timezone: "UTC",
  digest_times: ["08:00"],
  breaking_alerts: true,
  push_enabled: false,
};
