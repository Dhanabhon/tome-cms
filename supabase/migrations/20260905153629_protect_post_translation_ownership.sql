begin;

-- Keep a stable ownership row so even concurrent first editions contend on one unique key.
lock table public.posts in share row exclusive mode;

create table public.post_translation_groups (
  id uuid primary key,
  author_id uuid references auth.users(id) on delete set null
);

alter table public.post_translation_groups enable row level security;
revoke all on public.post_translation_groups from public, anon, authenticated, service_role;

-- A mixed-owner legacy group fails the primary key instead of silently choosing an owner.
insert into public.post_translation_groups (id, author_id)
select distinct translation_group_id, author_id from public.posts;

create function public.protect_post_translation_ownership()
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
    then
      raise exception 'Edition locale and translation group cannot be changed.' using errcode = '23514';
    end if;

    -- The existing auth.users foreign key must still clear authors on account deletion.
    if new.author_id is distinct from old.author_id
      and not (
        new.author_id is null
        and not exists (select 1 from auth.users where id = old.author_id)
      )
    then
      raise exception 'Edition author cannot be changed.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- The no-op update locks a conflict row and gets its current owner even across concurrent inserts.
  -- At repeatable read, a conflicting snapshot raises a serialization error rather than admitting a foreign owner.
  insert into public.post_translation_groups as groups (id, author_id)
  values (new.translation_group_id, new.author_id)
  on conflict (id) do update set author_id = groups.author_id
  returning author_id into group_author_id;

  if group_author_id is distinct from new.author_id then
    raise exception 'Translation editions must have the same author.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_post_translation_ownership() from public, anon, authenticated, service_role;

create trigger posts_protect_translation_ownership
before insert or update on public.posts
for each row execute function public.protect_post_translation_ownership();

commit;
