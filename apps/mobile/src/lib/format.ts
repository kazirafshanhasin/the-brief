import { countryName, topicLabel, type FeedStory } from "@brief/core/client";

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

export function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();
}
