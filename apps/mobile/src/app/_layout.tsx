import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../lib/push"; // registers the foreground notification handler
import { PrefsProvider } from "../lib/prefs";
import { SavedProvider } from "../lib/saved";
import { useTheme } from "../lib/theme";

/** Tapping a notification: digests open the three-story briefing, breaking alerts open the story. */
function useNotificationRouting() {
  const router = useRouter();
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const data = last.notification.request.content.data as { type?: string; ids?: string[]; id?: string };
    if (data.type === "digest" && Array.isArray(data.ids)) router.push({ pathname: "/briefing", params: { ids: data.ids.join(",") } });
    else if (data.type === "breaking" && data.id) router.push(`/story/${data.id}`);
  }, [last, router]);
}

function ThemedStack() {
  const { c, dark } = useTheme();
  useNotificationRouting();
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.background).catch(() => {});
  }, [c.background]);
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background }, animation: "fade" }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PrefsProvider>
        <SavedProvider>
          <ThemedStack />
        </SavedProvider>
      </PrefsProvider>
    </SafeAreaProvider>
  );
}
