alter table public.site_settings
  add column author_name text not null default ''
    check (char_length(author_name) <= 120),
  add column author_avatar_media_id uuid
    references public.media_items(id) on delete set null,
  add column author_bio_th text not null default ''
    check (char_length(author_bio_th) <= 1000),
  add column author_bio_en text not null default ''
    check (char_length(author_bio_en) <= 1000),
  add column author_links jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(author_links) = 'array'
      and jsonb_array_length(author_links) <= 5
    );
