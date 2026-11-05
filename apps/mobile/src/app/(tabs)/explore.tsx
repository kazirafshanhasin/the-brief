import { useState } from "react";
import { View } from "react-native";
import { countryName, type TopicId } from "@brief/core/client";
import { StoryList, useRefresh, useStories } from "../../components/Feed";
import { CountryPicker, TopicChips } from "../../components/Pickers";
import { Masthead, Screen, Section, T } from "../../components/ui";
import { api } from "../../lib/api";
import { usePrefs } from "../../lib/prefs";
import { useTheme } from "../../lib/theme";

/** Browse worldwide news with temporary filters that never change saved preferences. */
export default function ExploreScreen() {
  const { prefs } = usePrefs();
  const { c } = useTheme();
  const [countries, setCountries] = useState<string[]>([]);
  const [topics, setTopics] = useState<TopicId[]>([]);
  const [pickCountry, setPickCountry] = useState(false);
  const lang = prefs?.language ?? "en";
  const { data, error, refreshing, reload, retry } = useStories(() => api.explore({ countries, topics, lang }), [countries.join(), topics.join(), lang]);
  const refresh = useRefresh(refreshing, reload);

  return (
    <Screen refreshControl={refresh}>
      <Masthead title="Explore" sub="Major developments everywhere. Filters here don’t change your brief." />
      <Section label="Topics">
        <TopicChips value={topics} onChange={setTopics} />
      </Section>
      <Section label="Country">
        {pickCountry ? (
          <CountryPicker
            value={countries}
            max={1}
            onChange={(v) => {
              setCountries(v);
              if (v.length) setPickCountry(false);
            }}
          />
        ) : (
          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
            <T>{countries.length ? countryName(countries[0]!) : "Anywhere"}</T>
            <T style={{ color: c.accent, textDecorationLine: "underline" }} onPress={() => setPickCountry(true)} accessibilityRole="button">
              Choose a country
            </T>
            {countries.length || topics.length ? (
              <T style={{ color: c.accent, textDecorationLine: "underline" }} accessibilityRole="button" onPress={() => { setCountries([]); setTopics([]); }}>
                Clear filters
              </T>
            ) : null}
          </View>
        )}
      </Section>
      <StoryList stories={data?.stories ?? null} error={error} onRetry={retry} empty="No verified reporting matches these filters right now." />
    </Screen>
  );
}
