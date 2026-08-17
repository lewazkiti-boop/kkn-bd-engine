-- KKN Revenue Engine — Supabase schema
-- Run this once in your Supabase project's SQL editor (Project → SQL Editor → New query).

create table if not exists kkn_kv (
  key         text primary key,
  value       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Row Level Security: the app has no login screen (partners just pick their
-- name), so it authenticates with Supabase's public "anon" key and relies on
-- the link/URL itself being private to the firm. This policy allows that key
-- to read and write every row. If you later add real partner authentication,
-- tighten this policy accordingly.
alter table kkn_kv enable row level security;

drop policy if exists "Allow anon read/write on kkn_kv" on kkn_kv;
create policy "Allow anon read/write on kkn_kv"
  on kkn_kv
  for all
  using (true)
  with check (true);

-- Optional but recommended: enables live updates across partners' browsers
-- via Supabase Realtime (Database → Replication → supabase_realtime).
-- Safe to run even if you don't wire up realtime subscriptions yet.
alter publication supabase_realtime add table kkn_kv;

-- Seed the default partner list so the app has something to show on first
-- load (the app will overwrite this the first time someone edits partners).
insert into kkn_kv (key, value)
values (
  'kkn-partners',
  '[
    { "id": "p-gerald", "name": "Gerald Kiti", "identity": "Technology / AI / Cybersecurity + Strategic Relationships" },
    { "id": "p-a", "name": "Partner A", "identity": "Corporate & M&A" },
    { "id": "p-b", "name": "Partner B", "identity": "Real Estate & Conveyancing" },
    { "id": "p-c", "name": "Partner C", "identity": "Tax" },
    { "id": "p-d", "name": "Partner D", "identity": "Commercial Litigation" }
  ]'::jsonb
)
on conflict (key) do nothing;
