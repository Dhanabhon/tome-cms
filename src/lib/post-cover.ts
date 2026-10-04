import { withLeadImage } from './editor-content';

/**
 * What an article leads with. A shown cover leads and the body is untouched; with no cover, or a
 * hidden one, the body's first image takes fetchpriority so the largest paint stays fast. The
 * home card and og:image read cover_image themselves and are not affected. The cover is described by
 * the alt text its picture was given in the library; without one it is decoration, as on a card.
 */
export function articleCover(post: {
  cover_image: string | null;
  coverImage?: { alt_text: string | null } | null;
  show_cover: boolean;
  content_html: string;
}): { cover: string | null; coverAlt: string; bodyHtml: string } {
  const cover = post.show_cover ? post.cover_image : null;
  return { cover, coverAlt: post.coverImage?.alt_text ?? '', bodyHtml: cover ? post.content_html : withLeadImage(post.content_html) };
}
