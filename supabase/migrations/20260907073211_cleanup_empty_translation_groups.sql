begin;

lock table public.posts in share row exclusive mode;

delete from public.post_translation_groups as groups
where not exists (
  select 1
  from public.posts
  where posts.translation_group_id = groups.id
);

create function public.remove_empty_post_translation_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.post_translation_groups
  where id = old.translation_group_id
    and not exists (
      select 1
      from public.posts
      where posts.translation_group_id = old.translation_group_id
    );
  return null;
end;
$$;

revoke all on function public.remove_empty_post_translation_group()
from public, anon, authenticated, service_role;

create trigger posts_remove_empty_translation_group
after delete on public.posts
for each row execute function public.remove_empty_post_translation_group();

commit;
