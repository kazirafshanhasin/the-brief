import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme";
import { todayLabel } from "../lib/format";

type Variant = "body" | "headline" | "title" | "meta" | "where" | "label";

/** All text goes through here so font, size and color follow the reader's settings. */
export function T({
  children,
  variant = "body",
  style,
  muted,
  numberOfLines,
  onPress,
  accessibilityRole,
}: {
  children: ReactNode;
  variant?: Variant;
  style?: StyleProp<TextStyle>;
  muted?: boolean;
  numberOfLines?: number;
  onPress?: () => void;
  accessibilityRole?: "link" | "header" | "button" | "text";
}) {
  const { c, font, size } = useTheme();
  const base: TextStyle = { fontFamily: font, color: muted ? c.secondary : c.text };
  const v: Record<Variant, TextStyle> = {
    body: { fontSize: size.body, lineHeight: Math.round(size.body * 1.5) },
    headline: { fontSize: size.headline, lineHeight: Math.round(size.headline * 1.22), fontWeight: "700" },
    title: { fontSize: 38, lineHeight: 41, letterSpacing: -0.4 },
    meta: { fontSize: size.meta, lineHeight: Math.round(size.meta * 1.4), color: c.secondary },
    where: { fontSize: size.meta - 1, letterSpacing: 0.9, color: c.secondary, textTransform: "uppercase" },
    label: { fontSize: 16, fontStyle: "italic", color: c.secondary },
  };
  return (
    <Text style={[base, v[variant], style]} numberOfLines={numberOfLines} onPress={onPress} accessibilityRole={accessibilityRole}>
      {children}
    </Text>
  );
}

export function Screen({ children, scroll = true, refreshControl }: { children: ReactNode; scroll?: boolean; refreshControl?: React.ReactElement }) {
  const { c } = useTheme();
  const inner = <View style={styles.column}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={refreshControl as never} keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function Masthead({ title, sub }: { title: string; sub?: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.masthead, { borderBottomColor: c.text }]}>
      <T variant="where">{todayLabel()}</T>
      <T variant="title" style={{ marginTop: 6 }} accessibilityRole="header">
        {title}
      </T>
      {sub ? (
        <T muted style={{ fontStyle: "italic", marginTop: 8 }}>
          {sub}
        </T>
      ) : null}
    </View>
  );
}

export function Button({ label, onPress, quiet, disabled }: { label: string; onPress: () => void; quiet?: boolean; disabled?: boolean }) {
  const { c, font } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderColor: c.text, backgroundColor: quiet ? "transparent" : pressed ? c.accent : c.text, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Text style={{ fontFamily: font, fontSize: 17, color: quiet ? c.text : c.background }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { c, font } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, { borderColor: on ? c.text : c.separator, backgroundColor: on ? c.text : "transparent" }]}
    >
      <Text style={{ fontFamily: font, fontSize: 16, color: on ? c.background : c.text }}>{label}</Text>
    </Pressable>
  );
}

export function Note({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: c.surface }]}>
      <T style={{ fontSize: 16, lineHeight: 23 }}>{children}</T>
    </View>
  );
}

export function Separator() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator }} />;
}

export function Section({ label, children, style }: { label: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginTop: 26 }, style]}>
      <T variant="label" style={{ marginBottom: 8 }}>
        {label}
      </T>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 48 },
  column: { width: "100%", maxWidth: 640, alignSelf: "center", paddingHorizontal: 18, flexGrow: 1 },
  masthead: { paddingTop: 20, paddingBottom: 20, borderBottomWidth: 1 },
  button: { paddingVertical: 12, paddingHorizontal: 20, borderWidth: 1, borderRadius: 4, alignSelf: "flex-start" },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13 },
  note: { marginTop: 16, padding: 14 },
});
