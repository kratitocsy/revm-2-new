-- Lets schedule-tick auto-start/stop the RevMGrid study timer (study_sessions)
-- in lockstep with focus_lock schedule slots, when a slot's subject matches
-- one of the person's onboarded subjects.
--
-- schedule_slot_id marks a study_sessions row as schedule-driven, which
-- matters for the same "don't stomp on something the person started
-- themselves" reason focus_lock_sessions already respects (see
-- schedule-tick's activeSession check): schedule-tick will happily stop a
-- study_sessions row IT started when a slot ends or hands off to a
-- different subject, but will never touch a row with schedule_slot_id
-- null - those were started manually from tracker.html or a group room.

alter table study_sessions
  add column if not exists schedule_slot_id uuid references focus_lock_schedule_slots(id) on delete set null;

comment on column study_sessions.schedule_slot_id is
  'Set only when this session was auto-started by schedule-tick for a schedule slot. Null means it was started manually (tracker.html or a group room) and schedule-tick will never stop/replace it automatically.';
