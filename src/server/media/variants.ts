import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Insertable, Selectable } from 'kysely';

import { ACCEPTED_IMAGE_TYPES, type SupportedImageType } from '../../lib/media';
import { db } from '../db/client';
import type { MediaItemTable, MediaVariantTable } from '../db/types';
import { inspectImage, makeVariants } from './image';
import { createObjectKey } from './keys';
import { isNotFound, s3, s3Bucket, storageErrorCode } from './storage';

const IMMUTABLE = 'public, max-age=31536000, immutable';

export type VariantSource = Pick<Selectable<MediaItemTable>, 'id' | 'object_key' | 'owner_id'>;

/**
 * Makes an image's smaller copies and keeps them: the objects first, then their rows, written
 * only while the image is still ready. Any failure throws, and takes back the objects it stored.
 */
export async function storeVariants(media: VariantSource, body: Buffer): Promise<number> {
  return keepVariants(media, await makeVariants(body));
}

async function keepVariants(media: VariantSource, variants: Awaited<ReturnType<typeof makeVariants>>): Promise<number> {
  if (!variants.length) return 0;
  const rows: Insertable<MediaVariantTable>[] = [];
  try {
    for (const variant of variants) {
      const key = createObjectKey(media.owner_id, 'image/webp');
      rows.push({ media_id: media.id, object_key: key, size_bytes: variant.body.length, width: variant.width });
      await s3.send(new PutObjectCommand({
        Body: variant.body, Bucket: s3Bucket, CacheControl: IMMUTABLE, ContentType: 'image/webp', Key: key,
      }));
    }
    // The share lock waits for a delete that started first, and holds off one that starts now,
    // so a delete always sees the rows it has to take the objects of.
    await db.transaction().execute(async (trx) => {
      const item = await trx.selectFrom('media_items').select('state').where('id', '=', media.id).forShare().executeTakeFirst();
      if (item?.state !== 'ready') throw new Error('The image is no longer in the library.');
      await trx.insertInto('media_variants').values(rows).execute();
    });
    return rows.length;
  } catch (error) {
    await Promise.allSettled(rows.map(({ object_key: key }) => s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }))));
    throw error;
  }
}

let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

/** Runs `job` once every job queued before it has finished: one image's work at a time, process-wide. */
export function serially<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

/** The original's bytes, or null once it is gone: an image deleted before its turn has nothing to do. */
async function readOriginal(key: string): Promise<Buffer | null> {
  let object;
  try {
    object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  if (!object.Body || !(Symbol.asyncIterator in object.Body)) throw new Error('Object body is unavailable.');
  const chunks: Uint8Array[] = [];
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Queues the copies of an image already in the library, and returns at once: the upload is
 * answered without them, and a failure is logged, never thrown. Only one image's bytes wait in
 * memory; any queued behind it are read back from storage when their turn comes, so a batch of
 * uploads does not pile up 8 MB each.
 */
export function queueVariants(media: VariantSource, body: Buffer): void {
  const held = waiting === 0 ? body : null;
  waiting += 1;
  void serially(async () => {
    waiting -= 1;
    const bytes = held ?? await readOriginal(media.object_key);
    if (bytes) await storeVariants(media, bytes);
  }).catch((error: unknown) => {
    console.error('Image variants could not be made.', { mediaId: media.id, error: storageErrorCode(error) });
  });
}

/** Settles once everything queued so far is done; for tests, which need the copies made. */
export function variantsIdle(): Promise<void> {
  return queue.then(() => undefined);
}

const BACKFILL_DONE = 'media_variants_backfill';

interface BackfillCounts { corrected: number; gone: number; made: number; none: number; unreadable: number }

/**
 * Gives the images kept before 1.20.0 their copies: oldest first, one at a time between any
 * uploads, each read back from storage. A photo taken on its side was measured from its raw
 * pixels then, so it is measured again the way it is seen. A picture that cannot be read is
 * passed over; anything else stops the walk, and the next start begins it again. Once it has
 * walked the whole library it says so in app_metadata, and no start reads the library again.
 */
export async function backfillVariants(): Promise<void> {
  const counts: BackfillCounts = { corrected: 0, gone: 0, made: 0, none: 0, unreadable: 0 };
  try {
    if (await db.selectFrom('app_metadata').select('key').where('key', '=', BACKFILL_DONE).executeTakeFirst()) return;
    const candidates = await waitingImages().select('id').orderBy('created_at').orderBy('id').execute();
    for (const { id } of candidates) await serially(() => backfillImage(id, counts));
    await db.insertInto('app_metadata').values({ key: BACKFILL_DONE, value: 'done' })
      .onConflict((conflict) => conflict.column('key').doNothing()).execute();
    console.info('Older images were given their smaller copies.', counts);
  } catch (error) {
    console.error('Older images stopped getting their smaller copies; the next start tries again.', { ...counts, error: storageErrorCode(error) });
  }
}

/** Ready images with no copies yet. */
function waitingImages() {
  return db.selectFrom('media_items')
    .where('state', '=', 'ready')
    .where('mime_type', 'in', ACCEPTED_IMAGE_TYPES)
    .where(({ exists, not, selectFrom }) => not(exists(selectFrom('media_variants').select('media_id')
      .whereRef('media_variants.media_id', '=', 'media_items.id'))));
}

async function backfillImage(id: string, counts: BackfillCounts): Promise<void> {
  // Asked again in its turn: it may have been deleted, or given its copies by an upload, since.
  const item = await waitingImages().select(['id', 'object_key', 'owner_id', 'mime_type', 'width', 'height'])
    .where('id', '=', id).executeTakeFirst();
  if (!item) return;
  const body = await readOriginal(item.object_key);
  if (!body) {
    counts.gone += 1;
    return;
  }
  let size, variants;
  try {
    size = await inspectImage(body, item.mime_type as SupportedImageType);
    variants = await makeVariants(body);
  } catch {
    counts.unreadable += 1;
    return;
  }
  if (size.width !== item.width || size.height !== item.height) {
    await db.updateTable('media_items').set({ height: size.height, width: size.width })
      .where('id', '=', item.id).where('state', '=', 'ready').execute();
    counts.corrected += 1;
  }
  if (await keepVariants(item, variants)) counts.made += 1;
  else counts.none += 1;
}
