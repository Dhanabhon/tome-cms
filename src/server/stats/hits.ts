import { getPublicSiteUrl } from '../../lib/seo';
import { live } from '../content/live';
import { getSiteSettings } from '../content/settings';
import { db } from '../db/client';
import { readerCountry } from './country';
import { createRateLimit, deviceOf, hitSchema, isBot, readerAddress, referrerHost, statsDay, type Hit } from './rules';

const MAX_BODY_BYTES = 1_024;
const LIVE_FOR_MS = 5 * 60_000;
const LIVE_CAPACITY = 10_000;

const limit = createRateLimit({ capacity: 10_000, limit: 120, windowMs: 10 * 60_000 });
// ponytail: one process's memory, like the limit. Cleared whole when full, so made-up ids cost a
// query each and never grow it past its cap.
const liveIds = new Map<string, { expiresAt: number; live: boolean }>();

export interface StatsRow {
  contentId: string | null;
  country: string;
  day: string;
  device: 'desktop' | 'mobile';
  kind: 'home' | 'page' | 'post';
  locale: 'en' | 'th';
  ownerId: string;
  referrer: string;
}

/** Adds one to a day's counter. Atomic however many arrive at once: the row is the lock. */
export async function countHit(row: StatsRow, event: 'read' | 'view'): Promise<void> {
  await db.insertInto('content_stats_daily').values({
    content_id: row.contentId,
    country: row.country,
    day: row.day,
    device: row.device,
    kind: row.kind,
    locale: row.locale,
    owner_id: row.ownerId,
    reads: event === 'read' ? 1 : 0,
    referrer: row.referrer,
    views: event === 'view' ? 1 : 0,
  }).onConflict((conflict) => conflict.constraint('content_stats_daily_key').doUpdateSet((eb) => ({
    reads: eb('content_stats_daily.reads', '+', eb.ref('excluded.reads')),
    views: eb('content_stats_daily.views', '+', eb.ref('excluded.views')),
  }))).execute();
}

/** Whether a hit names something a reader could be reading: live, this owner's, in that language. */
async function isLive(ownerId: string, hit: Hit): Promise<boolean> {
  if (hit.kind === 'home') return true;
  if (!hit.id) return false;
  const key = `${hit.kind}:${hit.id}:${hit.locale}`;
  const cached = liveIds.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.live;
  const table = hit.kind === 'post' ? 'posts' : 'pages';
  const row = await db.selectFrom(table).select('id')
    .where('owner_id', '=', ownerId).where('id', '=', hit.id).where('locale', '=', hit.locale).where(live(table))
    .executeTakeFirst();
  if (liveIds.size >= LIVE_CAPACITY) liveIds.clear();
  liveIds.set(key, { expiresAt: Date.now() + LIVE_FOR_MS, live: row !== undefined });
  return row !== undefined;
}

/** Bundled mode takes hits from this site only: its Origin, or a same-origin request that sent none. */
function fromThisSite(request: Request, origin: string): boolean {
  const from = request.headers.get('origin');
  return from ? from === origin : request.headers.get('sec-fetch-site') === 'same-origin';
}

/** The body, or null past the limit -- read as a stream, so a large one is never held whole. */
async function smallBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Counts one hit, or says why it did not.
 *
 * The reason is for the server's log and nothing else: the endpoint answers 204 either way, so
 * someone inflating the numbers learns nothing about which of their requests counted.
 */
export async function receiveHit(
  request: Request,
  clientAddress: string,
  options: { headless: boolean; now?: Date },
): Promise<string | null> {
  const site = getPublicSiteUrl(request);
  if (!options.headless && !fromThisSite(request, site.origin)) return 'cross-origin';
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return 'not-json';
  const text = await smallBody(request);
  if (text === null) return 'too-large';
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return 'not-json';
  }
  const parsed = hitSchema.safeParse(body);
  if (!parsed.success) return 'invalid';
  const hit = parsed.data;

  const settings = await getSiteSettings();
  if (!settings) return 'not-installed';
  if (!await isLive(settings.owner_id, hit)) return 'not-live';
  // A headless site's own pages are its own origin, not the CMS's.
  const origin = request.headers.get('origin');
  const home = origin && URL.canParse(origin) ? new URL(origin).hostname : site.hostname;
  const referrer = referrerHost(hit.referrer, home);
  if (isBot(request.headers.get('user-agent'))) return 'bot';
  const address = readerAddress(request, clientAddress);
  if (!limit.allow(address)) return 'rate-limited';

  await countHit({
    contentId: hit.id ?? null,
    country: readerCountry(request.headers, address),
    day: statsDay(options.now ?? new Date(), settings.timezone),
    device: deviceOf(hit.width),
    kind: hit.kind,
    locale: hit.locale,
    ownerId: settings.owner_id,
    referrer,
  }, hit.event);
  return null;
}
