-- GradLoop live MVP schema
-- Run this in Supabase SQL Editor, then update config.js with your Project URL and anon public key.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.admin_users (email)
values ('zhangwenhuan0420@gmail.com')
on conflict (email) do nothing;

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('sell', 'buy')),
  title text not null check (char_length(title) between 2 and 80),
  price numeric(10, 2) not null check (price >= 0),
  city text not null check (char_length(city) between 2 and 40),
  category text not null check (char_length(category) between 2 and 40),
  method text not null check (method in ('pickup', 'delivery', 'both')),
  seller_deposit_rate numeric(4, 2) not null default 0.5 check (seller_deposit_rate between 0 and 1),
  urgent boolean not null default false,
  description text not null check (char_length(description) between 1 and 1200),
  image text,
  contact_name text not null check (char_length(contact_name) between 1 and 50),
  contact_method text not null check (contact_method in ('wechat', 'email', 'phone')),
  contact_value text not null check (char_length(contact_value) between 2 and 120),
  status text not null default 'active' check (status in ('active', 'hidden', 'sold', 'flagged')),
  report_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.listing_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  reason text not null check (char_length(reason) between 2 and 80),
  details text not null check (char_length(details) between 5 and 1200),
  reporter_contact text,
  created_at timestamptz not null default now()
);

create table if not exists public.trade_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_name text not null check (char_length(buyer_name) between 1 and 60),
  buyer_contact_method text not null check (buyer_contact_method in ('wechat', 'email', 'phone')),
  buyer_contact_value text not null check (char_length(buyer_contact_value) between 2 and 120),
  fulfillment_method text not null check (fulfillment_method in ('pickup', 'delivery')),
  message text not null check (char_length(message) between 1 and 1000),
  buyer_deposit_amount numeric(10, 2) not null default 0 check (buyer_deposit_amount >= 0),
  seller_deposit_amount numeric(10, 2) not null default 0 check (seller_deposit_amount >= 0),
  status text not null default 'pending_review' check (status in ('pending_review', 'awaiting_deposit', 'in_escrow', 'completed', 'cancelled')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create or replace function public.increment_listing_report_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.listings
  set report_count = report_count + 1,
      status = case when status = 'active' then 'flagged' else status end,
      updated_at = now()
  where id = new.listing_id;
  return new;
end;
$$;

drop trigger if exists on_listing_report_created on public.listing_reports;
create trigger on_listing_report_created
after insert on public.listing_reports
for each row execute function public.increment_listing_report_count();

alter table public.admin_users enable row level security;
alter table public.listings enable row level security;
alter table public.listing_reports enable row level security;
alter table public.trade_requests enable row level security;
alter table public.payment_orders enable row level security;

drop policy if exists "admin_users_select_self" on public.admin_users;
create policy "admin_users_select_self"
on public.admin_users
for select
to authenticated
using (email = auth.jwt() ->> 'email');

drop policy if exists "public_read_active_listings" on public.listings;
create policy "public_read_active_listings"
on public.listings
for select
to anon, authenticated
using (status = 'active' or exists (
  select 1 from public.admin_users
  where email = auth.jwt() ->> 'email'
));

drop policy if exists "public_create_active_listings" on public.listings;
create policy "public_create_active_listings"
on public.listings
for insert
to anon, authenticated
with check (status = 'active');

drop policy if exists "admins_update_listings" on public.listings;
create policy "admins_update_listings"
on public.listings
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

drop policy if exists "public_create_reports" on public.listing_reports;
create policy "public_create_reports"
on public.listing_reports
for insert
to anon, authenticated
with check (true);

drop policy if exists "admins_read_reports" on public.listing_reports;
create policy "admins_read_reports"
on public.listing_reports
for select
to authenticated
using (exists (
  select 1 from public.admin_users
  where email = auth.jwt() ->> 'email'
));

drop policy if exists "public_create_trade_requests" on public.trade_requests;
create policy "public_create_trade_requests"
on public.trade_requests
for insert
to anon, authenticated
with check (true);

drop policy if exists "admins_read_trade_requests" on public.trade_requests;
create policy "admins_read_trade_requests"
on public.trade_requests
for select
to authenticated
using (exists (
  select 1 from public.admin_users
  where email = auth.jwt() ->> 'email'
));

drop policy if exists "admins_update_trade_requests" on public.trade_requests;
create policy "admins_update_trade_requests"
on public.trade_requests
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

create index if not exists listings_status_created_at_idx on public.listings(status, created_at desc);
create index if not exists listings_city_idx on public.listings(city);
create index if not exists listings_category_idx on public.listings(category);
create index if not exists listing_reports_listing_id_idx on public.listing_reports(listing_id);
create index if not exists trade_requests_listing_id_idx on public.trade_requests(listing_id);
create index if not exists trade_requests_status_created_at_idx on public.trade_requests(status, created_at desc);
create index if not exists payment_orders_trade_request_id_idx on public.payment_orders(trade_request_id);
create index if not exists payment_orders_status_created_at_idx on public.payment_orders(status, created_at desc);
create index if not exists payment_orders_out_trade_no_idx on public.payment_orders(out_trade_no);
