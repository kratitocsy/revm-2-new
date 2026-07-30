-- Tracks how many times a saved block (preset) has been edited so the
-- first 2 edits can go through with no friction, and every edit after
-- that is gated behind a fresh 250-char gibberish code (same honesty
-- rule/anti-cheat as the sleep-slot edit gate in blocks.html - see
-- requestEditPreset/openScheduleGate). Editing a block is weakening a
-- commitment you already made when you saved it, so casual/rapid changes
-- past a couple of genuine tweaks should cost real deliberate effort,
-- same reasoning as the schedule edit lock.

alter table focus_lock_presets
  add column if not exists edit_count integer not null default 0;

comment on column focus_lock_presets.edit_count is
  'How many times this saved block has been edited. First 2 edits (0,1) are free; edit_count >= 2 requires typing the 250-char gibberish code in blocks.html before the edit form opens.';
