import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import type { TextSize } from "@brief/core/client";
import { CountryPicker, DigestTimes, LanguageChips, TopicChips, ToggleRow } from "../../components/Pickers";
import { Button, Chip, Masthead, Note, Screen, Section, T } from "../../components/ui";
import { API_URL } from "../../lib/config";
import { usePrefs, type AppPrefs } from "../../lib/prefs";
import { useTheme } from "../../lib/theme";

const SIZES: { id: TextSize; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];
const THEMES: { id: AppPrefs["theme"]; label: string }[] = [
  { id: "system", label: "Match phone" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** Where the website's privacy page lives. Change if your site isn't on the API's domain. */
const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL ?? `${API_URL.replace("-api", "-web")}/privacy`;

export default function SettingsScreen() {
  const { prefs, update, setNotifications, syncError, eraseAll } = usePrefs();
  const { c } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!prefs) return <Screen>{null}</Screen>;

  async function toggleNotifications(on: boolean) {
    setBusy(true);
    setProblem(await setNotifications(on));
    setBusy(false);
  }

  function confirmErase() {
    Alert.alert(
      "Erase my data?",
      "This deletes your countries, topics and saved stories from this phone, and your notification settings from our server.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Erase",
          style: "destructive",
          onPress: async () => {
            try {
              await eraseAll();
              router.replace("/onboarding");
            } catch (e) {
              setProblem(e instanceof Error ? e.message : "Couldn’t erase server data. Try again when online.");
            }
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <Masthead title="Settings" sub="Changes are saved as you make them." />

      <Section label="Notifications">
        <ToggleRow
          label="Daily briefings"
          detail={prefs.push_enabled ? `Top three stories at ${prefs.digest_times.join(", ")} (${prefs.timezone})` : "Off"}
          value={prefs.push_enabled}
          disabled={busy}
          onChange={toggleNotifications}
        />
        {prefs.push_enabled ? (
          <>
            <DigestTimes value={prefs.digest_times} onChange={(digest_times) => update({ digest_times })} />
            <ToggleRow
              label="Breaking news alerts"
              detail="Verified, major events only. At most two a day."
              value={prefs.breaking_alerts}
              onChange={(breaking_alerts) => update({ breaking_alerts })}
            />
          </>
        ) : null}
        {problem || syncError ? <Note>{problem ?? syncError}</Note> : null}
      </Section>

      <Section label="Countries">
        <CountryPicker value={prefs.countries} onChange={(countries) => update({ countries })} />
      </Section>

      <Section label="Topics">
        <TopicChips value={prefs.topics} onChange={(topics) => update({ topics })} />
      </Section>

      <Section label="Reading language">
        <LanguageChips value={prefs.language} onChange={(language) => update({ language })} />
      </Section>

      <Section label="Text size">
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {SIZES.map((s) => (
            <Chip key={s.id} label={s.label} on={prefs.textSize === s.id} onPress={() => update({ textSize: s.id })} />
          ))}
        </View>
      </Section>

      <Section label="Appearance">
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {THEMES.map((t) => (
            <Chip key={t.id} label={t.label} on={prefs.theme === t.id} onPress={() => update({ theme: t.id })} />
          ))}
        </View>
      </Section>

      <Section label="Privacy">
        <T>
          No account, no ads, no tracking. Your choices stay on this phone. If notifications are on, our server keeps only what it needs to send them.
        </T>
        <T style={{ color: c.accent, textDecorationLine: "underline", marginTop: 8 }} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}>
          Read the privacy policy
        </T>
        <T variant="meta" style={{ marginTop: 8 }}>
          Preferences aren’t copied to other devices. A new phone or a reinstall starts fresh.
        </T>
        <View style={{ marginTop: 16 }}>
          <Button quiet label="Erase my data" onPress={confirmErase} />
        </View>
      </Section>
    </Screen>
  );
}
