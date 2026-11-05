import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; eas?: { projectId?: string } };

/** API Worker URL: EXPO_PUBLIC_API_URL (e.g. in .env for development) wins over app.json extra.apiUrl. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? "http://localhost:8787").replace(/\/+$/, "");

export const EAS_PROJECT_ID = extra.eas?.projectId && !extra.eas.projectId.startsWith("REPLACE") ? extra.eas.projectId : undefined;
