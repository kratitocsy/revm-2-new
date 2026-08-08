-- rpc_start_study_session already intends "one live session per user at a
-- time" via a check-then-insert (SELECT ... EXISTS, then raise exception,
-- then INSERT), but that's not atomic under concurrent calls - two
-- simultaneous "Start Studying" requests (double-click, two open tabs/
-- devices) can both pass the EXISTS check before either INSERT commits,
-- leaving a user with two rows where ended_at is null.
--
-- That matters now that groups.html's reconcileMyFocusSession() reads the
-- viewer's active session with .maybeSingle() - which throws if it ever
-- matches more than one row. No violation exists in the data today, but
-- nothing was stopping one from happening. This closes the race with a
-- real constraint instead of relying on the app-level check alone.

create unique index if not exists study_sessions_one_active_per_user
  on public.study_sessions (user_id)
  where ended_at is null;

comment on index public.study_sessions_one_active_per_user is
  'Enforces at most one in-progress (ended_at is null) study_sessions row per user_id. Backstop for the check-then-insert race in rpc_start_study_session, and what groups.html''s reconcileMyFocusSession() relies on .maybeSingle() staying safe against.';

-- Keep the RPC's existing friendly error message even in the rare case the
-- pre-check race actually happens and the new constraint is what catches
-- it, instead of surfacing a raw "duplicate key value violates unique
-- constraint" to the client.
create or replace function public.rpc_start_study_session(p_group_id uuid, p_subject text)
returns public.study_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.study_sessions;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if p_group_id is not null and not exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid()
  ) then
    raise exception 'not a member of that group';
  end if;

  -- one live session per user at a time
  if exists (
    select 1 from public.study_sessions
    where user_id = auth.uid() and ended_at is null
  ) then
    raise exception 'a session is already running';
  end if;

  begin
    insert into public.study_sessions (user_id, group_id, subject, started_at)
    values (auth.uid(), p_group_id, nullif(trim(p_subject), ''), now())
    returning * into v_row;
  exception when unique_violation then
    -- Lost the race: another request's insert landed between our EXISTS
    -- check above and this insert. Same message the pre-check gives, so
    -- the client sees one consistent error either way.
    raise exception 'a session is already running';
  end;

  return v_row;
end;
$$;
