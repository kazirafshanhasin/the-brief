import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, TextInput, View } from "react-native";
import { COUNTRIES, LANGUAGES, MAX_DIGESTS_PER_DAY, TOPICS, countryName, isValidTime, normalizeDigestTimes, type TopicId } from "@brief/core/client";
import { useTheme } from "../lib/theme";
import { Chip, T } from "./ui";

export function TopicChips({ value, onChange }: { value: TopicId[]; onChange: (v: TopicId[]) => void }) {
  return (
    <View style={styles.wrap}>
      {TOPICS.map((t) => {
        const on = value.includes(t.id);
        return <Chip key={t.id} label={t.label} on={on} onPress={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])} />;
      })}
    </View>
  );
}

export function LanguageChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.wrap}>
      {LANGUAGES.map((l) => (
        <Chip key={l.code} label={l.native} on={value === l.code} onPress={() => onChange(l.code)} />
      ))}
    </View>
  );
}

/** Searchable country list. Rendered inside a ScrollView, so it shows a bounded slice. */
export function CountryPicker({ value, onChange, max = 30 }: { value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const { c, font, size } = useTheme();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? COUNTRIES.filter((x) => x.name.toLowerCase().includes(q)) : COUNTRIES;
    return [...matches.filter((x) => value.includes(x.code)), ...matches.filter((x) => !value.includes(x.code))];
  }, [query, value]);
  const visible = showAll || query ? list : list.slice(0, Math.max(12, value.length + 8));

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search countries"
        placeholderTextColor={c.secondary}
        accessibilityLabel="Search countries"
        autoCorrect={false}
        style={[styles.input, { borderColor: c.separator, color: c.text, fontFamily: font, fontSize: size.body }]}
      />
      <T variant="meta" style={{ marginTop: 8 }}>
        {value.length === 0 ? "No countries chosen — you’ll get worldwide news." : `Following ${value.map(countryName).join(", ")}.`}
      </T>
      <View style={{ marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }}>
        {visible.map((x) => {
          const on = value.includes(x.code);
          const disabled = !on && value.length >= max;
          return (
            <Pressable
              key={x.code}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled }}
              disabled={disabled}
              onPress={() => onChange(on ? value.filter((v) => v !== x.code) : [...value, x.code])}
              style={[styles.countryRow, { borderBottomColor: c.separator }]}
            >
              <T style={{ flex: 1, opacity: disabled ? 0.4 : 1 }}>{x.name}</T>
              <T style={{ color: c.accent }}>{on ? "✓" : ""}</T>
            </Pressable>
          );
        })}
      </View>
      {!showAll && !query && list.length > visible.length ? (
        <T variant="meta" style={{ color: c.accent, marginTop: 10, textDecorationLine: "underline" }} onPress={() => setShowAll(true)} accessibilityRole="button">
          Show all {list.length} countries
        </T>
      ) : null}
    </View>
  );
}

/** 1–3 digest times as HH:MM fields, validated as the reader types. */
export function DigestTimes({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { c, font, size } = useTheme();
  const [drafts, setDrafts] = useState<string[]>(value);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = (next: string[]) => {
    if (!next.every(isValidTime)) return setProblem(null);
    const r = normalizeDigestTimes(next);
    setProblem(r.errors[0] ?? null);
    if (r.errors.length === 0) onChange(r.times);
  };
  const setCount = (n: number) => {
    const defaults = ["08:00", "18:00", "21:00"];
    const next = Array.from({ length: n }, (_, i) => drafts[i] ?? defaults[i]!);
    setDrafts(next);
    commit(next);
  };
  return (
    <View>
      <T variant="meta">Number of daily briefings</T>
      <View style={[styles.wrap, { marginTop: 6 }]}>
        {Array.from({ length: MAX_DIGESTS_PER_DAY }, (_, i) => i + 1).map((n) => (
          <Chip key={n} label={String(n)} on={drafts.length === n} onPress={() => setCount(n)} />
        ))}
      </View>
      {drafts.map((t, i) => {
        const valid = isValidTime(t);
        return (
          <View key={i} style={styles.timeRow}>
            <T style={{ width: 96 }}>Briefing {i + 1}</T>
            <TextInput
              value={t}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9:]/g, "").slice(0, 5);
                const auto = /^\d{2}$/.test(cleaned) && t.length < cleaned.length ? `${cleaned}:` : cleaned;
                const next = drafts.map((d, j) => (j === i ? auto : d));
                setDrafts(next);
                commit(next);
              }}
              keyboardType="numbers-and-punctuation"
              placeholder="08:00"
              placeholderTextColor={c.secondary}
              accessibilityLabel={`Briefing ${i + 1} time, 24-hour`}
              maxLength={5}
              style={[styles.input, styles.timeInput, { borderColor: valid ? c.separator : c.accent, color: c.text, fontFamily: font, fontSize: size.body }]}
            />
            {!valid ? <T variant="meta">Use 24-hour time, like 07:30</T> : null}
          </View>
        );
      })}
      {problem ? (
        <T variant="meta" style={{ marginTop: 8, color: c.accent }}>
          {problem}
        </T>
      ) : null}
    </View>
  );
}

export function ToggleRow({ label, detail, value, onChange, disabled }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <T>{label}</T>
        {detail ? <T variant="meta">{detail}</T> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: c.accent, false: c.separator }} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10 },
  countryRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  timeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 12 },
  timeInput: { width: 90, textAlign: "center" },
  toggle: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
});
