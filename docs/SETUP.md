# Going live: step by step

Expect an afternoon for steps 1–5, then app-store review time. Each step says what you need and
how to check it worked. Commands run from the repository root unless noted.

**Accounts you'll need**

| Account | Cost | Used for |
| --- | --- | --- |
| GitHub | free | code, CI, the hourly news pipeline |
| Supabase | free tier | database |
| Cloudflare | free tier | API Worker + website |
| Expo (expo.dev) | free tier | building the apps, push delivery |
| AI model provider | pay per use | summaries (optional at first) |
| Apple Developer Program | $99 / year | iOS App Store |
| Google Play Console | $25 once | Android Play Store |

---

## 0. Get the code onto GitHub

```bash
unzip the-brief.zip && cd the-brief
git init && git add . && git commit -m "The Brief MVP"
# create an empty repository on github.com, then:
git remote add origin https://github.com/YOU/the-brief.git
git push -u origin main
npm install
npm test          # should pass
```

## 1. Database (Supabase)

1. Create a project at supabase.com. Pick the region closest to most readers. For South Asia,
   Singapore or Mumbai works well.
2. Open **SQL Editor**, paste the whole of `supabase/migrations/20261104000000_init.sql`, and
   click **Run**. You can also use the Supabase CLI: `supabase link` then `supabase db push`.
3. In **Project Settings → API keys**, copy the **Project URL** and a **secret key**
   (`sb_secret_…`). The secret key is server-only. Never put it in the website or the app.

Check: **Table Editor** shows `sources`, `articles`, `story_clusters` and the other tables.

> The free tier pauses projects after a week with no activity. The hourly pipeline keeps the
> project active.

## 2. The news pipeline (GitHub Actions)

1. Review `config/sources.json`. For each publisher, read its RSS or terms page, then set
   `terms_checked: true` (or `status: "disabled"`). Add publishers for the countries you care
   about most.
2. Try it with nothing written to the database:
   ```bash
   npm run dry-run --workspace @brief/pipeline
   ```
   This prints how many items each feed returned and lists failing feeds in `source_errors`.
   Fix or disable those feeds.
3. In GitHub, go to **Settings → Secrets and variables → Actions**.
   - **Secrets:** `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `AI_API_KEY`
   - **Variables:** `AI_PROVIDER`, `AI_MODEL`, and optionally `AI_BASE_URL`,
     `AI_DAILY_CALL_CAP` (default 400), `TRANSLATE_LANGUAGES` (e.g. `bn`) and
     `BOT_USER_AGENT` (name your bot and give a contact URL)
   - To start with no AI cost, set `AI_PROVIDER=none`. Stories then appear as headline-only
     entries.
4. Go to **Actions → News pipeline → Run workflow**.

Check: the run log ends with a JSON report, and `story_clusters` and `summaries` have rows.

**Choosing a model.** Pick a fast, low-cost model. Two kinds of endpoint work:
- `AI_PROVIDER=anthropic`: the Anthropic Messages API, with a Claude Haiku-class model.
- `AI_PROVIDER=openai`: any OpenAI-compatible `/chat/completions` endpoint, including OpenAI,
  Google Gemini's OpenAI-compatible endpoint, OpenRouter and others. Set `AI_BASE_URL`.

Check the provider's current per-token prices before choosing. The cost section below shows the
arithmetic.

## 3. The API (Cloudflare Worker)

```bash
cd apps/api
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler deploy
```

Wrangler prints the Worker URL, for example `https://the-brief-api.YOU.workers.dev`.

Check: open `<URL>/v1/health`, which should return `{"ok":true}`, then
`<URL>/v1/feed?countries=BD`.

The Worker also runs **every minute** to send scheduled briefings and approved breaking alerts.
You can see that in **Cloudflare dashboard → Workers → the-brief-api → Logs**.

**Rate limiting (before launch).** In the Cloudflare dashboard, open **Security → WAF →
Rate limiting rules** and add one rule: `POST` requests to `/v1/installations`, at most 10 per
minute per IP.

## 4. The website

The website is now a static export on GitHub Pages, deployed by `publish.yml`. See
[STATIC-MODE.md](STATIC-MODE.md). `.github/workflows/deploy.yml` deploys only the API, and only
when run by hand.

## 5. The apps (Expo / EAS)

1. In `apps/mobile/app.json`:
   - set `extra.apiUrl` to your API URL
   - change `ios.bundleIdentifier` and `android.package` from `com.example.thebrief` to your own
     reverse domain, such as `com.yourname.thebrief`. This can't change after you publish.
2. Link the project to Expo, which fills in `extra.eas.projectId`:
   ```bash
   cd apps/mobile
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```
3. Test on a real phone. Push notifications don't work in Expo Go on Android or in simulators,
   so build a test version:
   ```bash
   npx eas-cli@latest build --platform android --profile preview   # installable APK
   ```
   For iOS, register your device with `npx eas-cli@latest device:create`, then build the
   `preview` profile for iOS.
4. Test a briefing. In Settings, turn on notifications and set a briefing time two or three
   minutes from now. It should arrive at that minute.
5. Production builds and store submission:
   ```bash
   npx eas-cli@latest build --platform all --profile production
   npx eas-cli@latest submit --platform android
   npx eas-cli@latest submit --platform ios
   ```
   EAS creates the iOS signing certificates and the push key for you when asked.

**Store requirements**

- **Privacy policy URL:** use your website's `/privacy` page. Edit
  `apps/web/app/privacy/page.tsx` first to add your contact email and the date, and have it
  checked for your jurisdiction.
- **Apple privacy labels / Google Data safety:** the app collects no name, email, location or
  ads data. If notifications are on, it stores a device identifier and push token, plus the
  reader's chosen countries, topics, language, time zone and times, used only for app
  functionality. Nothing is used for tracking.
- **Google Play, new personal developer accounts:** Google requires a closed test with a
  minimum number of testers over a set period before production access. At the time of
  writing this is 12 testers for 14 days; check the current rule in Play Console.
- **News apps:** both stores may ask about the source and rights of your content. Your answer
  is the source allowlist, publisher attribution with links on every story, and summaries
  limited to feed excerpts.

## 6. Day-to-day editorial work

- **Held breaking stories.** Sensitive events wait in `story_clusters` with
  `breaking_status = 'held'` and a `breaking_reason`. To send one, open the Supabase Table
  Editor and change it to `approved`; the Worker sends it within a minute. Set `rejected` to
  drop it.
- **Source health.** The `source_health` table shows each feed's last success, last error and
  consecutive errors. Disable feeds that keep failing.
- **AI spend.** The `ai_usage` table shows daily calls and tokens.
- **Housekeeping.** It runs automatically once a day. Stories are archived after 7 days and
  deleted after 30; inactive installations are deleted after 180 days.

## Costs

| Item | Expected | Notes |
| --- | --- | --- |
| Supabase | $0 | Free tier: 500 MB database. Cleanup keeps it small. Pro is $25/month if you outgrow it. |
| Cloudflare Workers + site | $0 | Free tier: 100,000 requests/day. Workers Paid is $5/month if you need more CPU time. |
| GitHub Actions | $0 | Hourly runs fit the 2,000 free minutes for private repos. Public repos have unlimited minutes. |
| Expo builds + push | $0 | Free tier includes a monthly quota of builds. Push has no per-message fee. |
| AI model | ~$1–8 | Depends on the model. The arithmetic follows this table. |
| Domain | ~$1 | About $10–15/year, optional (workers.dev is free). |
| Apple / Google | $99/yr, $25 once | Store fees, separate from monthly running costs. |

**AI arithmetic.** One summary is about 1,000 input tokens and 150 output tokens. At the default
cap of 400 calls a day, that's up to about 12,000 calls a month: roughly 12M input and 1.8M
output tokens. Multiply by your model's per-million-token prices. At the PRD's example prices
($0.05 per million input, $0.25 per million output), that's about $1/month. Translations and
retries count as calls too. Lower `AI_DAILY_CALL_CAP` to put a hard ceiling on spend.

## Local development

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars          # fill in Supabase values
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env              # use your computer's LAN IP
cp apps/pipeline/.env.example apps/pipeline/.env

npm run dev:api        # http://localhost:8787
npm run dev:web        # http://localhost:3000
npm run dev:mobile     # scan the QR code with Expo Go (feeds and settings work; push needs a build)
npm run run:local --workspace @brief/pipeline              # one real pipeline run
```

## Before public launch: checklist

- [ ] Every approved source has `terms_checked: true`
- [ ] Privacy page has a contact email and date, and has been reviewed
- [ ] Rate-limiting rule on `POST /v1/installations`
- [ ] Bundle ID and package name changed from `com.example.thebrief`
- [ ] `ALLOWED_ORIGINS` lists only your real website origins
- [ ] A test briefing arrived at the chosen minute on both Android and iOS
- [ ] You've reviewed a held breaking story end to end (`held` → `approved` → alert received)
