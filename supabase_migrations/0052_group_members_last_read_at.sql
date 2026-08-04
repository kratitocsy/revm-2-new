-- Tracks, per member, when they last opened the group chat tray — powers
-- an unread-count badge on the group sidebar's Chat nav item.
alter table group_members
  add column if not exists last_read_at timestamptz not null default now();

-- SECURITY DEFINER so a member can stamp their own read receipt without
-- needing a broader UPDATE grant on group_members (which also carries the
-- `role` column — we don't want to open that up to self-service updates).
create or replace function mark_group_chat_read(p_group_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update group_members
  set last_read_at = now()
  where group_id = p_group_id and user_id = auth.uid();
$$;

grant execute on function mark_group_chat_read(uuid) to authenticated;
