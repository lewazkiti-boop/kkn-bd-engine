-- Bideey reminder alerts: step 3 (after the function is deployed).
-- Replace YOUR_PROJECT_REF (the first part of your Supabase project URL), then run once.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'bideey-send-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select cron_secret from public.push_config where id = 1)
    ),
    body    := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
