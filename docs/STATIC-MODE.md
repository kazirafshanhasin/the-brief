# GitHub-only static mode

The public website runs on GitHub alone: no Supabase, Cloudflare, or API keys.
`.github/workflows/publish.yml` runs every hour and on demand:

1. Runs `apps/pipeline` with `FileStore`, which reads and writes JSON instead of a database.
2. Commits the working state to the `news-data` branch, in `state/`. The branch has one rolling
   commit, because each run rewrites several MB of JSON and history would bloat the repository.
3. Writes the public files to `apps/web/public/data/`. These are generated, not committed:
   - `stories.json`: `FeedStory` rows from the last 48 hours, one per story and approved language
   - `story/<id>.json`: `StoryDetail` plus `versions`, for every story kept (7 days), so saved and
     shared links keep working until the story is pruned
   - `meta.json`: generated time and stories per country over 48 hours, for coverage notices
4. Builds `apps/web` as a static export and deploys it with the GitHub Pages actions.

The browser fetches `stories.json` and ranks it with `rankFeed` using the reader's saved countries
and topics. Story pages are pre-rendered, so they keep their SEO metadata.

## Summaries

GitHub Models was retired on 30 July 2026, so no model is available with `GITHUB_TOKEN` alone. The
workflow defaults to `AI_PROVIDER=extractive`: a summary is up to three clean sentences in one
publisher's own words, taken from its permitted feed excerpt. Nothing is generated, so nothing can
be invented, and every story links to its publisher.

Summaries are only as long as the feeds allow. Many publishers send a single sentence, so those
summaries have one sentence. A story with no usable feed text is a labeled headline-only entry. The
pipeline never writes a summary from a headline.

To use an AI provider instead, add these under **Settings → Secrets and variables → Actions**. All
editorial rules still apply.

- Secret: `AI_API_KEY`
- Variables: `AI_PROVIDER` (`openai` or `anthropic`), `AI_MODEL`, and optionally `AI_BASE_URL`,
  `AI_DAILY_CALL_CAP`, `MAX_SUMMARIES_PER_RUN`, `TRANSLATE_LANGUAGES`

Then update the service providers on the privacy page.

## Working on it

```bash
# One real run. Keep DATA_DIR outside the repository.
DATA_DIR=../brief-state PUBLIC_DATA_DIR=$PWD/apps/web/public/data npm run run --workspace @brief/pipeline
npm run dev:web
```

- **A feed keeps failing:** see the run log's `source_errors` or `state/source_health.json` on
  `news-data`, then fix its URL or set `status: "disabled"` in `config/sources.json`.
- **Before promoting the site:** review each publisher's terms and set `terms_checked: true`.

## The app version

`apps/api`, `apps/mobile` and `supabase/` are unchanged. Without `DATA_DIR`, the pipeline still uses
Supabase. `pipeline.yml` and `deploy.yml` now run only by hand, and need the secrets in
[SETUP.md](SETUP.md). The website no longer deploys to Cloudflare.
