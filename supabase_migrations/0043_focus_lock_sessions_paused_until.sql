-- 0043_focus_lock_sessions_paused_until.sql
--
-- Backs the free "type the 150-char code" route in the extension's
-- blocked-page gate ("Pause for a Cause" -> code option). That route no
-- longer ends the session (see background.js's pauseActiveSession) - it
-- just pauses enforcement for 20 minutes and the extension re-locks
-- itself locally on a timer. This column is what lets the website (and
-- any other device polling this row) show "Paused - resumes at X"
-- instead of looking like a normal, still-fully-enforced active session.
--
-- NOTE: I don't have the rest of the focus_lock_sessions migration chain
-- (0001-0042) in this repo/session to check against, so please sanity
-- check the table name and RLS setup below actually match what's live -
-- this is written to the shape blocks.html's direct .from('focus_lock_sessions')
-- reads/writes already assume (user_id, active, block_name, sites, mode,
-- youtube_rules, ends_at, unlimited, no_early_unlock, verified, started_at).

alter table public.focus_lock_sessions
  add column if not exists paused_until timestamptz;

comment on column public.focus_lock_sessions.paused_until is
  'Set by the session-pause edge function when the free code-unlock route is used. Null when not paused. Session stays active=true throughout - the extension clears its own block rules locally and re-applies them once this timestamp passes, independent of this column. Purely informational for anything polling the row (blocks.html, other devices).';
