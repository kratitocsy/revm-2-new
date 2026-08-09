-- Group/grid/challenge share links all resolve through a group's invite_token.
-- Every study_groups row has one (public groups included), but the SELECT
-- RLS policy on study_groups only allows reading a row if it's public or
-- you're already a member — so a non-member clicking a private group's
-- invite link couldn't even look the group up client-side, let alone join
-- it. This SECURITY DEFINER RPC does the lookup + join server-side,
-- bypassing that chicken-and-egg RLS restriction, and is idempotent if the
-- caller is already a member.
create or replace function public.rpc_join_via_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_limit int;
  v_count int;
  v_already boolean;
begin
  select id, member_limit into v_group_id, v_limit
  from study_groups where invite_token = p_token;

  if v_group_id is null then
    raise exception 'Invalid or expired invite link';
  end if;

  select exists(
    select 1 from group_members where group_id = v_group_id and user_id = auth.uid()
  ) into v_already;

  if not v_already then
    select count(*) into v_count from group_members where group_id = v_group_id;
    if v_count >= v_limit then
      raise exception 'This group is full';
    end if;
    insert into group_members(group_id, user_id, role) values (v_group_id, auth.uid(), 'member');
  end if;

  return v_group_id;
end;
$$;

grant execute on function public.rpc_join_via_invite(text) to authenticated;

-- Challenge share links carry a challenge id, not a group id. Resolving
-- which group a challenge belongs to requires reading group_challenges,
-- which is member-gated by RLS the same way study_groups is — so a
-- non-member link recipient can't resolve it client-side either. This
-- returns just enough (group_id + invite_token + title) to drive the
-- join-and-deep-link flow, without exposing the rest of the row.
create or replace function public.rpc_resolve_challenge_share(p_challenge_id uuid)
returns table(group_id uuid, invite_token text, title text)
language sql
security definer
set search_path = public
as $$
  select c.group_id, g.invite_token, c.title
  from group_challenges c
  join study_groups g on g.id = c.group_id
  where c.id = p_challenge_id;
$$;

grant execute on function public.rpc_resolve_challenge_share(uuid) to authenticated;
