-- Trading Battleground — Supabase Schema
-- Users handled by Supabase Auth

create table assets (
  id          serial primary key,
  ticker      text unique not null,       -- e.g. 'SPY', 'QQQ', 'BTC-USD'
  name        text,
  asset_class text,                        -- 'equity', 'etf', 'crypto', 'fx'
  active      boolean default true
);

create table market_data (
  id          bigserial primary key,
  ticker      text not null,
  date        date not null,
  open        numeric,
  high        numeric,
  low         numeric,
  close       numeric,
  volume      bigint,
  unique(ticker, date)
);

create index idx_market_data_ticker_date on market_data(ticker, date);

create table strategies (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id),
  name            text not null,
  description     text,
  code            text not null,
  parameters      jsonb default '{}',
  selected_assets text[] not null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table backtest_results (
  id              uuid primary key default gen_random_uuid(),
  strategy_id     uuid references strategies(id),
  status          text default 'pending',
  error_message   text,
  train_start     date,
  train_end       date,
  test_start      date,
  test_end        date,
  sharpe_ratio    numeric,
  total_pnl       numeric,
  max_drawdown    numeric,
  win_rate        numeric,
  avg_turnover    numeric,
  train_sharpe    numeric,
  train_pnl       numeric,
  optimized_params jsonb default '{}',
  equity_curve    jsonb,
  created_at      timestamptz default now()
);

-- RLS Policies
alter table strategies enable row level security;
alter table backtest_results enable row level security;
alter table assets enable row level security;
alter table market_data enable row level security;

-- Users can only CRUD their own strategies
create policy "Users can read own strategies"
  on strategies for select
  using (auth.uid() = user_id);

create policy "Users can insert own strategies"
  on strategies for insert
  with check (auth.uid() = user_id);

create policy "Users can update own strategies"
  on strategies for update
  using (auth.uid() = user_id);

create policy "Users can delete own strategies"
  on strategies for delete
  using (auth.uid() = user_id);

-- Backtest results are public for the leaderboard
create policy "Anyone can read backtest results"
  on backtest_results for select
  using (true);

create policy "Authenticated users can insert backtest results"
  on backtest_results for insert
  with check (auth.uid() is not null);

create policy "Authenticated users can update own backtest results"
  on backtest_results for update
  using (
    auth.uid() = (select user_id from strategies where id = backtest_results.strategy_id)
  );

-- Assets and market_data are public read
create policy "Anyone can read assets"
  on assets for select
  using (true);

create policy "Anyone can read market data"
  on market_data for select
  using (true);

-- Seed default assets
insert into assets (ticker, name, asset_class) values
  ('SPY',     'S&P 500 ETF',              'etf'),
  ('QQQ',     'Nasdaq 100 ETF',           'etf'),
  ('IWM',     'Russell 2000 ETF',         'etf'),
  ('DIA',     'Dow Jones ETF',            'etf'),
  ('XLF',     'Financial Select Sector',  'etf'),
  ('XLK',     'Technology Select Sector', 'etf'),
  ('XLE',     'Energy Select Sector',     'etf'),
  ('XLV',     'Health Care Select Sector','etf'),
  ('XLI',     'Industrial Select Sector', 'etf'),
  ('TLT',     '20+ Year Treasury Bond',  'etf'),
  ('IEF',     '7-10 Year Treasury Bond', 'etf'),
  ('HYG',     'High Yield Corporate Bond','etf'),
  ('LQD',     'Investment Grade Bond',   'etf'),
  ('GLD',     'Gold ETF',                'etf'),
  ('SLV',     'Silver ETF',              'etf'),
  ('USO',     'Oil ETF',                 'etf'),
  ('VIXY',    'VIX Short-Term Futures',  'etf'),
  ('BTC-USD', 'Bitcoin',                 'crypto'),
  ('ETH-USD', 'Ethereum',               'crypto'),
  ('UUP',     'US Dollar Index',         'fx');
