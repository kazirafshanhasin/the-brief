import { Platform, useColorScheme } from "react-native";
import { colors, fontFamily, textSizes, type ThemeColors } from "@brief/core/client";
import { usePrefs } from "./prefs";

export interface Theme {
  c: ThemeColors;
  dark: boolean;
  font: string;
  size: (typeof textSizes)[keyof typeof textSizes];
}

/** Times New Roman on iOS; Android has no Times New Roman, so it uses the system serif. */
export const SERIF = Platform.select({ ios: fontFamily.ios, android: fontFamily.android, default: fontFamily.android });

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const { prefs } = usePrefs();
  const choice = prefs?.theme ?? "system";
  const dark = choice === "dark" || (choice === "system" && scheme === "dark");
  return {
    c: dark ? colors.dark : colors.light,
    dark,
    font: SERIF,
    size: textSizes[prefs?.textSize ?? "medium"],
  };
}
