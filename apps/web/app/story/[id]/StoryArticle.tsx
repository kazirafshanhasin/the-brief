"use client";

import type { StaticStoryDetail } from "@brief/core";
import { longDate, storyWhere } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { SaveButton } from "./SaveButton";

/** Pre-rendered in the reference language, then switched to the reader's language when there is a version in it. */
export function StoryArticle({ story }: { story: StaticStoryDetail }) {
  const language = usePrefs()?.language ?? story.language;
  const version = story.versions.find((v) => v.language === language);
  const { headline, summary } = version ?? story;
  const where = storyWhere(story);
  return (
    <article className="article">
      <p className="story-where">
        {story.is_breaking ? <span className="story-breaking">Breaking · </span> : null}
        {where}
      </p>
      <h1>{headline}</h1>
      {summary ? (
        <p className="lede">{summary}</p>
      ) : (
        <p className="note">
          We only have the headline for this story, so there’s no summary. Read the full report at the source below.
        </p>
      )}
      <div className="story-foot">
        <span>Updated {longDate(story.updated_at, "UTC")} UTC</span>
        {version ? null : <span className="tag">Shown in English</span>}
        <SaveButton story={{ id: story.id, headline, summary, where }} />
      </div>
      {summary ? (
        <p className="selected-line">Summary written from the publishers’ own excerpts, linked below.</p>
      ) : null}
    </article>
  );
}
