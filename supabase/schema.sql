-- Bidi Revenue Engine — Supabase schema
-- Run this once in your Supabase project's SQL editor (Project → SQL Editor → New query).

create table if not exists kkn_kv (
  key         text primary key,
  value       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Row Level Security: the app requires magic-link sign-in (Supabase Auth),
-- so only requests carrying a valid logged-in session may read/write. Anyone
-- can request a magic link for now (no email allowlist/domain restriction) —
-- see README for how to tighten this to specific partner emails later.
alter table kkn_kv enable row level security;

drop policy if exists "Allow anon read/write on kkn_kv" on kkn_kv;
drop policy if exists "Allow authenticated read/write on kkn_kv" on kkn_kv;
create policy "Allow authenticated read/write on kkn_kv"
  on kkn_kv
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Optional but recommended: enables live updates across partners' browsers
-- via Supabase Realtime (Database → Replication → supabase_realtime).
-- Safe to run even if you don't wire up realtime subscriptions yet.
-- Guarded so re-running this script never errors if the table is already
-- in the publication (Supabase sometimes adds new tables automatically).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'kkn_kv'
  ) then
    alter publication supabase_realtime add table kkn_kv;
  end if;
end $$;

-- Seed the default partner list so the app has something to show on first
-- load (the app will overwrite this the first time someone edits partners).
-- Names match src/App.jsx's DEFAULT_PARTNERS in the current (Bidi) version.
insert into kkn_kv (key, value)
values (
  'kkn-partners',
  '[
    { "id": "p-gerald", "name": "Gerald Kiti", "identity": "Technology / AI / Cybersecurity + Strategic Relationships" },
    { "id": "p-a", "name": "Partner A", "identity": "Corporate & M&A" },
    { "id": "p-b", "name": "Oscar Kariuki", "identity": "Real Estate & Conveyancing" },
    { "id": "p-c", "name": "George Kimotho", "identity": "Tax" },
    { "id": "p-d", "name": "Lorraine Ouma", "identity": "Commercial Litigation" }
  ]'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Seed the two prospects that were already logged in the original Claude
-- artifact (real data, not demo data) — Safaricom Ltd and Azelis Kenya,
-- both owned by Gerald Kiti. Their full stage-by-stage status history
-- wasn't reproducible from the read-only preview, so each carries just one
-- history entry for its current stage.
insert into kkn_kv (key, value)
values (
  'kkn-prospects',
  '[
    {
      "id": "p-safaricom-seed",
      "organization": "Safaricom Ltd",
      "contact": "Cecil Marie",
      "position": "Head of business",
      "sector": "Telecommunication",
      "practiceArea": "Technology",
      "opportunity": "Handling their cyber security issues",
      "estimatedFee": 1000000,
      "source": "Referral",
      "sourceDetailId": "",
      "relationshipStrength": "Warm",
      "probability": "25",
      "lastContact": "2026-08-15",
      "nextActionDate": "2026-08-24",
      "nextAction": "Prepare cyber security deck",
      "responsiblePartner": "p-gerald",
      "status": "target",
      "statusHistory": [
        { "kind": "stage", "stage": "target", "date": "2026-08-15", "partnerId": "p-gerald" }
      ],
      "notesHistory": []
    },
    {
      "id": "p-azelis-seed",
      "organization": "Azelis Kenya",
      "contact": "Omondi",
      "position": "COO",
      "sector": "Manufacturing of paint",
      "practiceArea": "Tax",
      "opportunity": "Handling their tax matters (advisory and litigation)",
      "estimatedFee": 300000,
      "source": "Partner introduction",
      "sourceDetailId": "",
      "relationshipStrength": "Warm",
      "probability": "50",
      "lastContact": "2026-08-15",
      "nextActionDate": "2026-08-23",
      "nextAction": "Generate the Fee note and the list of offering that we are gonna give them",
      "responsiblePartner": "p-gerald",
      "status": "negotiation",
      "statusHistory": [
        { "kind": "stage", "stage": "negotiation", "date": "2026-08-15", "partnerId": "p-gerald" }
      ],
      "notesHistory": []
    }
  ]'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- That's it for real data. Everything else — the rest of the demo
-- prospects, clients, referrals, tenders, the tender vault checklist, and
-- the activity log — is fictional sample data, and the app itself now
-- generates it for you: once signed in, use the "Load Sample Data" control
-- in the app (Bidi Revenue Engine's built-in sample-data generator). That
-- keeps the demo data in exact sync with the current data model (client
-- types, referral attribution links, etc.) instead of duplicating it here
-- in SQL, where it would drift out of date every time the app's fields
-- change. The same control also has a "Clear sample data" option.
