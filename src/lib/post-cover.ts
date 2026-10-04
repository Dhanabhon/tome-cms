import { withLeadImage, withoutImageTitles } from './editor-content';

/**
 * What an article leads with. A shown cover leads and the body is untouched; with no cover, or a
 * hidden one, the body's first image takes fetchpriority so the largest paint stays fast. The
 * home card and og:image read cover_image themselves and are not affected.
 */
export function articleCover(post: { cover_image: string | null; show_cover: boolean; content_html: string }): { cover: string | null; bodyHtml: string } {
  const cover = post.show_cover ? post.cover_image : null;
  const html = withoutImageTitles(post.content_html);
  return { cover, bodyHtml: cover ? html : withLeadImage(html) };
}
