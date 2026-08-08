-- Adds an opt-in "private session" flag. group_live_totals() already
-- broadcasts a live session to every group the user belongs to (matched by
-- user_id, not group_id - see its own comment), which is the behavior
-- being relied on here; this migration just adds the "unless marked
-- private" half; a private session still runs, still counts toward the
-- user's own stats/hero clock (reconcileMyFocusSession reads
-- study_sessions directly for auth.uid(), untouched by this), but its
-- live/paused status and subject are hidden from every group's live grid,
-- including the owner's own tile in it - same "invisible mode" idea as a
-- chat client where you still see your own status is different from what
-- everyone else sees.

alter table public.study_sessions
  add column if not exists is_private boolean not null default false;

comment on column public.study_sessions.is_private is
  'When true, this session is excluded from group_live_totals() for every group (including the owner''s own tile there) - the session still runs and still counts toward today_totals. Set at start via rpc_start_study_session(p_is_private).';

-- p_is_private has a default so existing 2-arg callers (any not yet
-- updated to pass it) keep working unchanged. NOTE: CREATE OR REPLACE
-- with a different parameter list creates a NEW overload rather than
-- replacing the original (Postgres function identity includes the
-- parameter list) - the DROP below removes the stale 2-arg version so
-- PostgREST never has two ambiguous candidates to choose between.
create or replace function public.rpc_start_study_session(
  p_group_id uuid,
  p_subject text,
  p_is_private boolean default false
)
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
    insert into public.study_sessions (user_id, group_id, subject, started_at, is_private)
    values (auth.uid(), p_group_id, nullif(trim(p_subject), ''), now(), coalesce(p_is_private, false))
    returning * into v_row;
  exception when unique_violation then
    raise exception 'a session is already running';
  end;

  return v_row;
end;
$$;

-- Remove the pre-existing 2-arg overload now that the 3-arg version above
-- (with a default for p_is_private) fully covers it - otherwise both
-- signatures stay live and any call omitting p_is_private becomes
-- ambiguous to PostgREST.
drop function if exists public.rpc_start_study_session(uuid, text);

create or replace function public.group_live_totals(p_group_id uuid)
 returns table(user_id uuid, is_live boolean, is_paused boolean, started_at timestamp with time zone, paused_at timestamp with time zone, accumulated_paused_seconds integer, subject text, today_seconds integer, blocker_verified boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;

  return query
  with active_session as (
    -- A user has at most one live session at a time (enforced by
    -- rpc_start_study_session), regardless of which group_id (or none)
    -- it was started under, so match on user only, not group_id - a
    -- session started from the Tracker/Timer page should show live in
    -- every group the user belongs to, same as starting it in-room.
    -- is_private sessions are excluded here entirely (own tile included)
    -- so they never show as live/paused in any group's grid.
    select distinct on (ss.user_id)
      ss.user_id, ss.started_at, ss.paused_at, ss.accumulated_paused_seconds,
      ss.subject, ss.blocker_verified
    from public.study_sessions ss
    where ss.ended_at is null and ss.is_private = false
    order by ss.user_id, ss.started_at desc
  ),
  today_totals as (
    -- Today's total still counts private time - privacy hides the live
    -- "studying right now" broadcast, not the credit for having studied.
    select ss.user_id,
      sum(coalesce(ss.total_seconds,
        greatest(0, extract(epoch from (coalesce(ss.ended_at, now()) - ss.started_at))::int - coalesce(ss.accumulated_paused_seconds, 0))
      )) as secs
    from public.study_sessions ss
    where ss.started_at >= (now() at time zone 'utc')::date
    group by ss.user_id
  )
  select
    gm.user_id,
    (a.user_id is not null and a.paused_at is null) as is_live,
    (a.user_id is not null and a.paused_at is not null) as is_paused,
    a.started_at,
    a.paused_at,
    a.accumulated_paused_seconds,
    a.subject,
    coalesce(t.secs, 0)::int as today_seconds,
    coalesce(a.blocker_verified, false) as blocker_verified
  from public.group_members gm
  left join active_session a on a.user_id = gm.user_id
  left join today_totals t on t.user_id = gm.user_id
  where gm.group_id = p_group_id;
end;
$function$;
