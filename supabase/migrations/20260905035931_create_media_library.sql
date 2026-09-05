create table public.media_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80 and name = btrim(name)),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index media_folders_owner_name_key
  on public.media_folders (owner_id, lower(name));

create table public.media_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.media_folders(id) on delete set null,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 8388608),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  alt_text text check (alt_text is null or char_length(alt_text) <= 300),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index media_items_owner_created_idx on public.media_items (owner_id, created_at desc);
create index media_items_owner_folder_idx on public.media_items (owner_id, folder_id);

create or replace function public.set_media_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger media_folders_set_updated_at
before update on public.media_folders
for each row execute function public.set_media_updated_at();

create trigger media_items_set_updated_at
before update on public.media_items
for each row execute function public.set_media_updated_at();

alter table public.media_folders enable row level security;
alter table public.media_items enable row level security;

create policy "Owners can select media folders" on public.media_folders
for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can insert media folders" on public.media_folders
for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can update media folders" on public.media_folders
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy "Owners can delete media folders" on public.media_folders
for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "Owners can select media items" on public.media_items
for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can insert media items" on public.media_items
for insert to authenticated with check (
  (select auth.uid()) = owner_id
  and (
    folder_id is null
    or exists (
      select 1 from public.media_folders
      where media_folders.id = folder_id
        and media_folders.owner_id = (select auth.uid())
    )
  )
);
create policy "Owners can update media items" on public.media_items
for update to authenticated
using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and (
    folder_id is null
    or exists (
      select 1 from public.media_folders
      where media_folders.id = folder_id
        and media_folders.owner_id = (select auth.uid())
    )
  )
);
create policy "Owners can delete media items" on public.media_items
for delete to authenticated using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.media_folders to authenticated;
grant select, insert, update, delete on public.media_items to authenticated;
revoke all on public.media_folders from anon;
revoke all on public.media_items from anon;

drop policy if exists "Public can read blog media" on storage.objects;
create policy "Owners can list their blog media" on storage.objects
for select to authenticated
using (
  bucket_id = 'blog-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
