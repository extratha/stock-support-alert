-- Idempotent schema. Apply with `npm run db:migrate`.

create table if not exists symbols (
  symbol      text primary key,
  created_at  timestamptz not null default now()
);

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
