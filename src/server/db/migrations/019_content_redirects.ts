import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

const recorder = (table: 'pages' | 'posts', column: 'page_id' | 'post_id') => sql.raw(`
  create function tomecms_record_${table}_redirect() returns trigger
  language plpgsql as $$
  begin
    -- Whatever lives at an address is what the address means. A redirect left there by an
    -- older rename would otherwise shadow nothing today and quietly win the day this article
    -- moves on again.
    delete from content_redirects
      where ${column} is not null and locale = new.locale and slug = new.slug;

    -- Only an address a reader could have had: a draft's slug was never public, and a slug
    -- that did not change moved nothing.
    if tg_op = 'UPDATE' and old.slug is distinct from new.slug and old.published_at is not null then
      insert into content_redirects (locale, slug, ${column})
        values (old.locale, old.slug, new.id)
        on conflict (locale, slug) where ${column} is not null
        do update set ${column} = excluded.${column}, created_at = current_timestamp;
    end if;
    return null;
  end;
  $$;

  create trigger ${table}_record_redirect after insert or update of slug on ${table}
    for each row execute function tomecms_record_${table}_redirect();
`);

/**
 * Where an article used to be.
 *
 * A row per address that was once public and is not any more, pointing at the article and
 * not at the address it moved to. That is what makes a chain of renames cost nothing: A then
 * B then C leaves A and B both pointing at the article, which is at C, so there is no chain
 * to follow and no loop to fall into. It is also what makes deletion right without a rule
 * for it -- the rows cascade with the article, and its old addresses answer 404 like its
 * current one does.
 *
 * Recorded by the table rather than by the code that renames, so a rename that arrives by any
 * route -- the editor, the API, a line of SQL -- leaves its forwarding address behind.
 *
 * Posts and pages keep separate columns rather than one untyped id: each has a foreign key
 * that can cascade, and each has its own namespace -- /th/blog/x and /th/x are different
 * addresses.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table content_redirects (
      locale text not null,
      slug text not null,
      post_id uuid references posts (id) on delete cascade,
      page_id uuid references pages (id) on delete cascade,
      created_at timestamptz not null default current_timestamp,
      constraint content_redirects_one_target check ((post_id is null) <> (page_id is null))
    );
    create unique index content_redirects_post_address on content_redirects (locale, slug) where post_id is not null;
    create unique index content_redirects_page_address on content_redirects (locale, slug) where page_id is not null;
  `.execute(db);
  await recorder('posts', 'post_id').execute(db);
  await recorder('pages', 'page_id').execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    drop trigger posts_record_redirect on posts;
    drop trigger pages_record_redirect on pages;
    drop function tomecms_record_posts_redirect();
    drop function tomecms_record_pages_redirect();
    drop table content_redirects;
  `.execute(db);
}
