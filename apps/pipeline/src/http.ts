/** Polite HTTP: timeouts, retries with backoff, and a minimum delay between requests per host. */

const lastHit = new Map<string, number>();

export interface FetchOptions {
  userAgent: string;
  timeoutMs?: number;
  retries?: number;
  minIntervalMs?: number;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function politeFetch(url: string, opts: FetchOptions): Promise<Response> {
  const host = new URL(url).host;
  const retries = opts.retries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = (lastHit.get(host) ?? 0) + (opts.minIntervalMs ?? 1000) - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": opts.userAgent, Accept: "application/rss+xml, application/atom+xml, application/xml, application/json;q=0.9, */*;q=0.5", ...opts.headers },
        signal: ctrl.signal,
        redirect: "follow",
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      await sleep(1000 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Run tasks with bounded concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
