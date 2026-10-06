import { withLeadImage, withoutImageTitles, withResponsiveImages } from './editor-content';
import { responsiveAttrs, type ResponsiveImage } from './responsive-image';

/**
 * What an article leads with. A shown cover leads and the body is untouched; with no cover, or a
 * hidden one, the body's first image takes fetchpriority so the largest paint stays fast. The
 * home card and og:image read cover_image themselves and are not affected. The cover is described by
 * the alt text its picture was given in the library; without one it is decoration, as on a card.
 *
 * `sizes` is how wide the theme draws its column: the cover and the body's pictures fill it, and
 * are drawn from the copy that fits it. The cover keeps its own width and height; one the library
 * does not describe keeps the 16:9 box the themes always gave it.
 */
export function articleCover(post: {
  cover_image: string | null;
  coverImage?: (ResponsiveImage & { alt_text: string | null }) | null;
  media?: readonly ResponsiveImage[];
  show_cover: boolean;
  content_html: string;
}, sizes: string): {
  cover: string | null;
  coverAlt: string;
  coverPicture: { height: number; sizes?: string; srcset?: string; width: number };
  bodyHtml: string;
} {
  const cover = post.show_cover ? post.cover_image : null;
  const html = withResponsiveImages(withoutImageTitles(post.content_html), post.media ?? [], sizes);
  const image = post.coverImage;
  return {
    cover,
    coverAlt: image?.alt_text ?? '',
    coverPicture: { height: image?.height ?? 675, width: image?.width ?? 1200, ...responsiveAttrs(image, sizes) },
    bodyHtml: cover ? html : withLeadImage(html),
  };
}
