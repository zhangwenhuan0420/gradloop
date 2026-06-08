-- Run this once in Supabase SQL Editor to enable protected trade requests.

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

alter table public.trade_requests enable row level security;

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

create index if not exists trade_requests_listing_id_idx on public.trade_requests(listing_id);
create index if not exists trade_requests_status_created_at_idx on public.trade_requests(status, created_at desc);
