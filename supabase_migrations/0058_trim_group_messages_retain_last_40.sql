-- Keeps group chat lean: after every insert, delete anything past the most
-- recent 40 messages in that group. Chat text is cheap on free-tier storage,
-- but this keeps group_messages small and chat loads fast regardless of
-- how long a group has been active.

create or replace function public.trg_trim_group_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.group_messages gm
  using (
    select id
    from public.group_messages
    where group_id = new.group_id
    order by created_at desc
    offset 40
  ) overflow_rows
  where gm.id = overflow_rows.id;
  return new;
end;
$$;

drop trigger if exists trim_group_messages on public.group_messages;
create trigger trim_group_messages
after insert on public.group_messages
for each row execute function public.trg_trim_group_messages();

-- Supports the ORDER BY created_at query in this trigger and in loadGroupChat()
create index if not exists idx_group_messages_group_created
  on public.group_messages (group_id, created_at desc);
