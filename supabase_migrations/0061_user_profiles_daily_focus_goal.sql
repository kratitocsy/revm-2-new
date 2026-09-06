-- Daily focus-time goal shown on Home's "Today's Focus" card (progress
-- bar toward it, e.g. "1h 40m / 3h goal"). User-editable (tap the goal
-- number on Home), defaults to 180 minutes (3h) — matches the Figma
-- Make prototype's example goal, not a claim about what's "right" for
-- any given user.

alter table user_profiles
  add column if not exists daily_focus_goal_minutes integer not null default 180
  check (daily_focus_goal_minutes > 0 and daily_focus_goal_minutes <= 1440);

comment on column user_profiles.daily_focus_goal_minutes is
  'Daily focus-time goal in minutes, shown as a progress bar on the Home page "Today''s Focus" card. User-editable. Default 180 (3h).';
