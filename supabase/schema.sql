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

-- Seed the two prospects that were already logged in the original Claude
-- artifact, plus a handful of fictional demo prospects spread across the
-- other pipeline stages (Contacted, Conversation, Qualified, Proposal
-- Submitted, Won, Lost) so the board demos every stage, not just two.
-- Uses upsert (on conflict do update) so re-running this script after the
-- first seed still refreshes the list instead of silently doing nothing.
-- Note: each prospect's full stage-by-stage status history from the
-- artifact wasn't reproducible here — only a single "current stage"
-- history entry is seeded for the two real prospects; the fictional demo
-- prospects likewise carry one history entry each.
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
    },
    {
      "id": "p-demo-twiga",
      "organization": "Twiga Foods",
      "contact": "Alice Njeri",
      "position": "General Counsel",
      "sector": "Agritech / FMCG distribution",
      "practiceArea": "Corporate & Commercial",
      "opportunity": "Supplier contract framework review",
      "estimatedFee": 500000,
      "source": "LinkedIn / social media",
      "relationshipStrength": "Cold",
      "probability": "10",
      "lastContact": "2026-08-10",
      "nextActionDate": "2026-08-20",
      "nextAction": "Send introductory capability statement",
      "responsiblePartner": "p-a",
      "status": "contacted",
      "statusHistory": [
        { "kind": "stage", "stage": "contacted", "date": "2026-08-10", "partnerId": "p-a" }
      ],
      "notesHistory": []
    },
    {
      "id": "p-demo-bolt",
      "organization": "Bolt Kenya",
      "contact": "Daniel Otieno",
      "position": "Regional Legal Manager",
      "sector": "Ride-hailing / mobility tech",
      "practiceArea": "Technology",
      "opportunity": "Data protection compliance audit ahead of new product launch",
      "estimatedFee": 800000,
      "source": "Event",
      "relationshipStrength": "Warm",
      "probability": "25",
      "lastContact": "2026-08-12",
      "nextActionDate": "2026-08-21",
      "nextAction": "Follow-up call to scope the audit",
      "responsiblePartner": "p-gerald",
      "status": "conversation",
      "statusHistory": [
        { "kind": "stage", "stage": "conversation", "date": "2026-08-12", "partnerId": "p-gerald" }
      ],
      "notesHistory": []
    },
    {
      "id": "p-demo-craftsilicon",
      "organization": "Craft Silicon",
      "contact": "Grace Wambui",
      "position": "Chief Operating Officer",
      "sector": "Fintech / banking software",
      "practiceArea": "Technology",
      "opportunity": "IP licensing and cross-border data transfer advisory",
      "estimatedFee": 1200000,
      "source": "Existing client",
      "relationshipStrength": "Strong",
      "probability": "50",
      "lastContact": "2026-08-08",
      "nextActionDate": "2026-08-19",
      "nextAction": "Send draft engagement letter",
      "responsiblePartner": "p-c",
      "status": "qualified",
      "statusHistory": [
        { "kind": "stage", "stage": "qualified", "date": "2026-08-08", "partnerId": "p-c" }
      ],
      "notesHistory": []
    },
    {
      "id": "p-demo-kenyaairways",
      "organization": "Kenya Airways",
      "contact": "Peter Kamau",
      "position": "Head of Legal Affairs",
      "sector": "Aviation",
      "practiceArea": "Commercial Litigation",
      "opportunity": "Cargo contract dispute — representation",
      "estimatedFee": 2000000,
      "source": "Referral",
      "relationshipStrength": "Warm",
      "probability": "75",
      "lastContact": "2026-08-05",
      "nextActionDate": "2026-08-18",
      "nextAction": "Await client decision on proposal",
      "responsiblePartner": "p-d",
      "status": "proposal_submitted",
      "statusHistory": [
        { "kind": "stage", "stage": "proposal_submitted", "date": "2026-08-05", "partnerId": "p-d" }
      ],
      "notesHistory": []
    },
    {
      "id": "p-demo-jumia",
      "organization": "Jumia Kenya",
      "contact": "Susan Achieng",
      "position": "Country Legal Lead",
      "sector": "E-commerce",
      "practiceArea": "Corporate & Commercial",
      "opportunity": "Annual regulatory compliance retainer",
      "estimatedFee": 600000,
      "source": "Partner introduction",
      "relationshipStrength": "Strong",
      "probability": "90",
      "lastContact": "2026-07-28",
      "nextActionDate": "",
      "nextAction": "",
      "responsiblePartner": "p-a",
      "status": "won",
      "statusHistory": [
        { "kind": "stage", "stage": "won", "date": "2026-07-28", "partnerId": "p-a" }
      ],
      "notesHistory": []
    },
    {
      "id": "p-demo-wasoko",
      "organization": "Wasoko",
      "contact": "James Mutiso",
      "position": "Legal Counsel",
      "sector": "B2B e-commerce",
      "practiceArea": "Real Estate & Conveyancing",
      "opportunity": "Warehouse lease negotiation",
      "estimatedFee": 400000,
      "source": "Cold outreach",
      "relationshipStrength": "Cold",
      "probability": "10",
      "lastContact": "2026-07-20",
      "nextActionDate": "",
      "nextAction": "",
      "responsiblePartner": "p-b",
      "status": "lost",
      "statusHistory": [
        { "kind": "stage", "stage": "lost", "date": "2026-07-30", "partnerId": "p-b" }
      ],
      "notesHistory": [
        { "text": "Went with an in-house resource instead; revisit in 6 months.", "date": "2026-07-30", "partnerId": "p-b" }
      ]
    }
  ]'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Seed a few existing clients (Clients tab) — fictional demo data.
insert into kkn_kv (key, value)
values (
  'kkn-clients',
  '[
    {
      "id": "c-demo-equity",
      "name": "Equity Bank",
      "sector": "Banking & Finance",
      "responsiblePartner": "p-a",
      "instructedOn": "2025-11-03",
      "potentialNeeds": "Possible tax advisory on a new product line launching Q4",
      "lastContact": "2026-08-01",
      "nextActionDate": "2026-09-01",
      "nextAction": "Quarterly relationship check-in call",
      "notesHistory": [
        { "text": "Retained for general corporate advisory since Nov 2025.", "date": "2025-11-03", "partnerId": "p-a" }
      ]
    },
    {
      "id": "c-demo-kplc",
      "name": "Kenya Power",
      "sector": "Energy & Utilities",
      "responsiblePartner": "p-d",
      "instructedOn": "2024-06-15",
      "potentialNeeds": "Ongoing regulatory litigation support; possible new tender disputes",
      "lastContact": "2026-07-22",
      "nextActionDate": "2026-08-25",
      "nextAction": "Review status of pending litigation matters",
      "notesHistory": [
        { "text": "Long-standing litigation client; multiple active matters.", "date": "2024-06-15", "partnerId": "p-d" }
      ]
    },
    {
      "id": "c-demo-nairobihospital",
      "name": "Nairobi Hospital",
      "sector": "Healthcare",
      "responsiblePartner": "p-c",
      "instructedOn": "2025-01-20",
      "potentialNeeds": "Data protection compliance review for patient records systems",
      "lastContact": "2026-06-30",
      "nextActionDate": "2026-08-22",
      "nextAction": "Propose a compliance audit scope",
      "notesHistory": []
    }
  ]'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Seed a couple of tenders at different stages (Tenders tab) — fictional
-- demo data, including bid/no-bid scorecard values against
-- SCORING_CRITERIA (relationship, practiceFit, eligibility, pastExperience,
-- commercialAttractiveness, competitivePosition, strategicValue).
insert into kkn_kv (key, value)
values (
  'kkn-tenders',
  '[
    {
      "id": "t-demo-judiciary",
      "title": "Judiciary ICT Modernization Framework — Legal Advisory Panel",
      "procuringEntity": "Judiciary of Kenya",
      "deadline": "2026-09-10",
      "estimatedValue": 3500000,
      "responsiblePartner": "p-gerald",
      "stage": "technical",
      "nextAction": "Finalize technical proposal narrative",
      "nextActionDate": "2026-08-28",
      "scores": {
        "relationship": 15,
        "practiceFit": 18,
        "eligibility": 12,
        "pastExperience": 10,
        "commercialAttractiveness": 8,
        "competitivePosition": 7,
        "strategicValue": 8
      },
      "result": "",
      "notesHistory": [],
      "stageHistory": [
        { "kind": "stage", "stage": "opportunity", "date": "2026-08-01", "partnerId": "p-gerald" },
        { "kind": "stage", "stage": "qualification", "date": "2026-08-05", "partnerId": "p-gerald" },
        { "kind": "stage", "stage": "documents", "date": "2026-08-10", "partnerId": "p-gerald" },
        { "kind": "stage", "stage": "technical", "date": "2026-08-14", "partnerId": "p-gerald" }
      ]
    },
    {
      "id": "t-demo-kra",
      "title": "KRA Legal Advisory Panel 2026-2028",
      "procuringEntity": "Kenya Revenue Authority",
      "deadline": "2026-09-30",
      "estimatedValue": 5000000,
      "responsiblePartner": "p-c",
      "stage": "qualification",
      "nextAction": "Decide bid / no-bid at partner review",
      "nextActionDate": "2026-08-26",
      "scores": {
        "relationship": 5,
        "practiceFit": 15,
        "eligibility": 15
      },
      "result": "",
      "notesHistory": [
        { "text": "Low relationship score so far — worth a warm introduction before committing more time.", "date": "2026-08-12", "partnerId": "p-c" }
      ],
      "stageHistory": [
        { "kind": "stage", "stage": "opportunity", "date": "2026-08-06", "partnerId": "p-c" },
        { "kind": "stage", "stage": "qualification", "date": "2026-08-12", "partnerId": "p-c" }
      ]
    }
  ]'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Seed this month's activity log (Scorecard tab) — fictional demo data
-- across a mix of activity types and partners so the progress bars aren't
-- all sitting at zero.
insert into kkn_kv (key, value)
values (
  'kkn-activity',
  '[
    { "id": "a-demo-1",  "partnerId": "p-gerald", "type": "org_researched",   "date": "2026-08-04", "subject": "Bolt Kenya" },
    { "id": "a-demo-2",  "partnerId": "p-gerald", "type": "org_researched",   "date": "2026-08-06", "subject": "Craft Silicon" },
    { "id": "a-demo-3",  "partnerId": "p-a",      "type": "org_researched",   "date": "2026-08-09", "subject": "Twiga Foods" },
    { "id": "a-demo-4",  "partnerId": "p-gerald", "type": "outreach",         "date": "2026-08-11", "subject": "Bolt Kenya — introductory email" },
    { "id": "a-demo-5",  "partnerId": "p-a",      "type": "outreach",         "date": "2026-08-10", "subject": "Twiga Foods — capability statement sent" },
    { "id": "a-demo-6",  "partnerId": "p-c",      "type": "outreach",         "date": "2026-08-07", "subject": "Craft Silicon — follow-up call" },
    { "id": "a-demo-7",  "partnerId": "p-a",      "type": "existing_client",  "date": "2026-08-01", "subject": "Equity Bank" },
    { "id": "a-demo-8",  "partnerId": "p-d",      "type": "existing_client",  "date": "2026-07-22", "subject": "Kenya Power" },
    { "id": "a-demo-9",  "partnerId": "p-gerald", "type": "meeting",          "date": "2026-08-12", "subject": "Bolt Kenya" },
    { "id": "a-demo-10", "partnerId": "p-d",      "type": "meeting",         "date": "2026-08-05", "subject": "Kenya Airways" },
    { "id": "a-demo-11", "partnerId": "p-gerald", "type": "linkedin_post",    "date": "2026-08-03", "subject": "Cybersecurity trends for Kenyan telcos" },
    { "id": "a-demo-12", "partnerId": "p-a",      "type": "linkedin_post",    "date": "2026-08-09", "subject": "Corporate compliance checklist for e-commerce" },
    { "id": "a-demo-13", "partnerId": "p-gerald", "type": "tender_reviewed",  "date": "2026-08-01", "subject": "Judiciary ICT Modernization Framework" },
    { "id": "a-demo-14", "partnerId": "p-c",      "type": "tender_reviewed",  "date": "2026-08-06", "subject": "KRA Legal Advisory Panel 2026-2028" },
    { "id": "a-demo-15", "partnerId": "p-c",      "type": "client_alert",     "date": "2026-08-02", "subject": "Nairobi Hospital — data protection alert" }
  ]'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();
