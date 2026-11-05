"use client";

import Link from "next/link";
import { Masthead } from "@/components/Masthead";
import { timeAgo } from "@/lib/format";
import { toggleSaved, useSaved } from "@/lib/prefs";

export default function SavedPage() {
  const saved = useSaved();
  return (
    <main>
      <Masthead title="Saved" sub="Kept in this browser only. Clearing site data removes them." />
      {saved.length === 0 ? (
        <div className="empty">
          <p>Nothing saved yet. Tap “Save” under any story to keep it here.</p>
        </div>
      ) : (
        <ul className="stories">
          {saved.map((s) => (
            <li className="story" key={s.id}>
              <p className="story-where">{s.where}</p>
              <h3>
                <Link href={`/story/${s.id}`}>{s.headline}</Link>
              </h3>
              {s.summary ? <p className="story-summary">{s.summary}</p> : null}
              <div className="story-foot">
                <span>Saved {timeAgo(s.saved_at)}</span>
                <button type="button" className="link-button save" onClick={() => toggleSaved(s)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
