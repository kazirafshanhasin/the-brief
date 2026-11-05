import { useCallback, useEffect, useState } from "react";
import { RefreshControl } from "react-native";
import type { FeedStory } from "@brief/core/client";
import { useTheme } from "../lib/theme";
import { StoryRow } from "./StoryRow";
import { Button, T } from "./ui";

/** Loads a list of stories with loading, error, empty and pull-to-refresh states. */
export function useStories<T extends { stories: FeedStory[] }>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setData(null);
    setError(null);
    try {
      setData(await load());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load stories.");
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, error, refreshing, reload: () => run(true), retry: () => run(false) };
}

export function useRefresh(refreshing: boolean, onRefresh: () => void) {
  const { c } = useTheme();
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.secondary} colors={[c.accent]} />;
}

export function StoryList({
  stories,
  error,
  onRetry,
  empty,
}: {
  stories: FeedStory[] | null;
  error: string | null;
  onRetry: () => void;
  empty: string;
}) {
  if (error) {
    return (
      <>
        <T muted style={{ marginTop: 32 }}>
          {error}
        </T>
        <Button quiet label="Try again" onPress={onRetry} />
      </>
    );
  }
  if (!stories) {
    return (
      <T muted style={{ marginTop: 32 }}>
        Gathering stories…
      </T>
    );
  }
  if (stories.length === 0) {
    return (
      <T muted style={{ marginTop: 32 }}>
        {empty}
      </T>
    );
  }
  return (
    <>
      {stories.map((s, i) => (
        <StoryRow key={s.id} story={s} last={i === stories.length - 1} />
      ))}
    </>
  );
}
