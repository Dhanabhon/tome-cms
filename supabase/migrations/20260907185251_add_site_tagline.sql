alter table public.site_settings
  add column tagline text not null default ''
  check (char_length(tagline) <= 120);
