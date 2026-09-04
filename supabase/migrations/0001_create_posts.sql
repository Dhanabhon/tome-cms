create extension if not exists pgcrypto;

create table public.posts (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  slug text unique not null,
  cover_image text,
  content_json jsonb not null,
  content_html text not null,
  meta_title text,
  meta_description text,
  status text not null check (status in ('draft', 'published')) default 'draft',
  published_at timestamptz,
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create function public.set_post_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();

  if new.status = 'draft' then
    new.published_at = null;
  elsif new.published_at is null then
    new.published_at = now();
  end if;

  return new;
end;
$$;

create trigger posts_set_timestamps
before insert or update on public.posts
for each row execute function public.set_post_timestamps();

alter table public.posts enable row level security;

create policy "Public can read published posts"
  on public.posts for select
  to anon, authenticated
  using (status = 'published');

create policy "Authors have full access to posts"
  on public.posts for all
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'blog-media',
  'blog-media',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Public can read blog media"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'blog-media');

create policy "Authors can upload blog media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'blog-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Authors can update blog media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'blog-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'blog-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Authors can delete blog media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'blog-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
