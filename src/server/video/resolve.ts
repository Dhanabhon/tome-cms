import { parseVideoLink, VIDEO_PROVIDER_NAMES, type VideoLink } from '../../lib/video-link';
import { HttpError } from '../http/errors';
import { importImage } from '../media/service';
import { lookUpVideo, type VideoLookup, type VideoLookupReason } from './lookup';

export interface ResolvedVideo extends VideoLink {
  title: string;
  mediaId: string | null;
  reason: VideoLookupReason | null;
}

/** A pasted link, as the clip it names, with its title and its poster kept in the library. */
export async function resolveVideo(
  ownerId: string,
  link: string,
  lookUp: (clip: VideoLink) => Promise<VideoLookup> = lookUpVideo,
): Promise<ResolvedVideo> {
  const clip = parseVideoLink(link);
  if (!clip) throw new HttpError(400, 'Use a YouTube or Vimeo link to one clip.', { code: 'video_link' });
  const found = await lookUp(clip);
  let mediaId: string | null = null;
  let reason = found.reason;
  if (found.poster) {
    try {
      mediaId = (await importImage(ownerId, found.poster, found.title || `${VIDEO_PROVIDER_NAMES[clip.provider]} ${clip.videoId}`)).id;
    } catch (error) {
      console.error('A video poster could not be kept.', error instanceof Error ? error.message : error);
      reason = 'unavailable';
    }
  }
  return { ...clip, mediaId, reason, title: found.title };
}
