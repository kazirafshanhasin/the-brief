/**
 * Design tokens shared by web and apps. The web mirrors these as CSS variables in
 * apps/web/app/globals.css — keep them in sync.
 */
export const colors = {
  light: {
    background: "#FAF9F6",
    text: "#181818",
    secondary: "#77736C",
    accent: "#263F63",
    separator: "#E6E3DC",
    surface: "#F3F1EC",
  },
  dark: {
    background: "#121211",
    text: "#F2EEE6",
    secondary: "#9C978E",
    accent: "#9DB4D6",
    separator: "#2A2926",
    surface: "#1B1A18",
  },
} as const;

export type ThemeName = keyof typeof colors;
export type ThemeColors = (typeof colors)[ThemeName];

/** Times New Roman first; system serif fallback (Android ships no Times New Roman). */
export const fontFamily = {
  web: '"Times New Roman", Times, "Liberation Serif", "Noto Serif", serif',
  ios: "Times New Roman",
  android: "serif",
} as const;

export const textSizes = {
  small: { body: 16, headline: 20, meta: 12 },
  medium: { body: 18, headline: 22, meta: 13 },
  large: { body: 21, headline: 25, meta: 15 },
} as const;

export type TextSize = keyof typeof textSizes;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;
export const readingColumnMaxWidth = 640;
