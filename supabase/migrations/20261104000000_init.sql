-- The Brief — initial schema (Supabase / PostgreSQL 15+)
-- All tables have Row Level Security enabled with NO public policies: only the server-side
-- secret (service role) key used by the API Worker and pipeline can read or write.
-- Clients never talk to Supabase directly.

create extension if not exists pgcrypto;

-- ───────────────────────────── Sources ─────────────────────────────
create table public.sources (
  id              text primary key,                       -- slug, e.g. "bbc-world"
  name            text not null,
  domain          text not null,
  country         char(2),                                -- publisher country (ISO 3166-1)
  language        text not null default 'en',
  feed_url        text,
  default_topic   text,
  owner           text,                                   -- ownership group, for source independence
  official        boolean not null default false,         -- government / central bank / agency
  rights          text not null default 'headline_link'
                  check (rights in ('headline_link', 'headline_excerpt_link', 'full_text_licensed')),
  trust_score     numeric(3,2) not null default 0.50 check (trust_score between 0 and 1),
  status          text not null default 'pending'
                  check (status in ('approved', 'pending', 'discovered', 'disabled')),
  terms_checked   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index sources_domain_idx on public.sources (domain);

create table public.source_health (
  source_id           text primary key references public.sources(id) on delete cascade,
  last_fetch_at       timestamptz,
  last_success_at     timestamptz,
  last_error          text,
  consecutive_errors  integer not null default 0,
  accepted_count      integer not null default 0,         -- articles accepted on the last fetch
  accepted_total      bigint not null default 0,
  updated_at          timestamptz not null default now()
);

-- ───────────────────────────── Articles & stories ─────────────────────────────
create table public.articles (
  id                uuid primary key default gen_random_uuid(),
  canonical_url     text not null unique,
  url               text not null,
  source_id         text references public.sources(id) on delete set null,
  headline          text not null,
  excerpt           text,                                 -- only what the source's rights permit
  language          text not null default 'en',
  publisher_country char(2),
  origin            text not null check (origin in ('rss', 'gdelt', 'official')),
  published_at      timestamptz not null,
  fetched_at        timestamptz not null default now(),
  metadata          jsonb not null default '{}'::jsonb
);
create index articles_published_idx on public.articles (published_at desc);

create table public.story_clusters (
  id                        uuid primary key default gen_random_uuid(),
  language                  text not null default 'en',
  event_countries           text[] not null default '{}',
  affected_countries        text[] not null default '{}',
  topics                    text[] not null default '{}',
  importance                smallint not null default 1 check (importance between 1 and 5),
  sensitive                 boolean not null default false,
  source_count              integer not null default 0,   -- independent sources
  article_count             integer not null default 0,
  source_confidence         numeric(3,2) not null default 0.50,
  status                    text not null default 'active' check (status in ('active', 'archived')),
  breaking_status           text not null default 'none'
                            check (breaking_status in ('none', 'held', 'approved', 'sent', 'rejected')),
  breaking_reason           text,
  summarized_article_count  integer not null default 0,   -- article_count when last summarized
  first_seen_at             timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index story_clusters_updated_idx on public.story_clusters (updated_at desc);
create index story_clusters_event_countries_idx on public.story_clusters using gin (event_countries);
create index story_clusters_affected_countries_idx on public.story_clusters using gin (affected_countries);
create index story_clusters_topics_idx on public.story_clusters using gin (topics);
create index story_clusters_breaking_idx on public.story_clusters (breaking_status) where breaking_status in ('approved', 'held');

create table public.story_sources (
  story_id    uuid not null references public.story_clusters(id) on delete cascade,
  article_id  uuid not null references public.articles(id) on delete cascade,
  primary key (story_id, article_id),
  unique (article_id)                                     -- an article belongs to exactly one story
);
create index story_sources_story_idx on public.story_sources (story_id);

create table public.summaries (
  id                  uuid primary key default gen_random_uuid(),
  story_id            uuid not null references public.story_clusters(id) on delete cascade,
  language            text not null,
  headline            text not null,
  summary             text,                               -- null for headline-only entries
  kind                text not null check (kind in ('summary', 'headline_only')),
  validation_status   text not null default 'pending' check (validation_status in ('approved', 'rejected', 'pending')),
  validation_errors   text[] not null default '{}',
  model               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (story_id, language),
  check (kind = 'headline_only' or summary is not null)
);
create index summaries_language_idx on public.summaries (language, validation_status);

-- ───────────────────────────── Anonymous installations ─────────────────────────────
create table public.installations (
  id                     uuid primary key default gen_random_uuid(),
  secret_hash            text not null,                    -- sha-256 of the device secret; secret never stored
  platform               text check (platform in ('ios', 'android', 'web')),
  push_token             text unique,
  push_token_updated_at  timestamptz,
  created_at             timestamptz not null default now(),
  last_active_at         timestamptz not null default now()
);
create index installations_last_active_idx on public.installations (last_active_at);

create table public.preferences (
  installation_id  uuid primary key references public.installations(id) on delete cascade,
  countries        text[] not null default '{}',
  topics           text[] not null default '{}',
  language         text not null default 'en',
  breaking_alerts  boolean not null default true,
  settings         jsonb not null default '{}'::jsonb,     -- everything not queried server-side
  updated_at       timestamptz not null default now()
);
create index preferences_countries_idx on public.preferences using gin (countries);
create index preferences_topics_idx on public.preferences using gin (topics);

create table public.notification_schedules (
  installation_id  uuid primary key references public.installations(id) on delete cascade,
  timezone         text not null,
  local_times      text[] not null default '{}',
  next_due_at      timestamptz,
  claimed_at       timestamptz,
  last_sent_at     timestamptz
);
create index notification_schedules_due_idx on public.notification_schedules (next_due_at) where next_due_at is not null;

create table public.notification_deliveries (
  id               bigint generated always as identity primary key,
  installation_id  uuid not null references public.installations(id) on delete cascade,
  story_id         uuid references public.story_clusters(id) on delete set null,
  kind             text not null check (kind in ('digest', 'breaking')),
  dedupe_key       text not null,                          -- digest:<due-iso> or breaking:<story-id>
  status           text not null default 'queued' check (status in ('queued', 'sent', 'error')),
  ticket_id        text,
  error            text,
  created_at       timestamptz not null default now(),
  unique (installation_id, dedupe_key)                    -- idempotency
);
create index notification_deliveries_recent_idx on public.notification_deliveries (installation_id, kind, created_at desc);

-- AI spend guard: the pipeline stops calling the model once the daily cap is reached.
create table public.ai_usage (
  day            date primary key,
  calls          integer not null default 0,
  input_tokens   bigint not null default 0,
  output_tokens  bigint not null default 0,
  updated_at     timestamptz not null default now()
);

-- ───────────────────────────── Security ─────────────────────────────
alter table public.sources                 enable row level security;
alter table public.source_health           enable row level security;
alter table public.articles                enable row level security;
alter table public.story_clusters          enable row level security;
alter table public.story_sources           enable row level security;
alter table public.summaries               enable row level security;
alter table public.installations           enable row level security;
alter table public.preferences             enable row level security;
alter table public.notification_schedules  enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.ai_usage                enable row level security;

-- ───────────────────────────── Views ─────────────────────────────
-- One row per (story, language) ready to serve. security_invoker keeps RLS in force.
create view public.feed_items with (security_invoker = true) as
select
  c.id,
  s.language,
  s.headline,
  s.summary,
  s.kind,
  c.event_countries,
  c.affected_countries,
  c.topics,
  c.importance,
  c.source_count,
  c.source_confidence,
  c.first_seen_at,
  c.updated_at,
  (c.breaking_status = 'sent') as is_breaking,
  p.name     as primary_source_name,
  p.url      as primary_source_url,
  p.country  as primary_source_country
from public.story_clusters c
join public.summaries s on s.story_id = c.id and s.validation_status = 'approved'
left join lateral (
  select src.name, a.url, src.country
  from public.story_sources ss
  join public.articles a on a.id = ss.article_id
  left join public.sources src on src.id = a.source_id
  where ss.story_id = c.id
  order by coalesce(src.trust_score, 0) desc, a.published_at asc
  limit 1
) p on true
where c.status = 'active';

-- Recent articles with their story, used by the pipeline to join new reports to existing stories.
create view public.recent_story_articles with (security_invoker = true) as
select a.id, a.headline, a.language, a.published_at, ss.story_id
from public.articles a
join public.story_sources ss on ss.article_id = a.id
where a.published_at > now() - interval '48 hours';

-- ───────────────────────────── Functions (called with the secret key only) ─────────────────────────────

-- Atomically claim due digest schedules so overlapping cron runs never double-send.
create or replace function public.claim_due_digests(max_rows integer default 200)
returns table (
  installation_id uuid,
  push_token text,
  timezone text,
  local_times text[],
  due_at timestamptz,
  countries text[],
  topics text[],
  language text
)
language sql
security invoker
as $$
  with due as (
    select ns.installation_id
    from public.notification_schedules ns
    join public.installations i on i.id = ns.installation_id
    where ns.next_due_at <= now()
      and (ns.claimed_at is null or ns.claimed_at < now() - interval '10 minutes')
      and i.push_token is not null
    order by ns.next_due_at
    limit max_rows
    for update of ns skip locked
  ),
  claimed as (
    update public.notification_schedules ns
    set claimed_at = now()
    from due
    where ns.installation_id = due.installation_id
    returning ns.installation_id, ns.timezone, ns.local_times, ns.next_due_at
  )
  select c.installation_id, i.push_token, c.timezone, c.local_times, c.next_due_at,
         p.countries, p.topics, p.language
  from claimed c
  join public.installations i on i.id = c.installation_id
  left join public.preferences p on p.installation_id = c.installation_id;
$$;

-- Devices that should receive a breaking alert for a story: opted in, interested in its
-- countries or topics, and under the cap of 2 breaking alerts in the last 24 hours.
create or replace function public.breaking_targets(p_story uuid, p_cap integer default 2)
returns table (installation_id uuid, push_token text, language text)
language sql
security invoker
as $$
  select i.id, i.push_token, p.language
  from public.installations i
  join public.preferences p on p.installation_id = i.id
  join public.story_clusters c on c.id = p_story
  where i.push_token is not null
    and p.breaking_alerts
    and (p.countries && (c.event_countries || c.affected_countries) or (cardinality(p.countries) = 0 and p.topics && c.topics))
    and not exists (
      select 1 from public.notification_deliveries d
      where d.installation_id = i.id and d.dedupe_key = 'breaking:' || p_story::text
    )
    and (
      select count(*) from public.notification_deliveries d
      where d.installation_id = i.id and d.kind = 'breaking' and d.created_at > now() - interval '24 hours'
    ) < p_cap;
$$;

-- Record AI usage for today and return the running total of calls.
create or replace function public.record_ai_usage(p_calls integer, p_input bigint, p_output bigint)
returns integer
language sql
security invoker
as $$
  insert into public.ai_usage (day, calls, input_tokens, output_tokens)
  values (current_date, p_calls, p_input, p_output)
  on conflict (day) do update
    set calls = public.ai_usage.calls + excluded.calls,
        input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
        output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
        updated_at = now()
  returning calls;
$$;

-- Daily housekeeping: keep the free-tier database small.
create or replace function public.cleanup_old_content()
returns jsonb
language plpgsql
security invoker
as $$
declare
  n_clusters integer;
  n_articles integer;
  n_installs integer;
  n_deliveries integer;
begin
  delete from public.story_clusters where updated_at < now() - interval '30 days';
  get diagnostics n_clusters = row_count;
  delete from public.articles a
    where a.published_at < now() - interval '30 days'
      and not exists (select 1 from public.story_sources ss where ss.article_id = a.id);
  get diagnostics n_articles = row_count;
  delete from public.installations where last_active_at < now() - interval '180 days';
  get diagnostics n_installs = row_count;
  delete from public.notification_deliveries where created_at < now() - interval '30 days';
  get diagnostics n_deliveries = row_count;
  delete from public.ai_usage where day < current_date - 90;
  update public.story_clusters set status = 'archived'
    where status = 'active' and updated_at < now() - interval '7 days';
  return jsonb_build_object('clusters', n_clusters, 'articles', n_articles,
                            'installations', n_installs, 'deliveries', n_deliveries);
end;
$$;

-- Feed candidates for one reader: stories matching any chosen country or topic (all stories when
-- none are chosen), plus major stories from anywhere in the last 24 hours. Ranking happens in the API.
create or replace function public.feed_candidates(
  p_language text,
  p_countries text[] default '{}',
  p_topics text[] default '{}',
  p_hours integer default 48,
  p_limit integer default 250
)
returns setof public.feed_items
language sql
stable
security invoker
as $$
  (
    select f.* from public.feed_items f
    where f.language = p_language
      and f.updated_at > now() - make_interval(hours => p_hours)
      and (
        (cardinality(p_countries) = 0 and cardinality(p_topics) = 0)
        or f.event_countries && p_countries
        or f.affected_countries && p_countries
        or f.topics && p_topics
      )
    order by f.updated_at desc
    limit p_limit
  )
  union
  (
    select f.* from public.feed_items f
    where f.language = p_language
      and f.importance >= 4
      and f.updated_at > now() - interval '24 hours'
    order by f.updated_at desc
    limit 50
  );
$$;

-- Stories per country in the last 48 hours, for limited-coverage notices.
create or replace function public.coverage_counts(p_countries text[])
returns table (country text, stories_48h integer)
language sql
stable
security invoker
as $$
  select c.code, (
    select count(*)::integer from public.story_clusters sc
    where sc.status = 'active'
      and sc.updated_at > now() - interval '48 hours'
      and sc.event_countries @> array[c.code]
      and exists (select 1 from public.summaries s where s.story_id = sc.id and s.validation_status = 'approved')
  )
  from unnest(p_countries) as c(code);
$$;

-- Lock functions to the server role.
revoke all on function public.feed_candidates(text, text[], text[], integer, integer) from public, anon, authenticated;
grant execute on function public.feed_candidates(text, text[], text[], integer, integer) to service_role;
revoke all on function public.coverage_counts(text[]) from public, anon, authenticated;
grant execute on function public.coverage_counts(text[]) to service_role;
revoke all on function public.claim_due_digests(integer) from public, anon, authenticated;
revoke all on function public.breaking_targets(uuid, integer) from public, anon, authenticated;
revoke all on function public.record_ai_usage(integer, bigint, bigint) from public, anon, authenticated;
revoke all on function public.cleanup_old_content() from public, anon, authenticated;
revoke all on public.feed_items from anon, authenticated;
revoke all on public.recent_story_articles from anon, authenticated;
grant execute on function public.claim_due_digests(integer) to service_role;
grant execute on function public.breaking_targets(uuid, integer) to service_role;
grant execute on function public.record_ai_usage(integer, bigint, bigint) to service_role;
grant execute on function public.cleanup_old_content() to service_role;
