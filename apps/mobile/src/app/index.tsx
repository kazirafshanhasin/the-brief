import { Redirect } from "expo-router";
import { View } from "react-native";
import { usePrefs } from "../lib/prefs";
import { useTheme } from "../lib/theme";

export default function Entry() {
  const { prefs } = usePrefs();
  const { c } = useTheme();
  if (!prefs) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  return <Redirect href={prefs.onboarded ? "/brief" : "/onboarding"} />;
}
