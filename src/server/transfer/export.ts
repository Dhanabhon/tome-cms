import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Selectable, Transaction } from 'kysely';

import type { EditorDocument, EditorMark, EditorNode } from '../../types/cms';
import type { Database, MediaItemTable, PageTable, PostTable } from '../db/types';
import { isTomeObjectKey, isUuid } from '../media/keys';
import { getBuildInfo } from '../update/current';
import {
  ARCHIVE_FORMAT, itemPath, mediaLink, mediaPath, writeFrontMatter, type ArchiveManifest, type FrontMatter,
} from './archive-format';
import { documentToReadableMarkdown } from './readable-markdown';

/*
 * `tome export` inside the app image: every post and page, in every language and status, as a
 * readable `.md` and an exact `.tome.json`, with the library files they use. The database client
 * and the bucket read the environment when they load, so each is imported only when this runs.
 */

export interface ExportReceipt {
  counts: ArchiveManifest['counts'];
  /** How many items carry formatting their `.md` cannot show; their `.tome.json` keeps it. */
  formattingNotShown: number;
}

type Post = Selectable<PostTable>;
type Page = Selectable<PageTable>;
type Media = Pick<Selectable<MediaItemTable>, 'id' | 'object_key'>;

interface Site {
  posts: Post[];
  pages: Page[];
  categories: Map<string, string[]>;
  media: Map<string, Media>;
}

/** Each library file an item uses: in its document, by node or mark, and its cover. */
function mediaIds(document: EditorDocument, ids: Set<string>): void {
  const pending: EditorNode[] = [document];
  for (let node = pending.pop(); node; node = pending.pop()) {
    for (const holder of [node, ...(node.marks ?? [])]) {
      const id = holder.attrs?.mediaId;
      if (typeof id === 'string' && isUuid(id)) ids.add(id);
    }
    pending.push(...(node.content ?? []));
  }
}

/** One snapshot of the site: every row the archive holds, read in a single REPEATABLE READ transaction. */
async function readSite(trx: Transaction<Database>): Promise<Site> {
  const settings = await trx.selectFrom('site_settings').select('owner_id').where('id', '=', true).executeTakeFirst();
  if (!settings) throw new Error('The site is not installed.');
  const posts = await trx.selectFrom('posts').selectAll().orderBy('id').execute();
  const pages = await trx.selectFrom('pages').selectAll().orderBy('id').execute();
  const assigned = await trx.selectFrom('post_category_assignments')
    .innerJoin('categories', 'categories.id', 'post_category_assignments.category_id')
    .select(['post_category_assignments.translation_group_id as group', 'categories.name'])
    .orderBy('categories.name').execute();
  const categories = new Map<string, string[]>();
  for (const { group, name } of assigned) categories.set(group, [...categories.get(group) ?? [], name]);

  const ids = new Set<string>();
  for (const post of posts) {
    mediaIds(post.content_json, ids);
    if (post.cover_media_id) ids.add(post.cover_media_id);
  }
  for (const page of pages) mediaIds(page.content_json, ids);
  // listReadyMediaByIds's query, read through this transaction: the global client is not free.
  const rows = ids.size ? await trx.selectFrom('media_items').select(['id', 'object_key'])
    .where('owner_id', '=', settings.owner_id).where('state', '=', 'ready').where('id', 'in', [...ids])
    .orderBy('id').execute() : [];
  for (const { object_key: key } of rows) if (!isTomeObjectKey(key)) throw new Error('A media item has an unsupported object key.');
  return { posts, pages, categories, media: new Map(rows.map((row) => [row.id, row])) };
}

/** The exact document, with each library file's address pointing into the archive instead. */
function relinked(document: EditorDocument, link: (mediaId: string) => string | null): EditorDocument {
  const relink = <T extends EditorNode | EditorMark>(holder: T): T => {
    const attrs = holder.attrs;
    const address = typeof attrs?.mediaId === 'string' ? link(attrs.mediaId) : null;
    if (!attrs || !address) return holder;
    const key = 'src' in attrs ? 'src' : 'href' in attrs ? 'href' : null;
    return key ? { ...holder, attrs: { ...attrs, [key]: address } } : holder;
  };
  const visit = (node: EditorNode): EditorNode => ({
    ...relink(node),
    ...(node.marks ? { marks: node.marks.map(relink) } : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
  });
  return { ...visit(document), type: 'doc' };
}

async function writeNew(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, data, { flag: 'wx', mode: 0o600 });
}

export async function exportSite(outDir: string): Promise<ExportReceipt> {
  const { db } = await import('../db/client');
  const { getServerEnv } = await import('../env');
  const { s3, s3Bucket } = await import('../media/storage');
  const site = await db.transaction().setIsolationLevel('repeatable read').execute(readSite);
  const link = (mediaId: string) => {
    const media = site.media.get(mediaId);
    return media ? mediaLink(media.object_key) : null;
  };

  let formattingNotShown = 0;
  const items = [
    ...site.posts.map((post) => ({ kind: 'post' as const, row: post as Post | Page, post })),
    ...site.pages.map((page) => ({ kind: 'page' as const, row: page as Post | Page, post: null })),
  ];
  for (const { kind, row, post } of items) {
    const cover = post?.cover_media_id ? link(post.cover_media_id) : null;
    const frontMatter: FrontMatter = {
      title: row.title,
      slug: row.slug,
      language: row.locale,
      status: row.status,
      ...(row.published_at ? { published: row.published_at.toISOString() } : {}),
      ...(row.planned_at ? { planned: row.planned_at.toISOString() } : {}),
      updated: row.updated_at.toISOString(),
      ...(post ? { categories: site.categories.get(post.translation_group_id) ?? [] } : {}),
      excerpt: row.excerpt,
      ...(cover ? { cover } : {}),
      ...(post ? { show_cover: post.show_cover } : {}),
      ...(row.meta_title !== null ? { meta_title: row.meta_title } : {}),
      ...(row.meta_description !== null ? { meta_description: row.meta_description } : {}),
      translation: row.translation_group_id,
    };
    const readable = documentToReadableMarkdown(row.content_json, link);
    if (readable.formattingNotShown) formattingNotShown += 1;
    await writeNew(join(outDir, itemPath(kind, row.locale, row.slug, '.md')), `${writeFrontMatter(frontMatter)}\n${readable.markdown}\n`);
    await writeNew(join(outDir, itemPath(kind, row.locale, row.slug, '.tome.json')), `${JSON.stringify(relinked(row.content_json, link), null, 2)}\n`);
  }

  for (const { object_key: key } of site.media.values()) {
    const path = join(outDir, ...mediaPath(key).split('/'));
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
    if (!object.Body) throw new Error('A media object could not be read.');
    await pipeline(object.Body as Readable, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
  }

  const counts = { posts: site.posts.length, pages: site.pages.length, media: site.media.size };
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    applicationVersion: getBuildInfo().version,
    publicUrl: getServerEnv().TOME_CMS_PUBLIC_URL,
    counts,
  };
  // Last, so a directory with a manifest is a whole export.
  await writeNew(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { counts, formattingNotShown };
}
