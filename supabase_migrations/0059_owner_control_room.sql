-- Wires up the previously-unused temp_global_roles table so the owner
-- (kiarase2288@gmail.com) can grant temporary owner/vice_admin powers to
-- another account "in time of need" (e.g. a trusted co-founder covering
-- while the owner is unavailable), with an automatic expiry, plus a
-- platform-wide metrics RPC for the Control Room dashboard.

-- is_owner() now also recognizes an active (non-expired) temp_global_roles
-- row with role = 'owner', in addition to the hardcoded owner email.
create or replace function public.is_owner()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = 'kiarase2288@gmail.com'
  )
  or exists (
    select 1 from public.temp_global_roles t
    where t.user_id = auth.uid()
      and t.role = 'owner'
      and t.expires_at > now()
  );
$$;

-- Grant a temporary owner or vice_admin role to another account by email.
-- Owner-only. Hours is capped at 720 (30 days) to keep grants genuinely
-- temporary rather than a silent permanent backdoor.
create or replace function public.admin_grant_temp_role(p_email text, p_role text, p_hours integer, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not public.is_owner() then
    raise exception 'owner only';
  end if;

  if p_role not in ('owner','vice_admin') then
    raise exception 'invalid role: %, must be owner or vice_admin', p_role;
  end if;

  if p_hours is null or p_hours <= 0 or p_hours > 720 then
    raise exception 'hours must be between 1 and 720 (30 days)';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(p_email);
  if v_user_id is null then
    raise exception 'no account found with email %', p_email;
  end if;

  delete from public.temp_global_roles where user_id = v_user_id and role = p_role;

  insert into public.temp_global_roles (user_id, role, reason, expires_at)
  values (v_user_id, p_role, p_reason, now() + (p_hours || ' hours')::interval);
end;
$$;

grant execute on function public.admin_grant_temp_role(text, text, integer, text) to authenticated;

-- Revoke a temp grant immediately (before its natural expiry). Owner-only.
create or replace function public.admin_revoke_temp_role(p_user_id uuid, p_role text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'owner only';
  end if;

  delete from public.temp_global_roles
  where user_id = p_user_id
    and (p_role is null or role = p_role);
end;
$$;

grant execute on function public.admin_revoke_temp_role(uuid, text) to authenticated;

-- List all temp grants (active and recently expired) with the account's
-- email resolved, for display in the Control Room. Owner-only.
create or replace function public.admin_list_temp_roles()
returns table(user_id uuid, email text, role text, reason text, granted_at timestamptz, expires_at timestamptz, is_active boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'owner only';
  end if;

  return query
  select t.user_id, u.email, t.role, t.reason, t.granted_at, t.expires_at, (t.expires_at > now()) as is_active
  from public.temp_global_roles t
  join auth.users u on u.id = t.user_id
  order by t.granted_at desc;
end;
$$;

grant execute on function public.admin_list_temp_roles() to authenticated;

-- Whole-platform aggregate metrics for the Control Room dashboard.
-- Owner-only. Single round trip, one JSON blob.
create or replace function public.admin_platform_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception 'owner only';
  end if;

  select jsonb_build_object(
    'users_total', (select count(*) from public.user_profiles),
    'users_active_7d', (select count(*) from public.user_profiles where last_active_at > now() - interval '7 days'),
    'users_active_30d', (select count(*) from public.user_profiles where last_active_at > now() - interval '30 days'),
    'groups_total', (select count(*) from public.study_groups),
    'groups_official', (select count(*) from public.study_groups where is_official = true),
    'group_members_total', (select count(*) from public.group_members),
    'group_messages_total', (select count(*) from public.group_messages),
    'study_sessions_total', (select count(*) from public.study_sessions),
    'study_seconds_all_time', (select coalesce(sum(total_seconds),0) from public.study_sessions),
    'study_seconds_7d', (select coalesce(sum(total_seconds),0) from public.study_sessions where started_at > now() - interval '7 days'),
    'coins_outstanding', (select coalesce(sum(coins),0) from public.user_wallets),
    'coins_total_earned_all_time', (select coalesce(sum(total_earned),0) from public.user_wallets),
    'revenue_total_all_time', (select coalesce(sum(amount),0) from public.revenue_events),
    'revenue_30d', (select coalesce(sum(amount),0) from public.revenue_events where occurred_at > now() - interval '30 days'),
    'payouts_pending_count', (select count(*) from public.payout_requests where status = 'pending'),
    'payouts_pending_amount', (select coalesce(sum(amount),0) from public.payout_requests where status = 'pending'),
    'payouts_paid_all_time', (select coalesce(sum(amount),0) from public.payout_requests where status = 'paid'),
    'revhead_total', (select count(*) from public.user_profiles where is_revhead = true),
    'revhead_pending_applications', (select count(*) from public.user_profiles where revhead_status = 'pending'),
    'revhead_earnings_all_time', (select coalesce(sum(amount),0) from public.revhead_earnings_ledger),
    'moderators_total', (select count(*) from public.user_profiles where is_moderator = true),
    'admins_total', (select count(*) from public.user_profiles where is_admin = true),
    'temp_roles_active', (select count(*) from public.temp_global_roles where expires_at > now()),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_platform_metrics() to authenticated;
