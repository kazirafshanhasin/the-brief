# The Brief

A minimalist, worldwide, personalized news platform: a website plus Android and iOS apps.
Readers choose countries, topics and a reading language, and get attributed news summaries of
two to four sentences. They can also schedule briefings at exact times and get verified
breaking-news alerts. There are no accounts and no ads.

This repository is the MVP codebase described in the PRD (v1.0, 3 Nov 2026).
**The website runs on GitHub alone: see [docs/STATIC-MODE.md](docs/STATIC-MODE.md).**
[docs/SETUP.md](docs/SETUP.md) covers the full setup with the apps, Supabase and Cloudflare. Its
website steps no longer apply.

## How it fits together

```
 config/sources.json ──►  apps/pipeline  (GitHub Actions, hourly)
 GDELT DOC API       ──►  discover → normalize → cluster → classify → summarize → validate → flag breaking
                                   │ writes
                                   ▼
                          Supabase Postgres  (supabase/migrations)
                                   ▲ reads / writes
                                   │
                          apps/api  (Cloudflare Worker)
                          • public read API: feed, explore, story, coverage
                          • anonymous installations (no accounts)
                          • every-minute cron: scheduled top-3 digests + breaking alerts → Expo Push
                             ▲                         ▲
                 apps/web (Next.js on Cloudflare)   apps/mobile (Expo: Android + iOS)
```

| Folder | What it is |
| --- | --- |
| `packages/core` | Shared TypeScript: types, countries (all 250), topics, languages, design tokens, ranking, DST-safe scheduling, clustering, classification, breaking-news rules, summary validation, a small Supabase REST client |
| `supabase/migrations` | Database schema: tables from the PRD, indexes, RLS, the feed view and SQL functions |
| `apps/pipeline` | News ingestion and editorial pipeline (Node, runs in GitHub Actions) |
| `apps/api` | Cloudflare Worker API and notification dispatcher |
| `apps/web` | Next.js website (SEO story pages), deployed to Cloudflare with OpenNext |
| `apps/mobile` | Expo / React Native app for Android and iOS |
| `config/sources.json` | Publisher allowlist and GDELT queries |

## Editorial rules built in

- Summaries are written **only from the publishers' own feed excerpts**, and only for sources
  whose `rights` allow it. If a story has only a headline, it's published as a clearly labeled
  **headline-only** entry (or not at all). The AI never writes a summary from a headline.
- Every AI summary is checked before publishing: it must have 2–4 sentences, stay under the
  length limits, contain no links or first-person text, and **every number in it must appear in
  the sources**. A draft that fails gets one corrected retry, then falls back to headline-only.
- Stories record where the event happened, separately from the publisher's country. A US outlet
  writing about Japan files under Japan.
- Breaking alerts need importance ≥ 4, at least two *independent* sources (wire copies and
  sister outlets count once) or one official primary source, a report under two hours old, and
  a new event. Sensitive events (conflict, disasters, disputed claims) are **held** for an
  editor. Each reader gets at most two breaking alerts in any 24 hours.
- Countries with thin coverage show a limited-coverage note. The feed is never padded.

## Commands

```bash
npm install                     # once, at the repo root
npm test                        # unit tests: core, pipeline, api
npm run typecheck               # all packages

npm run dry-run --workspace @brief/pipeline   # fetch real feeds, summarize in memory, write nothing
npm run dev:api                 # Worker on http://localhost:8787 (needs apps/api/.dev.vars)
npm run dev:web                 # website on http://localhost:3000
npm run dev:mobile              # Expo dev server
```

## Monthly cost (beta)

Hosting, database, push and discovery fit in free tiers at beta scale. The variable cost is the
AI model, which `AI_DAILY_CALL_CAP` bounds. See "Costs" in [docs/SETUP.md](docs/SETUP.md).

## Known limitations of this MVP

- **Feeds haven't been tested live.** The build environment had no internet access to news
  sites. Run the dry run first; it lists every feed that fails. The per-source status is also
  kept in the `source_health` table.
- Clustering compares headlines **within one language**. Reports of the same event in different
  languages stay as separate stories.
- The interface text is English only. Summary language is selectable; major stories are
  translated and the rest fall back to English, with a label.
- The website has no push notifications. Scheduled briefings and breaking alerts are app-only.
- Expo push *receipts* are not polled; dead tokens are removed using the immediate push tickets.
- Android has no Times New Roman, and the font can't be bundled without a licence, so Android
  uses the system serif.
- Device registration (`POST /v1/installations`) has no built-in rate limit. Add a Cloudflare
  rate-limiting rule before launch (see SETUP).
