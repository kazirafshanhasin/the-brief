"use client";

import { useEffect, useState } from "react";
import { COUNTRIES, type FeedStory, type TopicId } from "@brief/core";
import { Masthead } from "@/components/Masthead";
import { TopicChips } from "@/components/Pickers";
import { StoryItem } from "@/components/StoryItem";
import { fetchExplore } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";

/** Browse anything without changing saved preferences. */
export default function ExplorePage() {
  const prefs = usePrefs();
  const [country, setCountry] = useState("");
  const [topics, setTopics] = useState<TopicId[]>([]);
  const [stories, setStories] = useState<FeedStory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lang = prefs?.language ?? "en";

  useEffect(() => {
    if (!prefs) return;
    const ctrl = new AbortController();
    setStories(null);
    setError(null);
    fetchExplore({ countries: country ? [country] : [], topics, lang }, ctrl.signal)
      .then((d) => setStories(d.stories))
      .catch((e: unknown) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : "Network error"));
    return () => ctrl.abort();
  }, [country, topics, lang, prefs]);

  const filtered = Boolean(country || topics.length);
  return (
    <main>
      <Masthead title="Explore" sub="Major developments everywhere. Filters here don’t change your brief." />
      <div className="field">
        <label htmlFor="explore-country">Country</label>
        <select id="explore-country" className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Anywhere</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <TopicChips value={topics} onChange={setTopics} />
      {filtered ? (
        <button type="button" className="link-button" onClick={() => { setCountry(""); setTopics([]); }}>
          Clear filters
        </button>
      ) : null}

      {error && <p className="empty">Explore couldn’t load: {error}.</p>}
      {!error && stories === null && <p className="empty">Loading…</p>}
      {stories && stories.length === 0 && (
        <p className="empty">No verified reporting matches these filters in the last day and a half.</p>
      )}
      {stories && stories.length > 0 && (
        <ul className="stories">
          {stories.map((s) => (
            <StoryItem key={s.id} story={s} />
          ))}
        </ul>
      )}
    </main>
  );
}
