import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Pressable, StyleSheet, View } from "react-native";
import type { FeedStory } from "@brief/core/client";
import { storyWhere, timeAgo } from "../lib/format";
import { useSaved } from "../lib/saved";
import { useTheme } from "../lib/theme";
import { T } from "./ui";

export function StoryRow({ story, last }: { story: FeedStory; last?: boolean }) {
  const router = useRouter();
  const { c } = useTheme();
  const { isSaved, toggle } = useSaved();
  const where = storyWhere(story);
  const saved = isSaved(story.id);

  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator }]}>
      <Pressable onPress={() => router.push(`/story/${story.id}`)} accessibilityRole="link" accessibilityLabel={story.headline}>
        <T variant="where" style={{ marginBottom: 6 }}>
          {story.is_breaking ? <T variant="where" style={{ color: c.accent }}>Breaking · </T> : null}
          {where}
        </T>
        <T variant="headline">{story.headline}</T>
        {story.summary ? <T style={{ marginTop: 8 }}>{story.summary}</T> : null}
      </Pressable>
      <View style={styles.foot}>
        {story.primary_source ? (
          <T variant="meta" style={{ textDecorationLine: "underline" }} onPress={() => WebBrowser.openBrowserAsync(story.primary_source!.url)} accessibilityRole="link">
            {story.primary_source.name}
          </T>
        ) : null}
        {story.source_count > 1 ? <T variant="meta">{story.source_count} sources</T> : null}
        <T variant="meta">{timeAgo(story.updated_at)}</T>
        <View style={{ flex: 1 }} />
        <T
          variant="meta"
          style={{ color: c.accent, textDecorationLine: "underline" }}
          accessibilityRole="button"
          onPress={() => toggle({ id: story.id, headline: story.headline, summary: story.summary, where })}
        >
          {saved ? "Saved" : "Save"}
        </T>
      </View>
      {story.kind === "headline_only" ? (
        <T variant="meta" style={{ fontStyle: "italic", marginTop: 4 }}>
          Headline only — read at the source
        </T>
      ) : null}
      {story.language_fallback ? (
        <T variant="meta" style={{ fontStyle: "italic", marginTop: 4 }}>
          In English
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 20 },
  foot: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 14, rowGap: 4, marginTop: 10 },
});
