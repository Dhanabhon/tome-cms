begin;

lock table public.posts, public.post_translation_groups, public.site_settings in share row exclusive mode;

alter table public.post_translation_groups
  add constraint post_translation_groups_id_author_key unique (id, author_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check (
    (is_default and name = 'Uncategorized')
    or (not is_default and lower(name) <> 'uncategorized')
  )
);

create unique index categories_owner_name_key
  on public.categories (owner_id, lower(name));
create unique index categories_one_default_per_owner_key
  on public.categories (owner_id) where is_default;

create table public.post_category_assignments (
  translation_group_id uuid not null,
  category_id uuid not null,
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (translation_group_id, category_id),
  -- Account deletion clears group authors before Category cascades remove assignments.
  foreign key (translation_group_id, owner_id)
    references public.post_translation_groups (id, author_id) on delete cascade deferrable initially deferred,
  foreign key (category_id, owner_id)
    references public.categories (id, owner_id) on delete cascade
);

create index post_category_assignments_category_owner_idx
  on public.post_category_assignments (category_id, owner_id);

create function public.protect_default_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'Category owner cannot be changed.' using errcode = '23514';
  end if;
  if old.is_default then
    if current_user in ('authenticated', 'anon') then
      raise exception 'Uncategorized cannot be changed or deleted.' using errcode = '23514';
    elsif current_user not in ('postgres', 'service_role') then
      -- Auth account cascades run after the parent user has been removed.
      if exists (select 1 from auth.users where id = old.owner_id) then
        raise exception 'Uncategorized cannot be changed or deleted.' using errcode = '23514';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger categories_protect_default
before update or delete on public.categories
for each row execute function public.protect_default_category();

create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_media_updated_at();

create function public.ensure_uncategorized(target_owner_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_id uuid;
begin
  insert into public.categories (owner_id, name, is_default)
  values (target_owner_id, 'Uncategorized', true)
  on conflict (owner_id) where is_default do update set name = excluded.name
  returning id into default_id;
  return default_id;
end;
$$;

create function public.initialize_site_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_uncategorized(new.owner_id);
  return new;
end;
$$;

create trigger site_settings_initialize_categories
after insert on public.site_settings
for each row execute function public.initialize_site_categories();

create function public.initialize_post_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_id is not null then
    insert into public.post_category_assignments (translation_group_id, category_id, owner_id)
    values (new.id, public.ensure_uncategorized(new.author_id), new.author_id);
  end if;
  return new;
end;
$$;

create trigger post_translation_groups_initialize_categories
after insert on public.post_translation_groups
for each row execute function public.initialize_post_categories();

select public.ensure_uncategorized(owners.owner_id)
from (
  select owner_id from public.site_settings where owner_id is not null
  union
  select author_id from public.post_translation_groups where author_id is not null
) as owners;

insert into public.post_category_assignments (translation_group_id, category_id, owner_id)
select groups.id, categories.id, groups.author_id
from public.post_translation_groups as groups
join public.categories on categories.owner_id = groups.author_id and categories.is_default
where groups.author_id is not null
  and not exists (
    select 1 from public.post_category_assignments as assignments
    where assignments.translation_group_id = groups.id
  );

create function public.replace_post_categories(target_post_id uuid, requested_category_ids uuid[])
returns table(category_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  group_id uuid;
  selected_ids uuid[];
begin
  if owner is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if requested_category_ids is null
    or cardinality(requested_category_ids) > 20
    or exists (select 1 from unnest(requested_category_ids) as ids(id) where id is null)
    or cardinality(requested_category_ids) <> (select count(distinct id) from unnest(requested_category_ids) as ids(id))
  then
    raise exception 'Provide up to 20 unique Category IDs.' using errcode = '22023';
  end if;

  -- ponytail: serialize Category RPCs per owner; use finer locks if editor throughput requires it.
  perform 1 from auth.users where id = owner for no key update;
  select groups.id into group_id
  from public.post_translation_groups as groups
  join public.posts on posts.translation_group_id = groups.id
  where posts.id = target_post_id and posts.author_id = owner and groups.author_id = owner
  for update of groups;
  if group_id is null then raise exception 'Post not found.' using errcode = '42501'; end if;

  if exists (
    select 1 from unnest(requested_category_ids) as ids(id)
    where not exists (select 1 from public.categories where categories.id = ids.id and owner_id = owner)
  ) then
    raise exception 'Category not found.' using errcode = '22023';
  end if;
  select array_agg(categories.id) into selected_ids
  from public.categories
  where categories.id = any(requested_category_ids) and owner_id = owner and not is_default;
  if selected_ids is null then selected_ids := array[public.ensure_uncategorized(owner)]; end if;

  delete from public.post_category_assignments where translation_group_id = group_id;
  return query
  insert into public.post_category_assignments as assignments (translation_group_id, category_id, owner_id)
  select group_id, id, owner from unnest(selected_ids) as ids(id)
  returning assignments.category_id;
end;
$$;

create function public.delete_post_category(target_category_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  affected_ids uuid[];
  default_id uuid;
begin
  if owner is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  perform 1 from auth.users where id = owner for no key update;
  perform 1 from public.categories
  where id = target_category_id and owner_id = owner and not is_default for update;
  if not found then raise exception 'Custom Category not found.' using errcode = '42501'; end if;
  select coalesce(array_agg(translation_group_id), '{}'::uuid[]) into affected_ids
  from public.post_category_assignments where category_id = target_category_id and owner_id = owner;
  perform 1 from public.post_translation_groups
  where id = any(affected_ids) and author_id = owner order by id for update;

  delete from public.categories where id = target_category_id;
  default_id := public.ensure_uncategorized(owner);
  insert into public.post_category_assignments (translation_group_id, category_id, owner_id)
  select groups.id, default_id, owner from public.post_translation_groups as groups
  where groups.id = any(affected_ids) and groups.author_id = owner
    and not exists (
      select 1 from public.post_category_assignments where translation_group_id = groups.id
    );
  return cardinality(affected_ids);
end;
$$;

alter table public.categories enable row level security;
alter table public.post_category_assignments enable row level security;

create policy "Owners read Categories" on public.categories for select to authenticated
using (owner_id = (select auth.uid()));
create policy "Owners create custom Categories" on public.categories for insert to authenticated
with check (owner_id = (select auth.uid()) and not is_default and lower(name) <> 'uncategorized');
create policy "Owners update custom Categories" on public.categories for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()) and not is_default and lower(name) <> 'uncategorized');
create policy "Owners read Category assignments" on public.post_category_assignments for select to authenticated
using (owner_id = (select auth.uid()));

create policy "Public reads published Category assignments" on public.post_category_assignments for select to anon
using (exists (
  select 1 from public.posts
  where posts.translation_group_id = post_category_assignments.translation_group_id and posts.status = 'published'
));
create policy "Public reads published Categories" on public.categories for select to anon
using (exists (
  select 1 from public.post_category_assignments as assignments
  join public.posts on posts.translation_group_id = assignments.translation_group_id
  where assignments.category_id = categories.id and posts.status = 'published'
));

revoke all on public.categories, public.post_category_assignments from public, anon, authenticated, service_role;
grant select, insert, update on public.categories to authenticated;
grant select on public.post_category_assignments to authenticated;
grant select on public.categories, public.post_category_assignments to anon;
grant all on public.categories, public.post_category_assignments to service_role;

revoke all on function public.protect_default_category(), public.ensure_uncategorized(uuid),
  public.initialize_site_categories(), public.initialize_post_categories()
  from public, anon, authenticated, service_role;
revoke all on function public.replace_post_categories(uuid, uuid[]), public.delete_post_category(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.replace_post_categories(uuid, uuid[]), public.delete_post_category(uuid) to authenticated;

do $$
begin
  if exists (
    select 1 from public.post_translation_groups as groups
    where groups.author_id is not null and not exists (
      select 1 from public.post_category_assignments where translation_group_id = groups.id
    )
  ) then
    raise exception 'Category backfill left an owned Post group without membership.';
  end if;
end;
$$;

commit;
