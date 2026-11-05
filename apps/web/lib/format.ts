import { countryName, topicLabel, type FeedStory } from "@brief/core";

/** "Bangladesh · Business & Economy" — where the event happened, then its main topic. */
export function storyWhere(s: Pick<FeedStory, "event_countries" | "topics">): string {
  const place = s.event_countries.length ? s.event_countries.slice(0, 2).map(countryName).join(" & ") : "World";
  const topic = s.topics[0] ? topicLabel(s.topics[0]) : null;
  return topic ? `${place} · ${topic}` : place;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function longDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone }).format(new Date(iso));
}
