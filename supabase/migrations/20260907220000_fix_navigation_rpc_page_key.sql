begin;

-- Align the RPC JSON keys with the Navigation API database mapping.
create or replace function public.replace_navigation_items(target_locale text, target_location text, menu_items jsonb)
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
      if entry.value ->> 'page_id' is not null or entry.value ->> 'url' is not null then
        raise exception 'Home items cannot have a Page or URL.' using errcode = '22023';
      end if;
    elsif item_kind = 'page' then
      if jsonb_typeof(entry.value -> 'page_id') is distinct from 'string' or entry.value ->> 'url' is not null then
        raise exception 'Page items require only a Page ID.' using errcode = '22023';
      end if;
      item_page_id := (entry.value ->> 'page_id')::uuid;
      if not exists (select 1 from public.pages where id = item_page_id and author_id = caller_id and locale = target_locale) then
        raise exception 'Page must belong to the caller and menu locale.' using errcode = '23514';
      end if;
    elsif item_kind = 'custom' then
      if entry.value ->> 'page_id' is not null or jsonb_typeof(entry.value -> 'url') is distinct from 'string' then
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
