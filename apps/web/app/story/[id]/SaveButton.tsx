"use client";

import { toggleSaved, useSaved, type SavedStory } from "@/lib/prefs";

export function SaveButton({ story }: { story: Omit<SavedStory, "saved_at"> }) {
  const saved = useSaved().some((s) => s.id === story.id);
  return (
    <button type="button" className="link-button save" aria-pressed={saved} onClick={() => toggleSaved(story)}>
      {saved ? "Saved" : "Save"}
    </button>
  );
}
