-- Global + group-specific leaderboards for the Analytics tab.
-- Ranks users on a combined score of study hours (over the selected
-- range) and M2 coin balance, so grinding hours and earning/spending
-- coins both matter instead of one metric dominating.
--
-- Score = 0.5 * normalized(hours) + 0.5 * normalized(coins), where each
-- metric is min-max normalized against the cohort being ranked (all
-- users for the global board, just that group's members for a group
-- board). Ties broken by hours first (the harder metric to game), then
-- by user id for a stable order.

-- Helpful indexes if they don't already exist.
create index if not exists idx_study_sessions_user_started
  on study_sessions(user_id, started_at);
create index if not exists idx_group_members_group_user
  on group_members(group_id, user_id);

-- Shared helper: total study seconds per user in a date range.
-- p_range: '7d' | '30d' | '90d' | '1y' | 'all'
create or replace function _leaderboard_range_start(p_range text)
returns timestamptz
language sql
immutable
as $$
  select case p_range
    when '7d'  then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when '90d' then now() - interval '90 days'
    when '1y'  then now() - interval '1 year'
    else '-infinity'::timestamptz
  end;
$$;

create or replace function leaderboard_global(p_range text default '30d', p_limit int default 50)
returns table(
  rank int,
  user_id uuid,
  username text,
  avatar_url text,
  track text,
  hours numeric,
  coins int,
  score numeric,
  is_me boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with range_start as (select _leaderboard_range_start(p_range) as ts),
  hrs as (
    select
      s.user_id,
      greatest(0, sum(
        extract(epoch from (coalesce(s.ended_at, now()) - s.started_at))
        - coalesce(s.accumulated_paused_seconds, 0)
      )) / 3600.0 as hours
    from study_sessions s, range_start r
    where s.started_at >= r.ts
    group by s.user_id
  ),
  base as (
    select
      p.id as user_id,
      coalesce(p.username, p.full_name, 'Anonymous') as username,
      p.avatar_url,
      p.track,
      coalesce(h.hours, 0)::numeric as hours,
      coalesce(w.coins, 0) as coins
    from user_profiles p
    left join hrs h on h.user_id = p.id
    left join user_wallets w on w.user_id = p.id
    where coalesce(h.hours, 0) > 0 or coalesce(w.coins, 0) > 0
  ),
  bounds as (
    select
      max(hours) as max_h, min(hours) as min_h,
      max(coins) as max_c, min(coins) as min_c
    from base
  ),
  scored as (
    select
      b.*,
      case when bd.max_h > bd.min_h then (b.hours - bd.min_h) / (bd.max_h - bd.min_h) else 0 end as norm_h,
      case when bd.max_c > bd.min_c then (b.coins - bd.min_c) / (bd.max_c - bd.min_c)::numeric else 0 end as norm_c
    from base b, bounds bd
  )
  select
    (row_number() over (order by (0.5*norm_h + 0.5*norm_c) desc, hours desc, user_id))::int as rank,
    user_id, username, avatar_url, track,
    round(hours, 1) as hours,
    coins,
    round((0.5*norm_h + 0.5*norm_c)::numeric, 4) as score,
    (user_id = auth.uid()) as is_me
  from scored
  order by score desc, hours desc, user_id
  limit greatest(1, least(p_limit, 200));
$$;

grant execute on function leaderboard_global(text, int) to authenticated;

create or replace function leaderboard_group(p_group_id uuid, p_range text default '30d', p_limit int default 50)
returns table(
  rank int,
  user_id uuid,
  username text,
  avatar_url text,
  track text,
  hours numeric,
  coins int,
  score numeric,
  is_me boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with membership_check as (
    select 1 from group_members gm
    where gm.group_id = p_group_id and gm.user_id = auth.uid()
  ),
  range_start as (select _leaderboard_range_start(p_range) as ts),
  members as (
    select gm.user_id from group_members gm where gm.group_id = p_group_id
  ),
  hrs as (
    select
      s.user_id,
      greatest(0, sum(
        extract(epoch from (coalesce(s.ended_at, now()) - s.started_at))
        - coalesce(s.accumulated_paused_seconds, 0)
      )) / 3600.0 as hours
    from study_sessions s, range_start r
    where s.started_at >= r.ts and s.user_id in (select user_id from members)
    group by s.user_id
  ),
  base as (
    select
      p.id as user_id,
      coalesce(p.username, p.full_name, 'Anonymous') as username,
      p.avatar_url,
      p.track,
      coalesce(h.hours, 0)::numeric as hours,
      coalesce(w.coins, 0) as coins
    from user_profiles p
    join members m on m.user_id = p.id
    left join hrs h on h.user_id = p.id
    left join user_wallets w on w.user_id = p.id
  ),
  bounds as (
    select
      max(hours) as max_h, min(hours) as min_h,
      max(coins) as max_c, min(coins) as min_c
    from base
  ),
  scored as (
    select
      b.*,
      case when bd.max_h > bd.min_h then (b.hours - bd.min_h) / (bd.max_h - bd.min_h) else 0 end as norm_h,
      case when bd.max_c > bd.min_c then (b.coins - bd.min_c) / (bd.max_c - bd.min_c)::numeric else 0 end as norm_c
    from base b, bounds bd
  )
  select
    (row_number() over (order by (0.5*norm_h + 0.5*norm_c) desc, hours desc, user_id))::int as rank,
    user_id, username, avatar_url, track,
    round(hours, 1) as hours,
    coins,
    round((0.5*norm_h + 0.5*norm_c)::numeric, 4) as score,
    (user_id = auth.uid()) as is_me
  from scored
  where exists (select 1 from membership_check)
  order by score desc, hours desc, user_id
  limit greatest(1, least(p_limit, 200));
$$;

grant execute on function leaderboard_group(uuid, text, int) to authenticated;

-- Convenience: groups the current user belongs to, for populating the
-- group-leaderboard picker without a separate round trip.
create or replace function my_leaderboard_groups()
returns table(group_id uuid, name text)
language sql
security definer
set search_path = public
stable
as $$
  select g.id as group_id, g.name
  from group_members gm
  join study_groups g on g.id = gm.group_id
  where gm.user_id = auth.uid()
  order by g.name;
$$;

grant execute on function my_leaderboard_groups() to authenticated;
