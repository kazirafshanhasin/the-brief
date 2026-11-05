"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { countryName, coverageMessage, type CoverageEntry, type FeedStory } from "@brief/core";
import { Masthead } from "@/components/Masthead";
import { StoryItem } from "@/components/StoryItem";
import { fetchFeed } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stories: FeedStory[]; coverage: CoverageEntry[] };

export default function BriefPage() {
  const prefs = usePrefs();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (prefs && !prefs.onboarded) router.replace("/setup");
  }, [prefs, router]);

  const key = prefs ? `${prefs.countries.join()}|${prefs.topics.join()}|${prefs.language}` : null;
  useEffect(() => {
    if (!prefs?.onboarded) return;
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetchFeed({ countries: prefs.countries, topics: prefs.topics, lang: prefs.language }, ctrl.signal)
      .then((d) => setState({ status: "ready", stories: d.stories, coverage: d.coverage }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setState({ status: "error", message: e instanceof Error ? e.message : "Network error" });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, prefs?.onboarded, attempt]);

  const following = prefs?.countries.length ? prefs.countries.map(countryName).join(", ") : "the whole world";

  return (
    <main>
      <Masthead sub={prefs?.onboarded ? `For you: ${following}.` : undefined} />
      {state.status === "ready" &&
        state.coverage.map((c) => {
          const msg = coverageMessage(countryName(c.country), c.level);
          return msg ? (
            <p className="note" key={c.country}>
              {msg}
            </p>
          ) : null;
        })}

      {state.status === "loading" && <p className="empty">Gathering your brief…</p>}
      {state.status === "error" && (
        <div className="empty">
          <p>The brief couldn’t load: {state.message}.</p>
          <button type="button" className="button quiet" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {state.status === "ready" && state.stories.length === 0 && (
        <div className="empty">
          <p>Nothing new from your countries and topics in the last two days.</p>
          <p>
            <Link href="/settings">Add a country or topic</Link> or <Link href="/explore">explore worldwide news</Link>.
          </p>
        </div>
      )}
      {state.status === "ready" && state.stories.length > 0 && (
        <ul className="stories">
          {state.stories.map((s) => (
            <StoryItem key={s.id} story={s} />
          ))}
        </ul>
      )}
    </main>
  );
}
