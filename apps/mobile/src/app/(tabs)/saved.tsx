import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Masthead, Screen, T } from "../../components/ui";
import { timeAgo } from "../../lib/format";
import { useSaved } from "../../lib/saved";
import { useTheme } from "../../lib/theme";

export default function SavedScreen() {
  const { saved, toggle } = useSaved();
  const router = useRouter();
  const { c } = useTheme();
  return (
    <Screen>
      <Masthead title="Saved" sub="Kept on this phone only. Reinstalling the app removes them." />
      {saved.length === 0 ? (
        <T muted style={{ marginTop: 32 }}>
          Nothing saved yet. Tap “Save” under any story to keep it here.
        </T>
      ) : (
        saved.map((s, i) => (
          <View key={s.id} style={[styles.row, i < saved.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator }]}>
            <Pressable onPress={() => router.push(`/story/${s.id}`)} accessibilityRole="link">
              <T variant="where" style={{ marginBottom: 6 }}>
                {s.where}
              </T>
              <T variant="headline">{s.headline}</T>
              {s.summary ? <T style={{ marginTop: 8 }}>{s.summary}</T> : null}
            </Pressable>
            <View style={styles.foot}>
              <T variant="meta">Saved {timeAgo(s.saved_at)}</T>
              <T variant="meta" style={{ color: c.accent, textDecorationLine: "underline" }} accessibilityRole="button" onPress={() => toggle(s)}>
                Remove
              </T>
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 20 },
  foot: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
});
