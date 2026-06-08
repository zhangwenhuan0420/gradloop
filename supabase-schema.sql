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

create index if not exists listings_status_created_at_idx on public.listings(status, created_at desc);
create index if not exists listings_city_idx on public.listings(city);
create index if not exists listings_category_idx on public.listings(category);
create index if not exists listing_reports_listing_id_idx on public.listing_reports(listing_id);
