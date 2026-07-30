-- Lets a schedule slot be marked as a "Sleep" slot instead of referencing
-- a saved block/preset. During a sleep slot, schedule-tick builds a
-- block-everything session directly (whitelist mode + empty allow-lists
-- for both sites and apps, no_early_unlock forced on) rather than reading
-- a preset - see schedule-tick/index.ts.
--
-- Editing an EXISTING sleep slot (removing it, or changing its start/end
-- time) is gated behind a fresh 250-char gibberish code in blocks.html
-- (openScheduleGate's new `length` param), on top of the normal 500-char
-- whole-schedule edit gate - see requestRemoveSlotRow and the sleepChanged
-- check in saveSchedule. A brand new sleep slot being added needs no
-- extra gate, since nothing protective is being weakened yet.

alter table focus_lock_schedule_slots
  add column if not exists is_sleep boolean not null default false;

alter table focus_lock_schedule_slots
  alter column preset_id drop not null;

alter table focus_lock_schedule_slots
  drop constraint if exists focus_lock_schedule_slots_preset_or_sleep;
alter table focus_lock_schedule_slots
  add constraint focus_lock_schedule_slots_preset_or_sleep
    check (preset_id is not null or is_sleep);

comment on column focus_lock_schedule_slots.is_sleep is
  'True for a Sleep slot - blocks all sites/apps during this window instead of using a saved preset. preset_id is null for these.';
