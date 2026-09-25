import { MAX_VIDEO_TITLE, videoOembedUrl, type VideoLink } from '../../lib/video-link';
import { detectImageType } from '../media/image';

/** The only hosts a lookup reaches: the two oEmbed endpoints and the two hosts their posters live on. */
const HOSTS = new Set(['www.youtube.com', 'vimeo.com', 'i.ytimg.com', 'i.vimeocdn.com']);
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 2 * 1024 * 1024;
const POSTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type VideoLookupReason = 'unavailable' | 'unreachable';

export interface VideoLookup {
  title: string;
  poster: Buffer | null;
  reason: VideoLookupReason | null;
}

/** The provider said no, or said something that is not a title and a poster. */
class Unavailable extends Error {}
/** No answer in time. */
class Unreachable extends Error {}

/**
 * Asks the provider for a clip's title and poster. It never throws: whatever falls short comes back
 * as a reason, and the clip is still usable without a title or a poster.
 */
export async function lookUpVideo(clip: VideoLink, fetcher: typeof fetch = fetch, timeoutMs = TIMEOUT_MS): Promise<VideoLookup> {
  const signal = AbortSignal.timeout(timeoutMs);
  let title = '';
  try {
    let answer: unknown;
    try {
      answer = JSON.parse((await get(videoOembedUrl(clip), fetcher, signal)).toString('utf8'));
    } catch (error) {
      throw error instanceof SyntaxError ? new Unavailable('The oEmbed answer is not JSON.') : error;
    }
    const { thumbnail_url: thumbnail, title: found } = (answer ?? {}) as Record<string, unknown>;
    title = typeof found === 'string' ? found.replace(/\p{Cc}/gu, '').trim().slice(0, MAX_VIDEO_TITLE).trim() : '';
    if (typeof thumbnail !== 'string') return { poster: null, reason: 'unavailable', title };
    const poster = await get(thumbnail, fetcher, signal);
    const type = detectImageType(poster);
    if (!type || !POSTER_TYPES.has(type)) return { poster: null, reason: 'unavailable', title };
    return { poster, reason: null, title };
  } catch (error) {
    return { poster: null, reason: error instanceof Unreachable ? 'unreachable' : 'unavailable', title };
  }
}

async function get(address: string, fetcher: typeof fetch, signal: AbortSignal): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Unavailable('Not an address.');
  }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port !== '' || url.username !== '' || url.password !== '') {
    throw new Unavailable(`Refused host ${url.hostname}.`);
  }
  let response: Response;
  try {
    response = await fetcher(url, { redirect: 'error', signal });
  } catch {
    throw new Unreachable(`No answer from ${url.hostname}.`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Unavailable(`${url.hostname} answered ${response.status}.`);
  }
  return boundedBytes(response);
}

async function boundedBytes(response: Response): Promise<Buffer> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Unavailable('Too large.');
  }
  if (!response.body) throw new Unavailable('No body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await reader.read();
      } catch {
        throw new Unreachable('The answer stopped.');
      }
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Unavailable('Too large.');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
