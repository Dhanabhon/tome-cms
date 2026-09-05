create temporary table posts_multilingual_snapshot as
select
  id,
  title,
  slug,
  cover_image,
  content_json,
  content_html,
  meta_title,
  meta_description,
  status,
  published_at,
  author_id,
  created_at,
  updated_at
from public.posts;

alter table public.posts add column locale text;
alter table public.posts add column translation_group_id uuid;

alter table public.posts disable trigger posts_set_timestamps;

update public.posts
set
  locale = coalesce(
    (select default_locale from public.site_settings where id = true),
    'th'
  ),
  translation_group_id = gen_random_uuid()
where locale is null or translation_group_id is null;

alter table public.posts enable trigger posts_set_timestamps;

alter table public.posts
  alter column locale set not null,
  alter column translation_group_id set default gen_random_uuid(),
  alter column translation_group_id set not null;

alter table public.posts
  add constraint posts_locale_check check (locale in ('th', 'en')),
  drop constraint if exists posts_slug_key,
  add constraint posts_locale_slug_key unique (locale, slug),
  add constraint posts_translation_group_locale_key unique (translation_group_id, locale);

create index posts_public_locale_published_idx
  on public.posts (locale, published_at desc)
  where status = 'published';

do $$
begin
  if (select count(*) from public.posts) <> (select count(*) from posts_multilingual_snapshot)
    or exists (
      select 1
      from public.posts as post
      full join posts_multilingual_snapshot as snapshot using (id)
      where post.id is null
        or snapshot.id is null
        or row(
        post.title,
        post.slug,
        post.cover_image,
        post.content_json,
        post.content_html,
        post.meta_title,
        post.meta_description,
        post.status,
        post.published_at,
        post.author_id,
        post.created_at,
        post.updated_at
      ) is distinct from row(
        snapshot.title,
        snapshot.slug,
        snapshot.cover_image,
        snapshot.content_json,
        snapshot.content_html,
        snapshot.meta_title,
        snapshot.meta_description,
        snapshot.status,
        snapshot.published_at,
        snapshot.author_id,
        snapshot.created_at,
        snapshot.updated_at
      )
    )
  then
    raise exception 'Multilingual migration changed existing post data.';
  end if;
end;
$$;

drop table posts_multilingual_snapshot;
