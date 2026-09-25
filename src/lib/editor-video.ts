import { Node } from '@tiptap/core';

import { isVideoId, MAX_VIDEO_TITLE, parseVideoLink, VIDEO_PROVIDER_NAMES, videoWatchUrl, type VideoLink } from './video-link';

/** A stored video. `mediaId` is the poster, named as a picture's is so the library sees it in use. */
export interface VideoAttrs extends VideoLink {
  title: string;
  mediaId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_PATH = /^\/media\/([0-9a-f-]{36})$/i;
const MAX_START = 24 * 60 * 60;

/** The attributes a stored video may have, or null. Anything else on the node is dropped. */
export function videoAttrs(value: unknown): VideoAttrs | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const { mediaId, provider, start, title, videoId } = obj;
  const keys = new Set(Object.keys(obj));
  keys.delete('mediaId');
  keys.delete('provider');
  keys.delete('start');
  keys.delete('title');
  keys.delete('videoId');
  if (keys.size > 0) return null;
  if (provider !== 'youtube' && provider !== 'vimeo') return null;
  if (typeof videoId !== 'string' || !isVideoId(provider, videoId)) return null;
  if (start !== null && start !== undefined
    && !(typeof start === 'number' && Number.isInteger(start) && start > 0 && start <= MAX_START)) return null;
  if (typeof title !== 'string' || title.length > MAX_VIDEO_TITLE) return null;
  if (mediaId !== null && mediaId !== undefined && (typeof mediaId !== 'string' || !UUID.test(mediaId))) return null;
  return {
    mediaId: typeof mediaId === 'string' ? mediaId.toLowerCase() : null,
    provider,
    start: typeof start === 'number' ? start : null,
    title: title.trim(),
    videoId,
  };
}

export interface VideoTree {
  type?: string;
  content?: VideoTree[];
}

/** Whether a document holds a video: a page with one loads the small script that plays it. */
export function documentHasVideo(node: VideoTree): boolean {
  return node.type === 'video' || (node.content ?? []).some(documentHasVideo);
}

export const video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    // Read from the figure as a whole by the rule below, as the attachment card is.
    return {
      mediaId: { default: null, rendered: false, parseHTML: () => null },
      provider: { default: 'youtube', rendered: false, parseHTML: () => null },
      start: { default: null, rendered: false, parseHTML: () => null },
      title: { default: '', rendered: false, parseHTML: () => null },
      videoId: { default: '', rendered: false, parseHTML: () => null },
    };
  },

  parseHTML() {
    return [{
      tag: 'figure.tome-video',
      priority: 51,
      getAttrs: (element) => {
        const clip = parseVideoLink(element.querySelector('a.tome-video__play')?.getAttribute('href') ?? '');
        if (!clip) return false;
        const text = (element.querySelector('.tome-video__title')?.textContent ?? '').trim().slice(0, MAX_VIDEO_TITLE);
        return {
          ...clip,
          mediaId: MEDIA_PATH.exec(element.querySelector('img')?.getAttribute('src') ?? '')?.[1]?.toLowerCase() ?? null,
          // With no title the span holds the provider's name, which is not a title.
          title: text === VIDEO_PROVIDER_NAMES[clip.provider] ? '' : text,
        };
      },
    }];
  },

  renderHTML({ node }) {
    const attrs = node.attrs as VideoAttrs;
    const name = VIDEO_PROVIDER_NAMES[attrs.provider];
    const poster = attrs.mediaId ? [['img', { alt: '', src: `/media/${attrs.mediaId}` }]] : [];
    return ['figure', { class: 'tome-video' },
      ['a', { class: 'tome-video__play', href: videoWatchUrl(attrs) },
        ...poster,
        ['span', { class: 'tome-video__title' }, attrs.title || name]],
      ['figcaption', {}, attrs.title ? `${attrs.title} · ${name}` : name]];
  },
});
