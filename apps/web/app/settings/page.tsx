"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { TextSize } from "@brief/core";
import { Masthead } from "@/components/Masthead";
import { CountryPicker, LanguageSelect, TopicChips } from "@/components/Pickers";
import { resetAll, savePrefs, usePrefs, type WebPrefs } from "@/lib/prefs";

const SIZES: { id: TextSize; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];
const THEMES: { id: WebPrefs["theme"]; label: string }[] = [
  { id: "system", label: "Match device" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export default function SettingsPage() {
  const prefs = usePrefs();
  const router = useRouter();

  // Reflect appearance choices on <html> immediately.
  useEffect(() => {
    if (!prefs) return;
    const d = document.documentElement;
    if (prefs.theme === "system") delete d.dataset.theme;
    else d.dataset.theme = prefs.theme;
    d.dataset.size = prefs.textSize;
  }, [prefs]);

  if (!prefs) return <main><Masthead title="Settings" /></main>;

  return (
    <main>
      <Masthead title="Settings" sub="Changes are saved in this browser as you make them." />

      <fieldset className="field">
        <legend>Countries</legend>
        <CountryPicker value={prefs.countries} onChange={(countries) => savePrefs({ countries })} />
      </fieldset>

      <fieldset className="field">
        <legend>Topics</legend>
        <TopicChips value={prefs.topics} onChange={(topics) => savePrefs({ topics })} />
      </fieldset>

      <div className="field">
        <label htmlFor="lang">Reading language</label>
        <LanguageSelect value={prefs.language} onChange={(language) => savePrefs({ language })} />
      </div>

      <fieldset className="field">
        <legend>Text size</legend>
        <ul className="chips">
          {SIZES.map((s) => (
            <li key={s.id}>
              <button type="button" className="chip" aria-pressed={prefs.textSize === s.id} onClick={() => savePrefs({ textSize: s.id })}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="field">
        <legend>Appearance</legend>
        <ul className="chips">
          {THEMES.map((t) => (
            <li key={t.id}>
              <button type="button" className="chip" aria-pressed={prefs.theme === t.id} onClick={() => savePrefs({ theme: t.id })}>
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="field">
        <label>Notifications</label>
        <p className="selected-line">Scheduled briefings and breaking alerts aren’t available on the website.</p>
      </div>

      <div className="field">
        <label>Privacy</label>
        <p className="selected-line">
          The website stores your choices and saved stories in this browser only. It sets no cookies and uses no trackers.{" "}
          <Link href="/privacy">Read the privacy policy</Link>.
        </p>
        <div className="actions">
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              if (window.confirm("Erase your countries, topics and saved stories from this browser?")) {
                resetAll();
                router.replace("/setup");
              }
            }}
          >
            Erase my data
          </button>
        </div>
      </div>
    </main>
  );
}
