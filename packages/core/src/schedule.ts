/** Digest scheduling: local "HH:MM" times in an IANA time zone → UTC instants, DST-safe. */

export const MAX_DIGESTS_PER_DAY = 3;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Validate and normalize a digest schedule: valid, unique, sorted, at most 3, at least 1 hour apart. */
export function normalizeDigestTimes(times: string[]): { times: string[]; errors: string[] } {
  const errors: string[] = [];
  const valid = [...new Set(times.map((t) => t.trim()))].filter((t) => {
    if (!isValidTime(t)) {
      errors.push(`"${t}" is not a valid 24-hour time (HH:MM).`);
      return false;
    }
    return true;
  });
  valid.sort();
  if (valid.length > MAX_DIGESTS_PER_DAY) errors.push(`At most ${MAX_DIGESTS_PER_DAY} digests per day.`);
  const out = valid.slice(0, MAX_DIGESTS_PER_DAY);
  for (let i = 1; i < out.length; i++) {
    if (toMinutes(out[i]!) - toMinutes(out[i - 1]!) < 60) {
      errors.push("Digest times must be at least one hour apart.");
      break;
    }
  }
  return { times: out, errors };
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function wallClockIn(date: Date, tz: string): WallClock & { second: number } {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** Offset (ms) of tz from UTC at the given instant. */
function offsetAt(instant: number, tz: string): number {
  const w = wallClockIn(new Date(instant), tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * UTC instant for a wall-clock time in tz. Nonexistent times (spring-forward gap) are moved
 * forward by the gap; ambiguous times (fall-back) resolve to the first occurrence.
 */
export function zonedToUtc(w: WallClock, tz: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const off1 = offsetAt(guess, tz);
  let candidate = guess - off1;
  const off2 = offsetAt(candidate, tz);
  if (off2 !== off1) {
    const alt = guess - off2;
    const back = wallClockIn(new Date(alt), tz);
    // If alt maps back to the requested wall time it is valid; otherwise we're in a gap.
    candidate = back.hour === w.hour && back.minute === w.minute ? alt : Math.max(candidate, alt);
  }
  // Ambiguous: prefer the earlier instant if it also maps to the same wall time.
  const earlier = candidate - 3_600_000;
  const e = wallClockIn(new Date(earlier), tz);
  if (e.hour === w.hour && e.minute === w.minute && e.day === w.day) candidate = earlier;
  return new Date(candidate);
}

/** Next UTC instant strictly after `now` at which any of the local `times` occurs in `tz`. */
export function nextDigestAt(times: string[], tz: string, now: Date): Date | null {
  const valid = times.filter(isValidTime);
  if (valid.length === 0 || !isValidTimeZone(tz)) return null;
  const local = wallClockIn(now, tz);
  let best: Date | null = null;
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const base = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
    for (const t of valid) {
      const [hour, minute] = t.split(":").map(Number) as [number, number];
      const at = zonedToUtc(
        { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate(), hour, minute },
        tz,
      );
      if (at.getTime() > now.getTime() && (!best || at < best)) best = at;
    }
    if (best) return best;
  }
  return best;
}

/** Local calendar date (YYYY-MM-DD) in tz — used for per-day caps such as breaking-alert limits. */
export function localDateKey(date: Date, tz: string): string {
  const w = wallClockIn(date, tz);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}
