-- group_live_totals() (added in 0054) selects and returns ss.blocker_verified,
-- but study_sessions was never given that column - it doesn't exist in the
-- table (see information_schema.columns) and nothing in the frontend reads
-- r.blocker_verified from the RPC's result either, so this was a stray
-- reference to a field from an unfinished/abandoned feature. The effect: the
-- function raised "column ss.blocker_verified does not exist" on every call,
-- which groups.html's loadLiveGrid() only console.error'd and swallowed,
-- leaving the live grid permanently stuck showing "No members yet." even
-- when the caller's own session (or anyone else's) was genuinely live.
--
-- Fix: drop the column reference and the returned field entirely, since it
-- isn't wired to anything on the client. If per-session "verified" status
-- (e.g. from focus_lock_sessions.verified) is wanted in the live grid later,
-- it should be joined in explicitly against focus_lock_sessions, not
-- study_sessions.

create or replace function public.group_live_totals(p_group_id uuid)
 returns table(user_id uuid, is_live boolean, is_paused boolean, started_at timestamp with time zone, paused_at timestamp with time zone, accumulated_paused_seconds integer, subject text, today_seconds integer)
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
    select distinct on (ss.user_id)
      ss.user_id, ss.started_at, ss.paused_at, ss.accumulated_paused_seconds,
      ss.subject
    from public.study_sessions ss
    where ss.ended_at is null and ss.is_private = false
    order by ss.user_id, ss.started_at desc
  ),
  today_totals as (
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
    coalesce(t.secs, 0)::int as today_seconds
  from public.group_members gm
  left join active_session a on a.user_id = gm.user_id
  left join today_totals t on t.user_id = gm.user_id
  where gm.group_id = p_group_id;
end;
$function$;
