-- Bidi Revenue Engine - multitenant Supabase schema
-- Run this in Supabase SQL Editor. It creates firm-scoped storage with RLS so
-- authenticated users can only read/write data for firms they belong to.

create table if not exists firms (
  id          text primary key,
  name        text not null,
  slug        text unique not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table firms
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create table if not exists firm_members (
  firm_id     text not null references firms(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member',
  created_at  timestamptz not null default now(),
  primary key (firm_id, user_id),
  constraint firm_members_one_firm_per_user unique (user_id),
  constraint firm_members_role_check check (role in ('owner', 'admin', 'member'))
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'firm_members_one_firm_per_user'
  ) then
    alter table firm_members
      add constraint firm_members_one_firm_per_user unique (user_id);
  end if;
end $$;

create table if not exists firm_invites (
  id           uuid primary key default gen_random_uuid(),
  firm_id      text not null references firms(id) on delete cascade,
  token        text unique not null default replace(gen_random_uuid()::text, '-', ''),
  email        text,
  role         text not null default 'member',
  invited_by   uuid not null references auth.users(id) on delete cascade,
  expires_at   timestamptz not null default (now() + interval '14 days'),
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint firm_invites_role_check check (role in ('admin', 'member')),
  constraint firm_invites_email_lowercase check (email is null or email = lower(email))
);

create table if not exists firm_kv (
  firm_id     text not null references firms(id) on delete cascade,
  key         text not null,
  value       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (firm_id, key)
);

-- Remove the earlier draft's domain auto-join hook if it was installed.
drop trigger if exists assign_user_to_firm_by_email_domain on auth.users;
drop function if exists public.assign_user_to_firm_by_email_domain();

create index if not exists firm_members_user_id_idx on firm_members(user_id);
create index if not exists firm_kv_firm_id_idx on firm_kv(firm_id);

alter table firms enable row level security;
alter table firm_members enable row level security;
alter table firm_invites enable row level security;
alter table firm_kv enable row level security;

drop policy if exists "Members can read their firms" on firms;
create policy "Members can read their firms"
  on firms
  for select
  using (
    exists (
      select 1
      from firm_members fm
      where fm.firm_id = firms.id
        and fm.user_id = auth.uid()
    )
  );

drop policy if exists "Users can read their own memberships" on firm_members;
create policy "Users can read their own memberships"
  on firm_members
  for select
  using (user_id = auth.uid());

drop policy if exists "Members can read firm data" on firm_kv;
create policy "Members can read firm data"
  on firm_kv
  for select
  using (
    exists (
      select 1
      from firm_members fm
      where fm.firm_id = firm_kv.firm_id
        and fm.user_id = auth.uid()
    )
  );

drop policy if exists "Members can write firm data" on firm_kv;
create policy "Members can write firm data"
  on firm_kv
  for all
  using (
    exists (
      select 1
      from firm_members fm
      where fm.firm_id = firm_kv.firm_id
        and fm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from firm_members fm
      where fm.firm_id = firm_kv.firm_id
        and fm.user_id = auth.uid()
    )
  );

drop policy if exists "No direct client access to firm invites" on firm_invites;
create policy "No direct client access to firm invites"
  on firm_invites
  for select
  using (false);

create or replace function public.slugify_firm_name(firm_name text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(firm_name, 'firm')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.register_firm(firm_name text)
returns firms
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text;
  final_slug text;
  firm_id text;
  created_firm firms%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to register a firm.';
  end if;

  if exists (select 1 from firm_members where user_id = auth.uid()) then
    raise exception 'This user already belongs to a firm.';
  end if;

  if length(trim(coalesce(firm_name, ''))) < 2 then
    raise exception 'Firm name is required.';
  end if;

  base_slug := coalesce(nullif(slugify_firm_name(firm_name), ''), 'firm');
  final_slug := base_slug;
  firm_id := final_slug;

  while exists (select 1 from firms where slug = final_slug or id = firm_id) loop
    final_slug := base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    firm_id := final_slug;
  end loop;

  insert into firms (id, name, slug, created_by)
  values (firm_id, trim(firm_name), final_slug, auth.uid())
  returning * into created_firm;

  insert into firm_members (firm_id, user_id, role)
  values (created_firm.id, auth.uid(), 'owner');

  return created_firm;
end;
$$;

create or replace function public.create_firm_invite(invite_email text default null, invite_role text default 'member')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  inviter firm_members%rowtype;
  invite_token text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create an invite.';
  end if;

  select *
  into inviter
  from firm_members
  where user_id = auth.uid()
  limit 1;

  if not found or inviter.role not in ('owner', 'admin') then
    raise exception 'Only firm owners and admins can invite users.';
  end if;

  if invite_role not in ('admin', 'member') then
    raise exception 'Invite role must be admin or member.';
  end if;

  insert into firm_invites (firm_id, email, role, invited_by)
  values (inviter.firm_id, nullif(lower(trim(invite_email)), ''), invite_role, auth.uid())
  returning token into invite_token;

  return invite_token;
end;
$$;

create or replace function public.accept_firm_invite(invite_token text)
returns firms
language plpgsql
security definer
set search_path = public
as $$
declare
  invite firm_invites%rowtype;
  existing_membership firm_members%rowtype;
  user_email text;
  accepted_firm firms%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept an invite.';
  end if;

  select *
  into invite
  from firm_invites
  where token = invite_token
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if not found then
    raise exception 'This invite is invalid or has expired.';
  end if;

  select *
  into existing_membership
  from firm_members
  where user_id = auth.uid()
  limit 1;

  if found then
    if existing_membership.firm_id = invite.firm_id then
      select *
      into accepted_firm
      from firms
      where id = invite.firm_id;

      return accepted_firm;
    end if;

    raise exception 'This user already belongs to a different firm.';
  end if;

  select lower(email)
  into user_email
  from auth.users
  where id = auth.uid();

  if invite.email is not null and invite.email <> user_email then
    raise exception 'This invite was issued for a different email address.';
  end if;

  insert into firm_members (firm_id, user_id, role)
  values (invite.firm_id, auth.uid(), invite.role);

  update firm_invites
  set accepted_at = now(),
      accepted_by = auth.uid()
  where id = invite.id;

  select *
  into accepted_firm
  from firms
  where id = invite.firm_id;

  return accepted_firm;
end;
$$;

insert into firms (id, name, slug)
values ('kkn', 'KKN Law LLP', 'kkn')
on conflict (id) do update
set name = excluded.name,
    slug = excluded.slug;

-- If the old single-tenant table exists, copy its rows into the KKN firm.
do $$
begin
  if to_regclass('public.kkn_kv') is not null then
    insert into firm_kv (firm_id, key, value, updated_at)
    select 'kkn', key, value, updated_at
    from kkn_kv
    on conflict (firm_id, key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at;
  end if;
end $$;

insert into firm_kv (firm_id, key, value)
values (
  'kkn',
  'kkn-partners',
  '[
    { "id": "p-gerald", "firmId": "kkn", "name": "Gerald Kiti", "identity": "Technology / AI / Cybersecurity + Strategic Relationships" },
    { "id": "p-a", "firmId": "kkn", "name": "Partner A", "identity": "Corporate & M&A" },
    { "id": "p-b", "firmId": "kkn", "name": "Oscar Kariuki", "identity": "Real Estate & Conveyancing" },
    { "id": "p-c", "firmId": "kkn", "name": "George Kimotho", "identity": "Tax" },
    { "id": "p-d", "firmId": "kkn", "name": "Lorraine Ouma", "identity": "Commercial Litigation" }
  ]'::jsonb
)
on conflict (firm_id, key) do nothing;

insert into firm_kv (firm_id, key, value)
values (
  'kkn',
  'kkn-prospects',
  '[
    {
      "id": "p-safaricom-seed",
      "firmId": "kkn",
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
      "firmId": "kkn",
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
on conflict (firm_id, key) do nothing;

-- Existing users are not auto-joined by domain. Add the first KKN owner
-- manually, then let that owner create invite links from the app. Example:
--
-- insert into firm_members (firm_id, user_id, role)
-- select 'kkn', id, 'owner'
-- from auth.users
-- where email = 'person@example.com'
-- on conflict (user_id) do update set firm_id = excluded.firm_id, role = excluded.role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'firm_kv'
     ) then
    alter publication supabase_realtime add table firm_kv;
  end if;
end $$;
