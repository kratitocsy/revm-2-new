-- Group materials: admin-uploaded study materials (PDF or images), stored
-- as a sequence of already-compressed page images so the reader can be a
-- pure page-by-page (Kindle-style) viewer with no native PDF/image handling
-- on the client - nothing that exposes a "save as" affordance by default.
--
-- Upload flow (client-side, see materials.js):
--   1. Admin picks a PDF or image file.
--   2. Client renders/compresses every page to a JPEG (~150dpi, q~0.72).
--   3. Pages upload to the private 'group-materials' storage bucket.
--   4. group_materials row + one group_material_pages row per page.
--
-- Read flow: any group member can list materials for their group and read
-- individual pages via short-lived signed URLs (createSignedUrl), never a
-- public/direct URL - see materials.js loadPage().

create table if not exists group_materials (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references study_groups(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete set null,
  title text not null,
  source_type text not null check (source_type in ('pdf', 'image')),
  page_count int not null default 0,
  original_size_bytes bigint,
  compressed_size_bytes bigint,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_group_materials_group
  on group_materials(group_id, created_at desc);

create table if not exists group_material_pages (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references group_materials(id) on delete cascade,
  page_number int not null,
  storage_path text not null,  -- path within the 'group-materials' bucket
  width int,
  height int,
  unique(material_id, page_number)
);

create index if not exists idx_group_material_pages_material
  on group_material_pages(material_id, page_number);

alter table group_materials enable row level security;
alter table group_material_pages enable row level security;

-- Any member of the group can see material rows (list + read metadata).
drop policy if exists "materials_member_select" on group_materials;
create policy "materials_member_select" on group_materials for select
  using (exists (
    select 1 from group_members gm
    where gm.group_id = group_materials.group_id and gm.user_id = auth.uid()
  ));

-- Only group admins can create/update/delete material rows.
drop policy if exists "materials_admin_write" on group_materials;
create policy "materials_admin_write" on group_materials for all
  using (exists (
    select 1 from group_members gm
    where gm.group_id = group_materials.group_id and gm.user_id = auth.uid() and gm.role = 'admin'
  ))
  with check (exists (
    select 1 from group_members gm
    where gm.group_id = group_materials.group_id and gm.user_id = auth.uid() and gm.role = 'admin'
  ));

-- Pages inherit access from their parent material's group.
drop policy if exists "material_pages_member_select" on group_material_pages;
create policy "material_pages_member_select" on group_material_pages for select
  using (exists (
    select 1 from group_materials m
    join group_members gm on gm.group_id = m.group_id
    where m.id = group_material_pages.material_id and gm.user_id = auth.uid()
  ));

drop policy if exists "material_pages_admin_write" on group_material_pages;
create policy "material_pages_admin_write" on group_material_pages for all
  using (exists (
    select 1 from group_materials m
    join group_members gm on gm.group_id = m.group_id
    where m.id = group_material_pages.material_id and gm.user_id = auth.uid() and gm.role = 'admin'
  ))
  with check (exists (
    select 1 from group_materials m
    join group_members gm on gm.group_id = m.group_id
    where m.id = group_material_pages.material_id and gm.user_id = auth.uid() and gm.role = 'admin'
  ));

-- ── Manual one-time setup (Supabase dashboard, not run by this migration) ──
-- 1. Storage > Create bucket "group-materials", set to PRIVATE (not public).
-- 2. Storage > Policies for "group-materials" - mirror the table RLS above:
--
--   create policy "group_materials_bucket_select" on storage.objects
--     for select using (
--       bucket_id = 'group-materials'
--       and exists (
--         select 1 from group_materials m
--         join group_members gm on gm.group_id = m.group_id
--         where gm.user_id = auth.uid()
--           and storage.objects.name like m.id::text || '/%'
--       )
--     );
--
--   create policy "group_materials_bucket_admin_write" on storage.objects
--     for insert with check (
--       bucket_id = 'group-materials'
--       and exists (
--         select 1 from group_members gm
--         where gm.user_id = auth.uid() and gm.role = 'admin'
--         and storage.objects.name like gm.group_id::text || '/%'
--       )
--     );
--
--   (Uploads are path-prefixed group_id/material_id/page-001.jpg so both
--   policies can match on the object name without a join through storage.)
