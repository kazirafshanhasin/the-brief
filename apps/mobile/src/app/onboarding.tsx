import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { TopicId } from "@brief/core/client";
import { CountryPicker, DigestTimes, LanguageChips, TopicChips, ToggleRow } from "../components/Pickers";
import { Button, Masthead, Note, Screen, Section, T } from "../components/ui";
import { usePrefs } from "../lib/prefs";

/** Three steps: countries → topics & language → notification times (skippable). */
export default function Onboarding() {
  const router = useRouter();
  const { prefs, update, setNotifications } = usePrefs();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [countries, setCountries] = useState<string[]>(prefs?.countries ?? []);
  const [topics, setTopics] = useState<TopicId[]>(prefs?.topics ?? []);
  const [language, setLanguage] = useState(prefs?.language ?? "en");
  const [times, setTimes] = useState<string[]>(prefs?.digest_times ?? ["08:00"]);
  const [breaking, setBreaking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titles = {
    1: ["Which countries do you follow?", "Choose as many as you like. Leave it empty for worldwide news."],
    2: ["What do you want to read about?", "Pick a few topics, or none for everything."],
    3: ["When should we brief you?", "Your top three stories arrive at these times, in your local time."],
  } as const;

  function finish(withNotifications: boolean) {
    update({ countries, topics, language, digest_times: times, breaking_alerts: breaking, onboarded: true });
    if (!withNotifications) {
      router.replace("/brief");
      return;
    }
    setBusy(true);
    setError(null);
    // Save first so the server receives the chosen settings with the token.
    setTimeout(async () => {
      const problem = await setNotifications(true);
      setBusy(false);
      if (problem) setError(`${problem} You can turn notifications on later in Settings.`);
      else router.replace("/brief");
    }, 0);
  }

  return (
    <Screen>
      <Masthead title={titles[step][0]} sub={titles[step][1]} />
      <T variant="meta" style={{ marginTop: 14 }}>
        Step {step} of 3
      </T>

      {step === 1 && (
        <Section label="Countries">
          <CountryPicker value={countries} onChange={setCountries} />
        </Section>
      )}

      {step === 2 && (
        <>
          <Section label="Topics">
            <TopicChips value={topics} onChange={setTopics} />
          </Section>
          <Section label="Reading language">
            <LanguageChips value={language} onChange={setLanguage} />
            <T variant="meta" style={{ marginTop: 8 }}>
              Major stories are translated. Others appear in English until a translation exists.
            </T>
          </Section>
        </>
      )}

      {step === 3 && (
        <>
          <Section label="Daily briefings">
            <DigestTimes value={times} onChange={setTimes} />
          </Section>
          <Section label="Breaking news">
            <ToggleRow
              label="Immediate alerts for major news"
              detail="Only verified, significant events in your countries and topics. At most two a day."
              value={breaking}
              onChange={setBreaking}
            />
          </Section>
          {error ? <Note>{error}</Note> : null}
        </>
      )}

      <View style={{ flexDirection: "row", gap: 12, marginTop: 30, flexWrap: "wrap", alignItems: "center" }}>
        {step > 1 && <Button quiet label="Back" onPress={() => setStep((s) => (s - 1) as 1 | 2)} />}
        {step < 3 && <Button label="Continue" onPress={() => setStep((s) => (s + 1) as 2 | 3)} />}
        {step === 3 && !error && <Button label={busy ? "Turning on…" : "Turn on notifications"} disabled={busy} onPress={() => finish(true)} />}
        {step === 3 && (
          <T style={{ textDecorationLine: "underline" }} accessibilityRole="button" onPress={() => finish(false)}>
            {error ? "Continue to my brief" : "Skip notifications"}
          </T>
        )}
      </View>
    </Screen>
  );
}
