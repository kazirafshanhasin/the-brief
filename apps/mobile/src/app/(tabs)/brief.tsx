import { countryName, coverageMessage } from "@brief/core/client";
import { StoryList, useRefresh, useStories } from "../../components/Feed";
import { Masthead, Note, Screen } from "../../components/ui";
import { api } from "../../lib/api";
import { usePrefs } from "../../lib/prefs";

export default function BriefScreen() {
  const { prefs } = usePrefs();
  const countries = prefs?.countries ?? [];
  const topics = prefs?.topics ?? [];
  const lang = prefs?.language ?? "en";
  const { data, error, refreshing, reload, retry } = useStories(() => api.feed({ countries, topics, lang }), [countries.join(), topics.join(), lang]);
  const refresh = useRefresh(refreshing, reload);
  const following = countries.length ? countries.map(countryName).join(", ") : "the whole world";

  return (
    <Screen refreshControl={refresh}>
      <Masthead title="The world in a few sentences." sub={`For you: ${following}.`} />
      {data?.coverage.map((c) => {
        const msg = coverageMessage(countryName(c.country), c.level);
        return msg ? <Note key={c.country}>{msg}</Note> : null;
      })}
      <StoryList
        stories={data?.stories ?? null}
        error={error}
        onRetry={retry}
        empty="Nothing new from your countries and topics in the last two days. Add more in Settings, or try Explore."
      />
    </Screen>
  );
}
