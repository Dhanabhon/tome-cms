create table public.site_settings (
  id boolean primary key default true check (id),
  site_name text not null check (char_length(site_name) between 1 and 120),
  site_description text not null default '' check (char_length(site_description) <= 160),
  default_locale text not null check (default_locale in ('th', 'en')),
  timezone text not null check (timezone in ('Asia/Bangkok', 'UTC')),
  owner_id uuid not null references auth.users(id) on delete restrict,
  installed_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.site_settings enable row level security;

comment on table public.site_settings is
  'Single-row installation marker and public site configuration. Service-role access only.';
