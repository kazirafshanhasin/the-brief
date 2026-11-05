"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { TopicId } from "@brief/core";
import { Masthead } from "@/components/Masthead";
import { CountryPicker, LanguageSelect, TopicChips } from "@/components/Pickers";
import { savePrefs, usePrefs } from "@/lib/prefs";

/** Website onboarding: countries, then topics + language. Notifications live in the apps. */
export default function SetupPage() {
  const prefs = usePrefs();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [countries, setCountries] = useState<string[]>([]);
  const [topics, setTopics] = useState<TopicId[]>([]);
  const [language, setLanguage] = useState("en");

  useEffect(() => {
    if (!prefs) return;
    setCountries(prefs.countries);
    setTopics(prefs.topics);
    setLanguage(prefs.language);
  }, [prefs]);

  function finish() {
    savePrefs({ countries, topics, language, onboarded: true });
    router.replace("/");
  }

  return (
    <main>
      <Masthead
        title={step === 1 ? "Which countries do you follow?" : "What do you want to read about?"}
        sub={step === 1 ? "Choose as many as you like. Leave it empty for worldwide news." : "Pick a few topics, or none for everything."}
      />
      <p className="steps">Step {step} of 2</p>

      {step === 1 ? (
        <div className="field">
          <CountryPicker value={countries} onChange={setCountries} />
        </div>
      ) : (
        <>
          <div className="field">
            <TopicChips value={topics} onChange={setTopics} />
          </div>
          <div className="field">
            <label htmlFor="lang">Reading language</label>
            <LanguageSelect value={language} onChange={setLanguage} />
            <p className="selected-line">
              Stories appear in English until a translation exists.
            </p>
          </div>
          <p className="note">Scheduled briefings and breaking alerts aren’t available on the website.</p>
        </>
      )}

      <div className="actions">
        {step === 2 ? (
          <button type="button" className="button quiet" onClick={() => setStep(1)}>
            Back
          </button>
        ) : null}
        {step === 1 ? (
          <button type="button" className="button" onClick={() => setStep(2)}>
            Continue
          </button>
        ) : (
          <button type="button" className="button" onClick={finish}>
            Show my brief
          </button>
        )}
      </div>
    </main>
  );
}
