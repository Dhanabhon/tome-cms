import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Insertable, Selectable } from 'kysely';

import { db } from '../db/client';
import type { MediaItemTable, MediaVariantTable } from '../db/types';
import { makeVariants } from './image';
import { createObjectKey } from './keys';
import { s3, s3Bucket } from './storage';

const IMMUTABLE = 'public, max-age=31536000, immutable';

export type VariantSource = Pick<Selectable<MediaItemTable>, 'id' | 'object_key' | 'owner_id'>;

/**
 * Makes an image's smaller copies and keeps them: the objects first, then their rows, written
 * only while the image is still ready. Any failure throws, and takes back the objects it stored.
 */
export async function storeVariants(media: VariantSource, body: Buffer): Promise<number> {
  const variants = await makeVariants(body);
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

async function readOriginal(key: string): Promise<Buffer> {
  const object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
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
    await storeVariants(media, held ?? await readOriginal(media.object_key));
  }).catch(() => {
    console.error('Image variants could not be made.', { mediaId: media.id });
  });
}

/** Settles once everything queued so far is done; for tests, which need the copies made. */
export function variantsIdle(): Promise<void> {
  return queue.then(() => undefined);
}
