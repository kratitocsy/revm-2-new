-- Powers the new group Statistics tab: per-day study/break seconds for a
-- given member over a date range, so the frontend can render a daily bar
-- chart and a study/break/other donut without pulling raw study_sessions
-- rows (and their private timestamps) to the client directly.
--
-- Security mirrors group_live_totals(): SECURITY DEFINER, but gated by
-- is_group_member() twice - once for the caller (must share a group with
-- the target), once for the target (must actually be a member of that
-- group, not just any user id the caller happens to pass in).

create or replace function public.rpc_user_study_breakdown(p_group_id uuid, p_user_id uuid, p_start timestamptz, p_end timestamptz)
returns table(bucket_date date, study_seconds bigint, break_seconds bigint, session_count int)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  if not public.is_group_member(p_group_id, p_user_id) then
    raise exception 'target user not in this group';
  end if;

  return query
  select
    (ss.started_at at time zone 'utc')::date as bucket_date,
    sum(greatest(0, extract(epoch from (coalesce(ss.ended_at, now()) - ss.started_at))::bigint - coalesce(ss.accumulated_paused_seconds,0)))::bigint as study_seconds,
    sum(coalesce(ss.accumulated_paused_seconds,0))::bigint as break_seconds,
    count(*)::int as session_count
  from public.study_sessions ss
  where ss.user_id = p_user_id
    and ss.started_at >= p_start and ss.started_at < p_end
    and ss.is_private = false
  group by 1
  order by 1;
end;
$function$;
