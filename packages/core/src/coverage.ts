import type { CoverageEntry } from "./types";

/** Below this many stories in 48 h, the UI shows a limited-coverage note instead of padding the feed. */
export const LIMITED_COVERAGE_THRESHOLD = 5;

export function coverageLevel(stories48h: number): CoverageEntry["level"] {
  if (stories48h <= 0) return "none";
  if (stories48h < LIMITED_COVERAGE_THRESHOLD) return "limited";
  return "good";
}

export function coverageMessage(countryName: string, level: CoverageEntry["level"]): string | null {
  if (level === "good") return null;
  if (level === "none") return `We have no verified reporting from ${countryName} in the last two days.`;
  return `Coverage of ${countryName} is limited right now. We only show stories we can attribute to a source.`;
}
