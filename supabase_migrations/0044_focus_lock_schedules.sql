-- Recurring schedules for focus_lock: a schedule is an ordered list of
-- slots (each pointing at an existing focus_lock_presets row), repeated on
-- chosen days of the week. Enforcement is server-side (see the
-- schedule-tick edge function + pg_cron below) so it fires even if the
-- website/app isn't open at 7am.

create table if not exists focus_lock_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- 0=Sunday .. 6=Saturday, matches JS Date#getDay() so the client and the
  -- edge function agree without a lookup table.
  days_of_week smallint[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists focus_lock_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references focus_lock_schedules(id) on delete cascade,
  slot_order int not null,
  preset_id uuid not null references focus_lock_presets(id) on delete cascade,
  start_time time not null,
  end_time time not null,
  -- Break AFTER this slot, before the next one starts. User-set, can be as
  -- short as 1-2 minutes - not hardcoded to 30. Ignored on the last slot
  -- of the day.
  break_after_minutes int not null default 0 check (break_after_minutes >= 0),
  created_at timestamptz not null default now(),
  constraint schedule_slot_time_order check (end_time > start_time)
);

create index if not exists idx_schedule_slots_schedule
  on focus_lock_schedule_slots(schedule_id, slot_order);

-- One row per (slot, calendar day) it actually fired, so the tick function
-- is idempotent: if the person ends a slot's session early (paid unlock),
-- re-running the tick a minute later must NOT re-lock them for the rest
-- of that same slot. Only the *next* slot/day starts fresh.
create table if not exists focus_lock_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references focus_lock_schedules(id) on delete cascade,
  slot_id uuid not null references focus_lock_schedule_slots(id) on delete cascade,
  run_date date not null,
  session_id uuid references focus_lock_sessions(id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  unique(slot_id, run_date)
);

alter table focus_lock_sessions
  add column if not exists schedule_id uuid references focus_lock_schedules(id) on delete set null,
  add column if not exists schedule_slot_id uuid references focus_lock_schedule_slots(id) on delete set null;

alter table focus_lock_schedules enable row level security;
alter table focus_lock_schedule_slots enable row level security;
alter table focus_lock_schedule_runs enable row level security;

drop policy if exists "schedules_owner" on focus_lock_schedules;
create policy "schedules_owner" on focus_lock_schedules for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "schedule_slots_owner" on focus_lock_schedule_slots;
create policy "schedule_slots_owner" on focus_lock_schedule_slots for all
  using (exists (select 1 from focus_lock_schedules s where s.id = schedule_id and s.user_id = auth.uid()))
  with check (exists (select 1 from focus_lock_schedules s where s.id = schedule_id and s.user_id = auth.uid()));

-- Runs are only ever written by the schedule-tick edge function (service
-- role, bypasses RLS) - regular users get read-only visibility into their
-- own schedule's run history, nothing more.
drop policy if exists "schedule_runs_read_own" on focus_lock_schedule_runs;
create policy "schedule_runs_read_own" on focus_lock_schedule_runs for select
  using (exists (select 1 from focus_lock_schedules s where s.id = schedule_id and s.user_id = auth.uid()));

-- ── Manual one-time setup (not run automatically by this migration) ──
-- schedule-tick needs to run every minute. In the Supabase SQL editor,
-- with pg_cron + pg_net extensions enabled on the project:
--
--   select cron.schedule(
--     'focus-lock-schedule-tick',
--     '* * * * *',
--     $$
--     select net.http_post(
--       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/schedule-tick',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--         'Content-Type', 'application/json'
--       ),
--       body := '{}'::jsonb
--     );
--     $$
--   );
--
-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY>. Confirm it's running with:
--   select * from cron.job_run_details order by start_time desc limit 5;
