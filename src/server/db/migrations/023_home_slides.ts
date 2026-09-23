import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The home page's own slides, per owner and language, at most ten a language. The picture is
 * the one thing a slide cannot be without, so the library may not delete it from under one.
 * A button and its link come together or not at all, with the same three kinds and the same
 * address check as a menu item, and words are never left standing on a bare picture.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table home_slides (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null references "user"(id) on delete cascade,
      locale text not null,
      position integer not null,
      media_id uuid not null,
      heading text,
      body text,
      button_label text,
      link_kind text,
      page_id uuid,
      url text,
      new_tab boolean not null default false,
      align text not null default 'start',
      overlay text not null default 'soft',
      focus text not null default 'center',
      enabled boolean not null default true,
      starts_at timestamptz,
      ends_at timestamptz,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      foreign key (media_id, owner_id) references media_items(id, owner_id) on delete restrict,
      constraint home_slides_place_unique unique (owner_id, locale, position),
      constraint home_slides_locale_check check (locale in ('th', 'en')),
      constraint home_slides_position_check check (position between 0 and 9),
      constraint home_slides_heading_check check (
        heading is null or (heading = btrim(heading) and char_length(heading) between 1 and 80)
      ),
      constraint home_slides_body_check check (
        body is null or (body = btrim(body) and char_length(body) between 1 and 200)
      ),
      constraint home_slides_button_label_check check (
        button_label is null or (button_label = btrim(button_label) and char_length(button_label) between 1 and 30)
      ),
      constraint home_slides_button_check check (
        (button_label is null and link_kind is null and page_id is null and url is null and not new_tab)
        or (button_label is not null and link_kind is not null and (
          (link_kind = 'home' and page_id is null and url is null and not new_tab)
          or (link_kind = 'page' and page_id is not null and url is null and not new_tab)
          or (link_kind = 'custom' and page_id is null and url is not null)
        ))
      ),
      constraint home_slides_url_check check (
        url is null or (
          url = btrim(url)
          and char_length(url) between 1 and 2048
          and url !~ '[[:space:][:cntrl:]]'
          and strpos(url, chr(92)) = 0
          and (url ~ '^/($|[^/])' or url ~* '^https?://[^/?#]+')
        )
      ),
      constraint home_slides_align_check check (align in ('start', 'center', 'end')),
      constraint home_slides_overlay_check check (overlay in ('none', 'soft', 'strong')),
      constraint home_slides_words_check check (overlay <> 'none' or (heading is null and body is null)),
      constraint home_slides_focus_check check (focus in (
        'top-start', 'top', 'top-end', 'start', 'center', 'end', 'bottom-start', 'bottom', 'bottom-end'
      )),
      constraint home_slides_window_check check (starts_at is null or ends_at is null or ends_at > starts_at)
    )
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table home_slides`.execute(db);
}
