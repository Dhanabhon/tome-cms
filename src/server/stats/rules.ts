import { BlockList, isIP } from 'node:net';

import { z } from 'zod';

/**
 * What a reader's page may say about itself, and nothing more.
 *
 * An article is counted by its edition's id, and the home page has none. The home page has no
 * end, so it is never read. Anything else is a request no page of this site makes.
 */
export const hitSchema = z.object({
  event: z.enum(['view', 'read']),
  id: z.uuid().optional(),
  kind: z.enum(['home', 'post', 'page']),
  locale: z.enum(['th', 'en']),
  referrer: z.string().max(2_048).optional(),
  width: z.int().min(1).max(20_000),
})
  .refine((hit) => (hit.kind === 'home') === (hit.id === undefined))
  .refine((hit) => hit.kind !== 'home' || hit.event === 'view');

export type Hit = z.infer<typeof hitSchema>;

const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Where a reader came from, as the one thing kept of it: the host, lower case and without
 * `www.`. This site is `internal`, and no referrer -- or one that is not a web address -- is ''.
 */
export function referrerHost(referrer: string | undefined, siteHost: string): string {
  if (!referrer || !URL.canParse(referrer)) return '';
  const url = new URL(referrer);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  const host = url.hostname.replace(/^www\./, '');
  if (host.length > 253 || !HOST.test(host)) return '';
  return host === siteHost.toLowerCase().replace(/^www\./, '') ? 'internal' : host;
}

export const MOBILE_BELOW = 768;

export function deviceOf(width: number): 'desktop' | 'mobile' {
  return width < MOBILE_BELOW ? 'mobile' : 'desktop';
}

// ponytail: the fetchers that say what they are. One that pretends to be a browser is counted,
// which is why the numbers are called estimates.
const BOT = /bot\b|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse/i;

export function isBot(userAgent: string | null): boolean {
  return !userAgent?.trim() || BOT.test(userAgent);
}

/** The calendar day it is at the site, as YYYY-MM-DD. */
export function statsDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { day: '2-digit', month: '2-digit', timeZone, year: 'numeric' })
    .formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// Where the owner's reverse proxy connects from. The app is published on 127.0.0.1 only, so on
// a bare install that is loopback, and in the managed install it is Docker's bridge gateway.
const PROXY_SIDE = new BlockList();
PROXY_SIDE.addSubnet('127.0.0.0', 8, 'ipv4');
PROXY_SIDE.addSubnet('10.0.0.0', 8, 'ipv4');
PROXY_SIDE.addSubnet('172.16.0.0', 12, 'ipv4');
PROXY_SIDE.addSubnet('192.168.0.0', 16, 'ipv4');
PROXY_SIDE.addAddress('::1', 'ipv6');
PROXY_SIDE.addSubnet('fc00::', 7, 'ipv6');

function fromProxySide(address: string): boolean {
  const plain = address.startsWith('::ffff:') ? address.slice(7) : address;
  const family = isIP(plain);
  return family !== 0 && PROXY_SIDE.check(plain, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Who sent a request, as far as the app can know.
 *
 * Only the owner's proxy can reach the app from its side, and it adds the address it saw as the
 * last entry of X-Forwarded-For. Anything earlier in the header is whatever the sender wrote.
 * From anywhere else the header is the sender's own words and is ignored.
 */
export function readerAddress(request: Request, clientAddress: string): string {
  if (!fromProxySide(clientAddress)) return clientAddress;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';
  return isIP(forwarded) ? forwarded : clientAddress;
}

export interface RateLimit {
  allow(address: string, now?: number): boolean;
  readonly size: number;
}

/**
 * At most `limit` hits from one address in `windowMs`.
 *
 * ponytail: one process's memory. TomeCMS runs one application process; a second would keep a
 * limit of its own. When the cap is reached the oldest address is forgotten, which lets it start
 * again early -- the price of never growing past the cap however many addresses write.
 */
export function createRateLimit({ capacity, limit, windowMs }: { capacity: number; limit: number; windowMs: number }): RateLimit {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    allow(address, now = Date.now()) {
      const current = windows.get(address);
      if (current && current.resetAt > now) {
        windows.set(address, { ...current, count: current.count + 1 });
        return current.count < limit;
      }
      if (!current && windows.size >= capacity) {
        const oldest = windows.keys().next().value;
        if (oldest !== undefined) windows.delete(oldest);
      }
      windows.set(address, { count: 1, resetAt: now + windowMs });
      return true;
    },
    get size() {
      return windows.size;
    },
  };
}
