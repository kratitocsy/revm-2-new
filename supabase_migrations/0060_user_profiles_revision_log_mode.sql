-- Lets each user choose, once, how their Recall Curve gets filled in:
-- either automatically from whatever they type into the Focus Lock
-- "Goal" field when a session ends, or purely by hand via the "What
-- did you study today?" card on Home. Asked once via a one-time
-- prompt on Home (see home.html) the first time this is null for an
-- already-onboarded account; NULL means "not asked yet".

alter table user_profiles
  add column if not exists revision_log_mode text
  check (revision_log_mode is null or revision_log_mode in ('focus_lock','manual'));

comment on column user_profiles.revision_log_mode is
  'How the user wants topics added to their Recall Curve: ''focus_lock'' = automatically from the Focus Lock session goal only, ''manual'' = only via the Home page "what did you study today" form. NULL = not asked yet, shows the one-time chooser on Home.';
