import type { Selectable, Transaction } from 'kysely';

import { SHOWN_HOME_SLIDES, slideStatus, type HomeSlidesMutation } from '../../lib/home-slides';
import { localePath, pagePath } from '../../lib/i18n';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import type { HomeSlide, HomeSlideMedia, PageLocale, PublicHomeSlide } from '../../types/cms';
import { db } from '../db/client';
import type { Database, HomeSlideTable } from '../db/types';
import { HttpError } from '../http/errors';
import { stableMediaPath } from '../media/url';
import { live } from './live';

function homeSlide(row: Selectable<HomeSlideTable>): HomeSlide {
  const { owner_id: _ownerId, ...slide } = row;
  return {
    ...slide,
    created_at: row.created_at.toISOString(),
    ends_at: row.ends_at?.toISOString() ?? null,
    starts_at: row.starts_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

async function lockOwner(trx: Transaction<Database>, ownerId: string): Promise<void> {
  const owner = await trx.selectFrom('user').select('id').where('id', '=', ownerId).forUpdate().executeTakeFirst();
  if (!owner) throw new HttpError(404, 'Owner not found.');
}

async function slideMedia(ownerId: string, ids: string[]): Promise<HomeSlideMedia[]> {
  if (!ids.length) return [];
  const rows = await db.selectFrom('media_items').select(['id', 'alt_text', 'width', 'height', 'size_bytes'])
    .where('owner_id', '=', ownerId).where('id', 'in', ids).execute();
  return rows.flatMap((row) => row.width && row.height ? [{
    alt_text: row.alt_text,
    height: row.height,
    id: row.id,
    publicUrl: stableMediaPath(row.id),
    size_bytes: Number(row.size_bytes),
    width: row.width,
  }] : []);
}

export async function listSlides(ownerId: string): Promise<{
  media: HomeSlideMedia[];
  pages: Array<{ id: string; locale: PageLocale; published_at: Date | null; status: string; title: string }>;
  slides: HomeSlide[];
}> {
  const [slides, pages] = await Promise.all([
    db.selectFrom('home_slides').selectAll().where('owner_id', '=', ownerId)
      .orderBy('locale').orderBy('position').execute(),
    db.selectFrom('pages').select(['id', 'locale', 'published_at', 'status', 'title'])
      .where('owner_id', '=', ownerId).orderBy('title').orderBy('id').execute(),
  ]);
  const media = await slideMedia(ownerId, [...new Set(slides.map((slide) => slide.media_id))]);
  return { media, pages, slides: slides.map(homeSlide) };
}

export async function replaceSlides(ownerId: string, input: HomeSlidesMutation): Promise<HomeSlide[]> {
  try {
    const rows = await db.transaction().execute(async (trx) => {
      await lockOwner(trx, ownerId);
      const mediaIds = [...new Set(input.slides.map((slide) => slide.mediaId))];
      const pictures = new Map((mediaIds.length ? await trx.selectFrom('media_items')
        .select(['id', 'alt_text', 'mime_type', 'width', 'height'])
        .where('owner_id', '=', ownerId).where('state', '=', 'ready').where('id', 'in', mediaIds)
        .forKeyShare().execute() : [])
        .filter((row) => row.mime_type.startsWith('image/') && row.width && row.height)
        .map((row) => [row.id, row]));
      for (const slide of input.slides) {
        const picture = pictures.get(slide.mediaId);
        if (!picture) throw new HttpError(400, 'Choose a picture from this site.');
        if (!slide.heading && !picture.alt_text?.trim()) {
          throw new HttpError(400, 'A slide without a heading needs a picture that says what it shows.');
        }
      }

      const pageIds = [...new Set(input.slides.flatMap((slide) => slide.button?.link.kind === 'page' ? [slide.button.link.pageId] : []))];
      if (pageIds.length) {
        const pages = await trx.selectFrom('pages').select('id')
          .where('owner_id', '=', ownerId).where('locale', '=', input.locale).where('id', 'in', pageIds)
          .forKeyShare().execute();
        if (pages.length !== pageIds.length) throw new HttpError(400, 'Choose Pages from this site and language.');
      }

      await trx.deleteFrom('home_slides').where('owner_id', '=', ownerId).where('locale', '=', input.locale).execute();
      if (!input.slides.length) return [];
      return trx.insertInto('home_slides').values(input.slides.map((slide, position) => {
        const link = slide.button?.link ?? null;
        return {
          align: slide.align,
          body: slide.body,
          button_label: slide.button?.label ?? null,
          enabled: slide.enabled,
          ends_at: slide.endsAt,
          focus: slide.focus,
          heading: slide.heading,
          link_kind: link?.kind ?? null,
          locale: input.locale,
          media_id: slide.mediaId,
          new_tab: link?.kind === 'custom' && link.newTab,
          overlay: slide.overlay,
          owner_id: ownerId,
          page_id: link?.kind === 'page' ? link.pageId : null,
          position,
          starts_at: slide.startsAt,
          url: link?.kind === 'custom' ? link.url : null,
        };
      })).returningAll().execute();
    });
    invalidatePublicSlidesCache();
    return rows.map(homeSlide);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (['22023', '22P02', '23503', '23514'].includes(postgresCode(error) ?? '')) throw new HttpError(400, 'Invalid slides.');
    throw error;
  }
}

export interface PublicSlidesSnapshot {
  lastModified: Date;
  slides: PublicHomeSlide[];
}

// ponytail: process-local like the menu's; replace it only when TomeCMS runs more than one app process.
const cache = new Map<PageLocale, { expiresAt: number; snapshot: PublicSlidesSnapshot }>();
let cacheGeneration = 0;

export function invalidatePublicSlidesCache(): void {
  cache.clear();
  cacheGeneration++;
}

async function queryPublicSlides(locale: PageLocale, now: Date): Promise<PublicSlidesSnapshot> {
  const settings = await db.selectFrom('site_settings').select(['owner_id', 'updated_at'])
    .where('id', '=', true).executeTakeFirst();
  if (!settings) return { lastModified: new Date(0), slides: [] };
  const rows = await db.selectFrom('home_slides')
    .innerJoin('media_items', (join) => join
      .onRef('media_items.id', '=', 'home_slides.media_id')
      .onRef('media_items.owner_id', '=', 'home_slides.owner_id'))
    .selectAll('home_slides')
    .select(['media_items.alt_text as media_alt', 'media_items.width as media_width', 'media_items.height as media_height', 'media_items.state as media_state'])
    .where('home_slides.owner_id', '=', settings.owner_id).where('home_slides.locale', '=', locale)
    .orderBy('home_slides.position').execute();

  const shown = rows.filter((row) => row.media_state === 'ready' && row.media_width && row.media_height
    && (row.heading || row.media_alt?.trim())
    && slideStatus({ enabled: row.enabled, endsAt: row.ends_at?.toISOString() ?? null, startsAt: row.starts_at?.toISOString() ?? null }, now) === 'live')
    .slice(0, SHOWN_HOME_SLIDES);

  let modified = settings.updated_at.getTime();
  for (const row of rows) {
    modified = Math.max(modified, row.updated_at.getTime());
    // A start or an end that has passed changed what is live without writing a row.
    for (const edge of [row.starts_at, row.ends_at]) {
      if (edge && edge.getTime() <= now.getTime()) modified = Math.max(modified, edge.getTime());
    }
  }

  const pageIds = [...new Set(shown.flatMap((row) => row.link_kind === 'page' && row.page_id ? [row.page_id] : []))];
  const pageUrls = new Map<string, string>();
  if (pageIds.length) {
    const pages = await db.selectFrom('pages').select(['id', 'slug', 'updated_at'])
      .where('owner_id', '=', settings.owner_id).where('locale', '=', locale).where(live('pages'))
      .where('id', 'in', pageIds).execute();
    for (const page of pages) {
      pageUrls.set(page.id, pagePath({ locale, slug: page.slug }));
      modified = Math.max(modified, page.updated_at.getTime());
    }
  }

  const slides = shown.map((row): PublicHomeSlide => {
    const href = row.link_kind === 'home' ? localePath(locale)
      : row.link_kind === 'page' ? pageUrls.get(row.page_id ?? '')
        : row.link_kind === 'custom' ? normalizeNavigationUrl(row.url ?? '') || undefined : undefined;
    return {
      align: row.align,
      body: row.body,
      button: row.button_label && href ? { href, label: row.button_label, newTab: row.link_kind === 'custom' && row.new_tab } : null,
      focus: row.focus,
      heading: row.heading,
      image: { alt: row.heading ? '' : row.media_alt ?? '', height: row.media_height!, src: stableMediaPath(row.media_id), width: row.media_width! },
      overlay: row.overlay,
    };
  });
  return { lastModified: new Date(modified), slides };
}

export async function getPublicSlidesSnapshot(locale: PageLocale): Promise<PublicSlidesSnapshot> {
  const cached = cache.get(locale);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  const generation = cacheGeneration;
  const snapshot = await queryPublicSlides(locale, new Date());
  if (generation === cacheGeneration) cache.set(locale, { expiresAt: Date.now() + 5_000, snapshot });
  return snapshot;
}

/** Never the reason a home page fails: a read that goes wrong is a hero without slides. */
export async function getPublicSlides(locale: PageLocale): Promise<PublicHomeSlide[]> {
  try {
    return (await getPublicSlidesSnapshot(locale)).slides;
  } catch (error) {
    console.error('Public slides query failed:', error);
    return [];
  }
}
