import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Pressable, StyleSheet, View } from "react-native";
import type { StoryDetail } from "@brief/core/client";
import { useStories } from "../../components/Feed";
import { Button, Note, Screen, Section, T } from "../../components/ui";
import { api } from "../../lib/api";
import { storyWhere, timeAgo } from "../../lib/format";
import { usePrefs } from "../../lib/prefs";
import { useSaved } from "../../lib/saved";
import { useTheme } from "../../lib/theme";

export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { prefs } = usePrefs();
  const { c } = useTheme();
  const { isSaved, toggle } = useSaved();
  const lang = prefs?.language ?? "en";
  // Reuse the loader: wrap the single story as a one-item list.
  const { data, error, retry } = useStories(async () => {
    const s = await api.story(String(id), lang);
    return { stories: [s], story: s };
  }, [id, lang]);
  const story = (data as { story?: StoryDetail } | null)?.story;

  return (
    <Screen>
      <T style={{ color: c.accent, marginTop: 14 }} accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/brief"))}>
        ‹ Back
      </T>
      {error ? (
        <>
          <T muted style={{ marginTop: 28 }}>
            {error}
          </T>
          <Button quiet label="Try again" onPress={retry} />
        </>
      ) : !story ? (
        <T muted style={{ marginTop: 28 }}>
          Loading…
        </T>
      ) : (
        <>
          <View style={{ paddingTop: 22 }}>
            <T variant="where" style={{ marginBottom: 8 }}>
              {story.is_breaking ? "Breaking · " : ""}
              {storyWhere(story)}
            </T>
            <T variant="headline" style={{ fontSize: 30, lineHeight: 35 }} accessibilityRole="header">
              {story.headline}
            </T>
            {story.summary ? (
              <T style={{ marginTop: 14, fontSize: 20, lineHeight: 30 }}>{story.summary}</T>
            ) : (
              <Note>We only have the headline for this story, so there’s no summary. Read the full report at the source below.</Note>
            )}
            <View style={styles.foot}>
              <T variant="meta">Updated {timeAgo(story.updated_at)}</T>
              {story.language_fallback ? <T variant="meta">Shown in English</T> : null}
              <T
                variant="meta"
                style={{ color: c.accent, textDecorationLine: "underline" }}
                accessibilityRole="button"
                onPress={() => toggle({ id: story.id, headline: story.headline, summary: story.summary, where: storyWhere(story) })}
              >
                {isSaved(story.id) ? "Saved" : "Save"}
              </T>
            </View>
            {story.summary ? (
              <T variant="meta" style={{ marginTop: 10 }}>
                Summary written from the publishers’ own excerpts, linked below.
              </T>
            ) : null}
          </View>

          <Section label="Reported by">
            {story.sources.map((s) => (
              <Pressable key={s.url} onPress={() => WebBrowser.openBrowserAsync(s.url)} accessibilityRole="link" style={[styles.source, { borderBottomColor: c.separator }]}>
                <T variant="meta">
                  {s.name} · {timeAgo(s.published_at)}
                </T>
                <T style={{ textDecorationLine: "underline" }}>{s.headline}</T>
              </Pressable>
            ))}
          </Section>

          {story.related.length > 0 && (
            <Section label="Related coverage">
              {story.related.map((r) => (
                <Pressable key={r.id} onPress={() => router.push(`/story/${r.id}`)} accessibilityRole="link" style={[styles.source, { borderBottomColor: c.separator }]}>
                  <T>{r.headline}</T>
                </Pressable>
              ))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  foot: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, marginTop: 12 },
  source: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
