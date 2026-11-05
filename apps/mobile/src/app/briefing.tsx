import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { StoryList, useStories } from "../components/Feed";
import { Button, Masthead, Screen } from "../components/ui";
import { api } from "../lib/api";
import { usePrefs } from "../lib/prefs";

/** Opened from a scheduled notification: the three stories it announced, then the full feed. */
export default function Briefing() {
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const router = useRouter();
  const { prefs } = usePrefs();
  const list = String(ids ?? "").split(",").filter(Boolean).slice(0, 3);
  const { data, error, retry } = useStories(() => api.storiesByIds(list, prefs?.language ?? "en"), [ids, prefs?.language]);

  return (
    <Screen>
      <Masthead title="Your brief" sub="The three stories that matter most to you right now." />
      <StoryList stories={data?.stories ?? null} error={error} onRetry={retry} empty="These stories are no longer available." />
      <View style={{ marginTop: 24 }}>
        <Button label="Continue to the full feed" onPress={() => router.replace("/brief")} />
      </View>
    </Screen>
  );
}
