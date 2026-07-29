-- Lets a new schedule explicitly "override" (replace/pause) an existing one,
-- as a deliberate, gated action rather than a silent edit.
--
-- Anti-cheat rationale: without this, the gibberish edit-lock gate on
-- Edit/Pause/Remove could be sidestepped entirely by just creating a brand
-- new, much easier "schedule" and ignoring the old strict one. Overriding
-- still requires:
--   1. Passing the OLD schedule's own gibberish gate (same as editing it
--      directly - see openScheduleGate in blocks.html)
--   2. The NEW schedule passing a block-vs-break "looks like a real
--      schedule" check (see scheduleLooksLegit in blocks.html) - so the
--      override can't just be a schedule that's mostly free time
--   3. override_count on the target being under 2 - once a schedule has
--      been overridden twice, it can never be chosen as an override target
--      again, so there's no way to keep "resetting" your commitment
--      indefinitely by chaining overrides.
--
-- None of this is enforced at the DB level (RLS still just checks
-- auth.uid() = user_id, matching every other focus_lock table) - it's a
-- deliberate-friction UX pattern, not a security boundary, same as the
-- gibberish gate itself.

alter table focus_lock_schedules
  add column if not exists overrides_schedule_id uuid references focus_lock_schedules(id) on delete set null,
  add column if not exists override_count integer not null default 0;

comment on column focus_lock_schedules.overrides_schedule_id is
  'Set when this schedule was created specifically to override/replace another schedule. Points at the schedule it replaced.';
comment on column focus_lock_schedules.override_count is
  'How many times a new schedule has been created to override THIS one. Capped at 2 in the client (blocks.html) - once it hits 2 this schedule can no longer be picked as an override target.';
