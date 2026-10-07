/**
 * A picture drawn from the copy that fits: its smaller copies (480, 960 and 1600 px wide, only
 * those narrower than it) and the original, offered by width, with the width of the slot the page
 * draws it in. The browser takes the smallest that fills the slot at the screen's density. A
 * picture with no copies yet (not backfilled, too narrow, animated, an SVG) is offered nothing,
 * and its markup stays what it was.
 */
export interface ResponsiveImage {
  id: string;
  width: number;
  height: number;
  /** The widths of its copies (media_variants), narrowest first. */
  variant_widths: readonly number[];
}

/** `/media/<id>?w=480 480w, …, /media/<id> <width>w`, or nothing for a picture with no copies. */
export function imageSrcset({ id, variant_widths: widths, width }: Pick<ResponsiveImage, 'id' | 'variant_widths' | 'width'>): string | undefined {
  if (!widths.length) return undefined;
  return [...widths.map((copy) => `/media/${id}?w=${copy} ${copy}w`), `/media/${id} ${width}w`].join(', ');
}

/** `srcset` and `sizes` to spread onto an `<img>`, or nothing when the picture has no copies. */
export function responsiveAttrs(image: ResponsiveImage | null | undefined, sizes: string): { sizes?: string; srcset?: string } {
  const srcset = image ? imageSrcset(image) : undefined;
  return srcset ? { sizes, srcset } : {};
}

/*
 * How wide each theme draws a picture, at each width of the screen: what `sizes` says. Each one
 * is worked out from the theme's CSS (a rem is 16 px) and must follow it when the CSS changes;
 * tests/unit/responsive-image.test.ts checks the rules each is read from. A theme copied with
 * `tome theme new` keeps its source's, as it keeps its source's CSS.
 */

export const PAPER_SIZES = {
  // .post-page (paper/theme.css): min(100%, 48rem), less a 1.25rem gutter a side, 1.75rem from
  // 37.5rem. The cover and a body picture fill it; so does a page.
  article: '(min-width: 48rem) 44.5rem, (min-width: 37.5rem) calc(100vw - 3.5rem), calc(100vw - 2.5rem)',
  // .post-grid in Home's max-w-7xl section (80rem, px-5 / sm:px-7 from 37.5rem): auto-fill
  // tracks of at least max(19rem, a share of the row), 16rem when four are asked for, with
  // 1.5rem between. Keyed by the theme's gridColumns setting.
  cards: {
    '2': '(min-width: 80rem) 37.5rem, (min-width: 43rem) calc((100vw - 5rem) / 2), (min-width: 37.5rem) calc(100vw - 3.5rem), calc(100vw - 2.5rem)',
    '3': '(min-width: 80rem) 24.5rem, (min-width: 63.5rem) calc((100vw - 6.5rem) / 3), (min-width: 43rem) calc((100vw - 5rem) / 2), (min-width: 37.5rem) calc(100vw - 3.5rem), calc(100vw - 2.5rem)',
    '4': '(min-width: 80rem) 18rem, (min-width: 72rem) calc((100vw - 8rem) / 4), (min-width: 54.5rem) calc((100vw - 6.5rem) / 3), (min-width: 37.5rem) calc((100vw - 5rem) / 2), (min-width: 36rem) calc((100vw - 4rem) / 2), calc(100vw - 2.5rem)',
  },
  // .hero-slider__slide: flex 0 0 100% of a band the page's full width. Below 37.5rem its picture
  // is cropped into a 4:3 box (object-fit: cover): a 16:9 cover is scaled to the box's height, so
  // it is drawn (16 / 9) / (4 / 3) = 133.3 % of the slide wide, 134vw.
  hero: '(max-width: 37.499rem) 134vw, 100vw',
  // .hero-slide > img (the owner's slides): flex 0 0 100% and a 16:7 box below 64rem, so a 16:9
  // cover fills its width and is cropped in height; from 64rem it fills a 21:9 slide the same way.
  heroSlides: '100vw',
} as const;

export const PLAIN_SIZES = {
  // The article (plain/theme.css): min(the frame, 44rem), the frame 100% less a 1.25rem
  // gutter a side, 1.75rem from 40rem. A body picture is drawn the column's full width.
  article: '(min-width: 47.5rem) 44rem, (min-width: 40rem) calc(100vw - 3.5rem), calc(100vw - 2.5rem)',
} as const;

export const ALMANAC_SIZES = {
  // The article (almanac/theme.css): min(100% less the gutter a side, 44em) at 1.125rem,
  // which is 49.5rem; the gutter 1.25rem, 1.75rem from 40rem.
  article: '(min-width: 53rem) 49.5rem, (min-width: 40rem) calc(100vw - 3.5rem), calc(100vw - 2.5rem)',
  // The home grid, in the frame (min(100% less the gutter a side, 76rem)): one column, two
  // from 40rem, three from 64rem, 1.5rem between.
  card: '(min-width: 79.5rem) 24.34rem, (min-width: 64rem) calc((100vw - 6.5rem) / 3), (min-width: 40rem) calc((100vw - 5rem) / 2), calc(100vw - 2.5rem)',
} as const;
