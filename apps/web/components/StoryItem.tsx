"use client";

import Link from "next/link";
import type { FeedStory } from "@brief/core";
import { storyWhere, timeAgo } from "@/lib/format";
import { toggleSaved, useSaved } from "@/lib/prefs";

export function StoryItem({ story }: { story: FeedStory }) {
  const saved = useSaved().some((s) => s.id === story.id);
  const where = storyWhere(story);
  return (
    <li className="story">
      <p className="story-where">
        {story.is_breaking ? <span className="story-breaking">Breaking · </span> : null}
        {where}
      </p>
      <h3>
        <Link href={`/story/${story.id}`}>{story.headline}</Link>
      </h3>
      {story.summary ? <p className="story-summary">{story.summary}</p> : null}
      <div className="story-foot">
        {story.primary_source ? (
          <a href={story.primary_source.url} target="_blank" rel="noopener noreferrer">
            {story.primary_source.name}
          </a>
        ) : null}
        {story.source_count > 1 ? <span>{story.source_count} sources</span> : null}
        <span>{timeAgo(story.updated_at)}</span>
        {story.kind === "headline_only" ? <span className="tag">Headline only — read at the source</span> : null}
        {story.language_fallback ? <span className="tag">In English</span> : null}
        <button
          type="button"
          className="link-button save"
          aria-pressed={saved}
          onClick={() => toggleSaved({ id: story.id, headline: story.headline, summary: story.summary, where })}
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </li>
  );
}
