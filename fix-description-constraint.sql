-- Run this once in Supabase SQL Editor if posting fails with:
-- new row for relation "listings" violates check constraint "listings_description_check"

alter table public.listings
drop constraint if exists listings_description_check;

alter table public.listings
add constraint listings_description_check
check (char_length(description) between 1 and 1200);
