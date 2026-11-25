-- Bideey reminder alerts: step 1. Run once in Supabase SQL Editor (safe to re-run).

create table if not exists push_config (
  id            int primary key default 1 check (id = 1),
  vapid_public  text,
  vapid_private text,
  cron_secret   text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into push_config (id) values (1) on conflict (id) do nothing;

create table if not exists push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  firm_id     text not null references firms(id) on delete cascade,
  partner_id  text not null,
  scope       text not null default 'mine' check (scope in ('mine', 'all')),
  timezone    text not null default 'Africa/Nairobi',
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists push_sent (
  endpoint      text not null references push_subscriptions(endpoint) on delete cascade,
  reminder_key  text not null,
  sent_at       timestamptz not null default now(),
  primary key (endpoint, reminder_key)
);

-- push_config and push_sent are server-only: RLS on, no policies, no client grants.
alter table push_config enable row level security;
alter table push_subscriptions enable row level security;
alter table push_sent enable row level security;
revoke all on push_config, push_subscriptions, push_sent from anon, authenticated;
grant select, delete on push_subscriptions to authenticated;
grant all on push_config, push_subscriptions, push_sent to service_role;
grant select on firm_kv, firm_members to service_role;

drop policy if exists "Users can read their own devices" on push_subscriptions;
create policy "Users can read their own devices" on push_subscriptions
  for select using (user_id = auth.uid());
drop policy if exists "Users can remove their own devices" on push_subscriptions;
create policy "Users can remove their own devices" on push_subscriptions
  for delete using (user_id = auth.uid());

-- The only way a client can add a device. The firm comes from membership, never from the client.
create or replace function public.save_push_subscription(
  sub_endpoint text, sub_p256dh text, sub_auth text,
  sub_partner_id text, sub_scope text, sub_timezone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  member_firm text;
begin
  select firm_id into member_firm from firm_members where user_id = auth.uid();
  if member_firm is null then
    raise exception 'You must belong to a firm to receive alerts.';
  end if;
  if sub_endpoint !~ '^https://([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)/' then
    raise exception 'This browser''s notification service is not supported.';
  end if;
  if not exists (select 1 from pg_timezone_names where name = sub_timezone) then
    sub_timezone := 'Africa/Nairobi';
  end if;

  insert into push_subscriptions (endpoint, user_id, firm_id, partner_id, scope, timezone, p256dh, auth)
  values (sub_endpoint, auth.uid(), member_firm, sub_partner_id, sub_scope, sub_timezone, sub_p256dh, sub_auth)
  on conflict (endpoint) do update
  set user_id = excluded.user_id, firm_id = excluded.firm_id, partner_id = excluded.partner_id,
      scope = excluded.scope, timezone = excluded.timezone, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text, text, text) to authenticated;
