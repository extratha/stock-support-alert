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
