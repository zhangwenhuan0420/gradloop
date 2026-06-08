-- Run this once in Supabase SQL Editor to enable WeChat Pay deposit orders.
-- It stores payment order state only. WeChat merchant secrets must stay in Supabase Edge Function secrets.

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  trade_request_id uuid not null references public.trade_requests(id) on delete cascade,
  payer_role text not null check (payer_role in ('buyer', 'seller')),
  provider text not null default 'wechat_pay' check (provider in ('wechat_pay')),
  out_trade_no text not null unique check (char_length(out_trade_no) between 6 and 32),
  transaction_id text,
  amount_gbp numeric(10, 2) not null default 0 check (amount_gbp >= 0),
  amount_cny numeric(10, 2) not null default 0 check (amount_cny >= 0),
  amount_cny_fen integer not null default 0 check (amount_cny_fen >= 0),
  currency text not null default 'CNY',
  code_url text,
  status text not null default 'created' check (status in ('created', 'qr_created', 'paid', 'failed', 'closed', 'refunded')),
  raw_request jsonb,
  raw_response jsonb,
  raw_notify jsonb,
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_orders enable row level security;

drop policy if exists "admins_read_payment_orders" on public.payment_orders;
create policy "admins_read_payment_orders"
on public.payment_orders
for select
to authenticated
using (exists (
  select 1 from public.admin_users
  where email = auth.jwt() ->> 'email'
));

drop policy if exists "admins_update_payment_orders" on public.payment_orders;
create policy "admins_update_payment_orders"
on public.payment_orders
for update
to authenticated
using (exists (
  select 1 from public.admin_users
  where email = auth.jwt() ->> 'email'
))
with check (exists (
  select 1 from public.admin_users
  where email = auth.jwt() ->> 'email'
));

create index if not exists payment_orders_trade_request_id_idx on public.payment_orders(trade_request_id);
create index if not exists payment_orders_status_created_at_idx on public.payment_orders(status, created_at desc);
create index if not exists payment_orders_out_trade_no_idx on public.payment_orders(out_trade_no);
