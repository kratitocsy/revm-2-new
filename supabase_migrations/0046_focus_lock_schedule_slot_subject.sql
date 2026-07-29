-- Lets each schedule slot carry its own subject label (e.g. "Physics",
-- "Organic Chemistry"), separate from the underlying block's name (e.g.
-- "The BIG bang"). The same saved block gets reused across many slots
-- with different subjects, so the block name alone isn't descriptive
-- enough in the schedule list ("The BIG bang 11:00 AM-1:00 PM" x5).
--
-- Suggested options come from user_profiles.subjects (set at onboarding
-- for the person's exam stream - JEE/NEET/etc), but this is always a free
-- text field, not a locked-in enum - see the <datalist> in blocks.html.

alter table focus_lock_schedule_slots
  add column if not exists subject text;

comment on column focus_lock_schedule_slots.subject is
  'Free-text label for what this slot is for (e.g. "Physics"). Suggested from user_profiles.subjects in the UI but editable to anything.';
