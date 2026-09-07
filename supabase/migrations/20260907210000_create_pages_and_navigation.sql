begin;

create table public.page_translation_groups (
  id uuid primary key,
  author_id uuid not null references auth.users(id) on delete cascade
);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  translation_group_id uuid not null default gen_random_uuid(),
  locale text not null check (locale in ('th', 'en')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  slug text not null check (char_length(slug) between 1 and 160),
  content_json jsonb not null,
  content_html text not null,
  meta_title text check (meta_title is null or char_length(meta_title) <= 70),
  meta_description text check (meta_description is null or char_length(meta_description) <= 320),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  author_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, slug),
  unique (translation_group_id, locale),
  unique (id, author_id, locale)
);

create index pages_public_lookup_idx on public.pages (locale, status, slug);
create index pages_owner_updated_idx on public.pages (author_id, updated_at desc);

create function public.set_page_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if new.status = 'published' and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

create trigger pages_set_timestamps
before insert or update on public.pages
for each row execute function public.set_page_timestamps();

alter table public.page_translation_groups enable row level security;
revoke all on public.page_translation_groups from public, anon, authenticated, service_role;

create function public.protect_page_translation_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  group_author_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.locale is distinct from old.locale
      or new.translation_group_id is distinct from old.translation_group_id
      or new.author_id is distinct from old.author_id
    then
      raise exception 'Page locale, translation group, and author cannot be changed.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- The conflict update locks the ownership row even across concurrent first editions.
  insert into public.page_translation_groups as groups (id, author_id)
  values (new.translation_group_id, new.author_id)
  on conflict (id) do update set author_id = groups.author_id
  returning author_id into group_author_id;

  if group_author_id is distinct from new.author_id then
    raise exception 'Translation editions must have the same author.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_page_translation_ownership() from public, anon, authenticated, service_role;
create trigger pages_protect_translation_ownership
before insert or update on public.pages
for each row execute function public.protect_page_translation_ownership();

alter table public.pages enable row level security;
create policy "Anonymous visitors can select published pages" on public.pages
for select to anon using (status = 'published');
create policy "Owners can select pages" on public.pages
for select to authenticated using ((select auth.uid()) = author_id);
create policy "Owners can insert pages" on public.pages
for insert to authenticated with check ((select auth.uid()) = author_id);
create policy "Owners can update pages" on public.pages
for update to authenticated
using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "Owners can delete pages" on public.pages
for delete to authenticated using ((select auth.uid()) = author_id);
revoke all on public.pages from public, anon, authenticated;
grant select on public.pages to anon;
grant select, insert, update, delete on public.pages to authenticated;

create table public.navigation_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  locale text not null check (locale in ('th', 'en')),
  location text not null check (location in ('header', 'footer')),
  kind text not null check (kind in ('home', 'page', 'custom')),
  label text not null check (char_length(label) between 1 and 80 and label = btrim(label)),
  page_id uuid,
  url text check (url is null or char_length(url) <= 2048),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint navigation_items_target_check check (
    (kind = 'home' and page_id is null and url is null)
    or (kind = 'page' and page_id is not null and url is null)
    or (kind = 'custom' and page_id is null and url is not null)
  ),
  constraint navigation_items_page_owner_locale_fkey
    foreign key (page_id, owner_id, locale)
    references public.pages (id, author_id, locale)
    on delete cascade
);

create unique index navigation_items_home_key
  on public.navigation_items (owner_id, locale, location)
  where kind = 'home';
create unique index navigation_items_page_key
  on public.navigation_items (owner_id, locale, location, page_id)
  where kind = 'page';
create index navigation_items_public_order_idx
  on public.navigation_items (owner_id, locale, location, position, id);

create trigger navigation_items_set_updated_at
before update on public.navigation_items
for each row execute function public.set_media_updated_at();

alter table public.navigation_items enable row level security;
create policy "Owners can select navigation items" on public.navigation_items
for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can insert navigation items" on public.navigation_items
for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can update navigation items" on public.navigation_items
for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owners can delete navigation items" on public.navigation_items
for delete to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.navigation_items from public, anon, authenticated;
grant select, insert, update, delete on public.navigation_items to authenticated;

create function public.replace_navigation_items(target_locale text, target_location text, menu_items jsonb)
returns setof public.navigation_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  entry record;
  item_kind text;
  item_label text;
  item_page_id uuid;
  item_url text;
  custom_urls text[] := '{}';
begin
  if caller_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if target_locale is null or target_locale not in ('th', 'en')
    or target_location is null or target_location not in ('header', 'footer')
    or jsonb_typeof(menu_items) is distinct from 'array'
  then
    raise exception 'Invalid navigation locale, location, or items.' using errcode = '22023';
  end if;
  if jsonb_array_length(menu_items) > 50 then
    raise exception 'Navigation accepts at most 50 items.' using errcode = '22023';
  end if;

  -- Serialize replacements of the same menu, including when its current list is empty.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text || ':' || target_locale || ':' || target_location, 0));
  delete from public.navigation_items
  where owner_id = caller_id and locale = target_locale and location = target_location;

  for entry in select value, ordinality from jsonb_array_elements(menu_items) with ordinality loop
    if jsonb_typeof(entry.value) is distinct from 'object'
      or jsonb_typeof(entry.value -> 'kind') is distinct from 'string'
      or jsonb_typeof(entry.value -> 'label') is distinct from 'string'
    then
      raise exception 'Navigation items require a kind and label.' using errcode = '22023';
    end if;
    item_kind := entry.value ->> 'kind';
    item_label := btrim(entry.value ->> 'label');
    item_page_id := null;
    item_url := null;
    if char_length(item_label) not between 1 and 80 then
      raise exception 'Navigation labels must contain 1 to 80 characters.' using errcode = '22023';
    end if;

    if item_kind = 'home' then
      if entry.value ->> 'pageId' is not null or entry.value ->> 'url' is not null then
        raise exception 'Home items cannot have a Page or URL.' using errcode = '22023';
      end if;
    elsif item_kind = 'page' then
      if jsonb_typeof(entry.value -> 'pageId') is distinct from 'string' or entry.value ->> 'url' is not null then
        raise exception 'Page items require only a Page ID.' using errcode = '22023';
      end if;
      item_page_id := (entry.value ->> 'pageId')::uuid;
      if not exists (select 1 from public.pages where id = item_page_id and author_id = caller_id and locale = target_locale) then
        raise exception 'Page must belong to the caller and menu locale.' using errcode = '23514';
      end if;
    elsif item_kind = 'custom' then
      if entry.value ->> 'pageId' is not null or jsonb_typeof(entry.value -> 'url') is distinct from 'string' then
        raise exception 'Custom items require only a URL.' using errcode = '22023';
      end if;
      item_url := btrim(entry.value ->> 'url');
      if char_length(item_url) not between 1 and 2048
        or item_url ~ '[[:space:][:cntrl:]]' or strpos(item_url, chr(92)) > 0
        or not (item_url ~ '^/($|[^/])' or item_url ~* '^https?://[^/?#]+')
      then
        raise exception 'Custom URLs must be site-relative or HTTP(S).' using errcode = '22023';
      end if;
      if item_url = any(custom_urls) then
        raise exception 'Duplicate custom URL.' using errcode = '23505';
      end if;
      custom_urls := array_append(custom_urls, item_url);
    else
      raise exception 'Unknown navigation kind.' using errcode = '22023';
    end if;

    insert into public.navigation_items (owner_id, locale, location, kind, label, page_id, url, position)
    values (caller_id, target_locale, target_location, item_kind, item_label, item_page_id, item_url, (entry.ordinality - 1)::integer);
  end loop;

  return query select * from public.navigation_items
  where owner_id = caller_id and locale = target_locale and location = target_location
  order by position, id;
end;
$$;

revoke all on function public.replace_navigation_items(text, text, jsonb) from public, anon, service_role;
grant execute on function public.replace_navigation_items(text, text, jsonb) to authenticated;

commit;
