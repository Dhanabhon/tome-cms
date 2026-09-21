import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/*
 * Postgres has no \p{Script=Thai}, so the Thai block is named by its range. It is a little
 * wider than the rule the application checks first -- it admits the block's unassigned code
 * points too -- which is the right way round for a backstop: the database must never refuse
 * an address the application has already accepted, and the application refuses those.
 *
 * String.raw so that Postgres receives the \u escapes themselves rather than the characters
 * JavaScript would otherwise turn them into.
 */
const THAI_OR_LATIN = String.raw`^[a-z0-9฀-๿]+(-[a-z0-9฀-๿]+)*$`;
const LATIN = '^[a-z0-9]+(-[a-z0-9]+)*$';

const constrain = (table: 'pages' | 'posts', pattern: string) => sql.raw(`
  alter table ${table} drop constraint ${table}_slug_check;
  alter table ${table} add constraint ${table}_slug_check
    check (char_length(slug) between 1 and 160 and slug ~ '${pattern}');
`);

/**
 * A Thai title may have a Thai address.
 *
 * The rule that a slug is `[a-z0-9]` and hyphens was written three times -- in the
 * application's schema, in the function that made slugs, and here -- and a Thai slug had to
 * get past all three. This is the third. Without it the first save of a Thai title would
 * have been accepted by the application and refused by the table.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await constrain('posts', THAI_OR_LATIN).execute(db);
  await constrain('pages', THAI_OR_LATIN).execute(db);
}

/** Refused while any Thai address exists: going back would orphan every link to one. */
export async function down(db: Kysely<Database>): Promise<void> {
  await constrain('posts', LATIN).execute(db);
  await constrain('pages', LATIN).execute(db);
}
