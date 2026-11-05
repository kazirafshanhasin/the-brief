import { Tabs } from "expo-router";
import { useTheme } from "../../lib/theme";

/** Text-only tab bar: Brief, Explore, Saved, Settings. */
export default function TabsLayout() {
  const { c, font } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: "none" },
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.secondary,
        tabBarLabelStyle: { fontFamily: font, fontSize: 16, marginBottom: 2 },
        tabBarStyle: { backgroundColor: c.background, borderTopColor: c.separator, elevation: 0 },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="brief" options={{ title: "Brief" }} />
      <Tabs.Screen name="explore" options={{ title: "Explore" }} />
      <Tabs.Screen name="saved" options={{ title: "Saved" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
