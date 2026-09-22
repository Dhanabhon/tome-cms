import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * Documents beside the images: PDF, docx, xlsx, pptx, CSV, text and ZIP. Each kind keeps its
 * own rules. An image has its dimensions and may be 8 MB; a document has none and may be 25.
 * Alternative text describes an image, so a document has none.
 *
 * The lists are written out rather than imported: a migration says what it did on the day it
 * ran, whatever the application later accepts.
 */
const IMAGE_TYPES = sql`('image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp')`;
const MEDIA_TYPES = sql`('image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain', 'application/zip')`;

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table media_items
      drop constraint media_items_mime_type_check,
      drop constraint media_items_size_check,
      drop constraint media_items_dimensions_check,
      alter column width drop not null,
      alter column height drop not null,
      add constraint media_items_mime_type_check check (mime_type in ${MEDIA_TYPES}),
      add constraint media_items_size_check check (
        size_bytes between 1 and case when mime_type in ${IMAGE_TYPES} then 8388608 else 26214400 end
      ),
      add constraint media_items_dimensions_check check (
        (mime_type in ${IMAGE_TYPES} and width is not null and height is not null
          and width between 1 and 100000 and height between 1 and 100000)
        or (mime_type not in ${IMAGE_TYPES} and width is null and height is null)
      ),
      add constraint media_items_alt_text_kind_check check (mime_type in ${IMAGE_TYPES} or alt_text is null);

    alter table media_upload_reservations
      drop constraint media_upload_reservations_mime_type_check,
      drop constraint media_upload_reservations_size_check,
      add constraint media_upload_reservations_mime_type_check check (mime_type in ${MEDIA_TYPES}),
      add constraint media_upload_reservations_size_check check (
        expected_size_bytes between 1 and case when mime_type in ${IMAGE_TYPES} then 8388608 else 26214400 end
      ),
      add constraint media_upload_reservations_alt_text_kind_check check (mime_type in ${IMAGE_TYPES} or alt_text is null);
  `.execute(db);
}

/**
 * Refuses while the library holds a document. Dimensions cannot be made required again with
 * documents in the table, and dropping their rows would leave cards in articles pointing at
 * nothing. The reservations made for documents go: without a document they account for
 * nothing.
 */
export async function down(db: Kysely<Database>): Promise<void> {
  const { rows } = await sql<{ documents: number }>`
    select count(*)::integer as documents from media_items where mime_type not in ${IMAGE_TYPES}
  `.execute(db);
  const documents = rows[0]?.documents ?? 0;
  if (documents) {
    throw new Error(`021_media_documents cannot be undone while the library holds ${documents} document${documents === 1 ? '' : 's'}. `
      + 'Delete them in the file library first.');
  }
  await sql`
    delete from media_upload_reservations where mime_type not in ${IMAGE_TYPES};

    alter table media_items
      drop constraint media_items_alt_text_kind_check,
      drop constraint media_items_dimensions_check,
      drop constraint media_items_size_check,
      drop constraint media_items_mime_type_check,
      alter column width set not null,
      alter column height set not null,
      add constraint media_items_mime_type_check check (mime_type in ${IMAGE_TYPES}),
      add constraint media_items_size_check check (size_bytes between 1 and 8388608),
      add constraint media_items_dimensions_check check (width between 1 and 100000 and height between 1 and 100000);

    alter table media_upload_reservations
      drop constraint media_upload_reservations_alt_text_kind_check,
      drop constraint media_upload_reservations_size_check,
      drop constraint media_upload_reservations_mime_type_check,
      add constraint media_upload_reservations_mime_type_check check (mime_type in ${IMAGE_TYPES}),
      add constraint media_upload_reservations_size_check check (expected_size_bytes between 1 and 8388608);
  `.execute(db);
}
