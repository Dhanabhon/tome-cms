/**
 * A YouTube or Vimeo clip, read from a link a writer pastes, and every address the site writes for
 * it. Nothing here imports the editor, so a reader's page can use it without loading Tiptap.
 */
export type VideoProvider = 'youtube' | 'vimeo';

export interface VideoLink {
  provider: VideoProvider;
  videoId: string;
  /** Seconds into the clip to start at, or null. */
  start: number | null;
}

export const VIDEO_PROVIDER_NAMES: Record<VideoProvider, string> = { vimeo: 'Vimeo', youtube: 'YouTube' };
export const MAX_VIDEO_TITLE = 200;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const MAX_START = 24 * 60 * 60;

export function isVideoId(provider: VideoProvider, id: string): boolean {
  return provider === 'youtube' ? YOUTUBE_ID.test(id) : VIMEO_ID.test(id);
}

/** `90`, `90s`, `1m30s` or `1h2m3s` as whole seconds; anything else, or zero, is no start. */
export function startSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 && seconds <= MAX_START ? seconds : null;
}

/** The clip a link points at, or null for anything that is not one YouTube or Vimeo clip. */
export function parseVideoLink(text: string): VideoLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) return youtube(url, host);
  if (VIMEO_HOSTS.has(host)) return vimeo(url, host);
  return null;
}

function youtube(url: URL, host: string): VideoLink | null {
  const path = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (host === 'youtu.be') id = path.length === 1 ? path[0] : undefined;
  else if (path.length === 1 && path[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
  else if (path.length === 2 && (path[0] === 'shorts' || path[0] === 'embed')) id = path[1];
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { provider: 'youtube', start: startSeconds(url.searchParams.get('t') ?? url.searchParams.get('start')), videoId: id };
}

function vimeo(url: URL, host: string): VideoLink | null {
  const path = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (host === 'player.vimeo.com') id = path.length === 2 && path[0] === 'video' ? path[1] : undefined;
  else if (path.length === 1) id = path[0];
  else if (path.length === 3 && path[0] === 'channels') id = path[2];
  if (!id || !VIMEO_ID.test(id)) return null;
  return { provider: 'vimeo', start: startSeconds(/^#t=(.+)$/.exec(url.hash)?.[1]), videoId: id };
}

/** The clip's own page: where the link goes when no script plays it in place. */
export function videoWatchUrl({ provider, start, videoId }: VideoLink): string {
  if (provider === 'youtube') return `https://www.youtube.com/watch?v=${videoId}${start ? `&t=${start}` : ''}`;
  return `https://vimeo.com/${videoId}${start ? `#t=${start}s` : ''}`;
}

/** The player, loaded only after a reader presses play: YouTube's no-cookie host, Vimeo's do-not-track mode. */
export function videoPlayerUrl({ provider, start, videoId }: VideoLink): string {
  if (provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1${start ? `&start=${start}` : ''}`;
  return `https://player.vimeo.com/video/${videoId}?dnt=1&autoplay=1${start ? `#t=${start}s` : ''}`;
}

/** Where the provider tells the server a clip's title and poster. */
export function videoOembedUrl({ provider, videoId }: VideoLink): string {
  const page = videoWatchUrl({ provider, start: null, videoId });
  return provider === 'youtube'
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(page)}`;
}
