-- Idempotent schema. Apply with `npm run db:migrate`.

create table if not exists symbols (
  symbol      text primary key,
  created_at  timestamptz not null default now()
);

-- Display order chosen by drag & drop (null = not placed yet -> sorts last, then A-Z).
alter table symbols add column if not exists position integer;

-- Cached support levels: one row per (symbol, tier), replaced by the daily recalculation.
create table if not exists support_levels (
  symbol       text not null references symbols(symbol) on delete cascade,
  tier         text not null check (tier in ('minor', 'intermediate', 'major')),
  price        numeric(14, 4) not null,
  method       text not null,
  ref_close    numeric(14, 4) not null,
  as_of        date not null,
  computed_at  timestamptz not null default now(),
  primary key (symbol, tier)
);

-- Latest fetched quote per symbol; avoids re-calling the API inside the TTL.
create table if not exists quotes (
  symbol      text primary key references symbols(symbol) on delete cascade,
  price       numeric(14, 4) not null,
  prev_close  numeric(14, 4),
  quote_time  timestamptz not null,
  fetched_at  timestamptz not null default now()
);

-- Added later: today's low, used by the once-a-day check to catch intraday touches.
alter table quotes add column if not exists day_low numeric(14, 4);

-- Re-arm state machine per (symbol, tier). See src/lib/alerts/evaluate.ts.
create table if not exists alert_state (
  symbol         text not null references symbols(symbol) on delete cascade,
  tier           text not null check (tier in ('minor', 'intermediate', 'major')),
  armed          boolean not null default true,
  last_alert_at  timestamptz,
  primary key (symbol, tier)
);

-- Append-only log. No FK so history survives removing a symbol.
create table if not exists alert_history (
  id         bigserial primary key,
  symbol     text not null,
  tier       text not null,
  method     text not null,
  price      numeric(14, 4) not null,
  level      numeric(14, 4) not null,
  sent_at    timestamptz not null default now()
);
create index if not exists alert_history_sent_at_idx on alert_history (sent_at desc);

create table if not exists line_users (
  user_id         text primary key,
  active          boolean not null default true,
  followed_at     timestamptz not null default now(),
  unfollowed_at   timestamptz
);

-- Later additions to line_users (idempotent).
--  active = currently a friend of the OA;  notify = also receives push alerts (capped in the app).
alter table line_users add column if not exists display_name text;
alter table line_users add column if not exists picture_url text;
alter table line_users add column if not exists label text;
-- When the "push is now ON for you" notice was last sent (rate-limits it to protect the push quota).
alter table line_users add column if not exists notice_sent_at timestamptz;
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_users' and column_name = 'notify'
  ) then
    alter table line_users add column notify boolean not null default false;
    -- keep everyone who was receiving alerts before this column existed
    update line_users set notify = active;
  end if;
end $$;

-- Shared cache of the live prices shown on the dashboard (Finnhub / Yahoo). Display only: alerts and
-- support levels never read this table (they use `quotes`, filled by the scheduled Twelve Data check).
create table if not exists live_quotes (
  symbol          text primary key references symbols(symbol) on delete cascade,
  price           numeric(14, 4) not null,
  previous_close  numeric(14, 4),
  as_of           timestamptz,
  source          text not null,
  fetched_at      timestamptz not null default now()
);

-- Company logos, fetched once when a symbol is added (or later by the daily job / seed script) and kept here,
-- so pages never depend on a third-party CDN. logo_type null = no logo yet (logo_checked_at = last attempt).
alter table symbols add column if not exists logo_data bytea;
alter table symbols add column if not exists logo_type text;
alter table symbols add column if not exists logo_source text;
alter table symbols add column if not exists logo_checked_at timestamptz;

-- Fundamentals + risk shown under each card. Price-history stats come from the daily recalculation (Twelve Data),
-- fundamentals from Finnhub once a day. Display only: never used for alerts.
create table if not exists stock_profiles (
  symbol              text primary key references symbols(symbol) on delete cascade,
  -- from our own price history
  last_close          numeric(14, 4),
  high_52w            numeric(14, 4),
  max_drawdown        double precision,  -- e.g. -0.66 = fell 66% from a previous peak
  drawdown_peak_date  date,
  drawdown_trough_date date,
  drawdown_recovered  boolean,           -- did the price later close above that peak again?
  history_from        date,
  history_at          timestamptz,
  -- from Finnhub
  pe                  double precision,
  forward_pe          double precision,
  revenue_growth      double precision,  -- percent, year over year (83.4 = +83.4%)
  net_margin          double precision,  -- percent
  beta                double precision,
  next_earnings       date,
  earnings_hour       text,              -- bmo / amc / dmh (before open, after close, during market)
  fundamentals_at     timestamptz
);


-- Swing Low levels are zones now: the bottom of the zone and how many times the price bounced there (null for other methods).
alter table support_levels add column if not exists zone_low numeric(14, 4);
alter table support_levels add column if not exists touches integer;
-- Which version of the support logic produced the row (SUPPORT_LOGIC_VERSION in src/lib/support/calculate.ts).
-- Rows from an older version count as out of date, so the next recalculation replaces them even on the same day.
alter table support_levels add column if not exists logic_version integer not null default 1;

-- Every touch of a support level when the current logic is replayed over the stock's own history (see
-- src/lib/support/track.ts): did the level hold or break? Replaced for a symbol by each daily recalculation.
create table if not exists support_tests (
  symbol       text not null references symbols(symbol) on delete cascade,
  tier         text not null check (tier in ('minor', 'intermediate', 'major')),
  method       text not null,
  level        numeric(14, 4) not null,
  zone_low     numeric(14, 4),
  touches      integer,
  touched_on   date not null,
  outcome      text not null check (outcome in ('held', 'broken', 'unclear', 'open')),
  resolved_on  date,
  -- share of "held" for an arbitrary level at the same distance on the stock's other days (the yardstick)
  expected_held double precision,
  primary key (symbol, tier, touched_on)
);

-- Last New York trading day each once-a-day job finished, so a second (or delayed) cron run the same day is a no-op.
create table if not exists job_runs (
  job          text primary key,
  last_day     date not null,
  finished_at  timestamptz not null default now()
);

-- Dividend yield (percent per year), from Finnhub. Added after the first release: when the column is created,
-- fundamentals are marked stale once so the next daily job fills it in without waiting for them to age.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_profiles' and column_name = 'dividend_yield'
  ) then
    alter table stock_profiles add column dividend_yield double precision;
    update stock_profiles set fundamentals_at = null;
  end if;
end $$;

-- One row per run of the AI stock ranking (src/lib/jobs/analysis.ts). The row is reserved BEFORE the provider is called
-- (so two clicks at once cannot pass the daily limit) and deleted again if the run ends in an error: only results count.
create table if not exists ai_analyses (
  id          bigserial primary key,
  day         date not null,                 -- New York date of the run
  created_at  timestamptz not null default now(),
  goals       text not null default '',      -- comma separated goal ids
  model       text not null,
  status      text not null default 'pending' check (status in ('pending', 'ok', 'failed')),
  result      jsonb,                         -- summary, picks, caveats, universe (status ok)
  error       text                           -- user-safe message (status failed)
);
create index if not exists ai_analyses_day_idx on ai_analyses (day);

-- What brokerage analysts say, from Finnhub (opinions, display + AI input only). Refreshed every few days.
alter table stock_profiles add column if not exists rec_strong_buy integer;
alter table stock_profiles add column if not exists rec_buy integer;
alter table stock_profiles add column if not exists rec_hold integer;
alter table stock_profiles add column if not exists rec_sell integer;
alter table stock_profiles add column if not exists rec_strong_sell integer;
alter table stock_profiles add column if not exists rec_period date;
alter table stock_profiles add column if not exists target_mean double precision;
alter table stock_profiles add column if not exists target_high double precision;
alter table stock_profiles add column if not exists target_low double precision;
alter table stock_profiles add column if not exists target_updated date;
alter table stock_profiles add column if not exists analysts_at timestamptz;

-- Company name (Finnhub /stock/profile2), so news that names the company without the ticker is still matched.
alter table symbols add column if not exists company_name text;
alter table symbols add column if not exists company_name_checked_at timestamptz;

-- News collected every hour (src/lib/jobs/news.ts): Finnhub company news for each tracked stock plus market news.
-- `body` is the article text read from the publisher's page, kept only until it has been summarised (cleared after
-- 7 days, rows deleted after 30): briefs keep the headline, source and link, never the text.
create table if not exists news_articles (
  id            bigserial primary key,
  key           text not null unique,             -- "fh:<finnhub id>"
  scope         text not null check (scope in ('company', 'market')),
  symbols       text[] not null default '{}',     -- tracked stocks Finnhub filed it under
  source        text not null,
  headline      text not null,
  summary       text not null default '',
  url           text not null,                    -- Finnhub's redirect link
  final_url     text,                             -- the publisher's page, once read
  published_at  timestamptz not null,
  body          text,
  body_status   text check (body_status in ('ok', 'short', 'blocked', 'error', 'skipped')),
  fetched_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists news_articles_published_idx on news_articles (published_at desc);

-- One row per AI news brief (scheduled before the open, or run from the page). Reserved before the provider is called
-- and deleted again on error, like ai_analyses.
create table if not exists news_briefs (
  id            bigserial primary key,
  day           date not null,                    -- New York date of the run
  created_at    timestamptz not null default now(),
  trigger       text not null default 'manual',   -- schedule | manual
  model         text not null,
  status        text not null default 'pending' check (status in ('pending', 'ok')),
  window_from   timestamptz,
  window_to     timestamptz,
  result        jsonb
);
create index if not exists news_briefs_day_idx on news_briefs (day);

-- Public portfolio: a friend's LINE profile picture is shown to visitors only when the owner switched this on for that
-- friend (meant for the owner's own account). Everyone else is shown as a placeholder; names and ids never leave the
-- server for visitors.
alter table line_users add column if not exists public_photo boolean not null default false;
