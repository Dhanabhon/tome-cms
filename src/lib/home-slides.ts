import { z } from 'zod';

import { HOME_SLIDE_FOCUS, POST_LOCALES, type HomeSlideFocus } from '../types/cms';
import { normalizeNavigationUrl } from './navigation-url';

/** At most this many a language keeps, so next month's can wait beside this month's. */
export const MAX_HOME_SLIDES = 10;
/** At most this many a home page shows: a carousel is mostly its first slide. */
export const SHOWN_HOME_SLIDES = 5;
/** Heavier than this, the admin says the home page will be slow to show it. */
export const HEAVY_SLIDE_BYTES = 800 * 1024;
/** Narrower than this, the admin says it will look soft on a wide screen. */
export const NARROW_SLIDE_PIXELS = 1600;

export type HomeSlideStatus = 'live' | 'waiting' | 'ended' | 'off';

/**
 * Whether a slide is on the home page now, and if not, why not. The public read and the admin's
 * list both ask this, so they cannot disagree about a slide at its edges: one that starts this
 * instant has started, and one that ends this instant has ended.
 */
export function slideStatus(
  slide: { enabled: boolean; endsAt: string | null; startsAt: string | null },
  now: Date,
): HomeSlideStatus {
  if (!slide.enabled) return 'off';
  const time = now.getTime();
  if (slide.startsAt && Date.parse(slide.startsAt) > time) return 'waiting';
  if (slide.endsAt && Date.parse(slide.endsAt) <= time) return 'ended';
  return 'live';
}

/** Which part of a picture survives when a narrow screen crops it, as CSS says it. */
export const FOCUS_POSITION: Readonly<Record<HomeSlideFocus, string>> = {
  'top-start': 'left top', top: 'center top', 'top-end': 'right top',
  start: 'left center', center: 'center', end: 'right center',
  'bottom-start': 'left bottom', bottom: 'center bottom', 'bottom-end': 'right bottom',
};

const lowerId = z.uuid().transform((id) => id.toLowerCase());
const words = (max: number) => z.string().trim().max(max).nullable().default(null)
  .transform((value) => value || null);
const moment = z.iso.datetime({ offset: true }).nullable().default(null);

const slideLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('home') }).strict(),
  z.object({ kind: z.literal('page'), pageId: lowerId }).strict(),
  z.object({
    kind: z.literal('custom'),
    newTab: z.boolean().default(false),
    url: z.string().trim().transform(normalizeNavigationUrl).pipe(z.string().min(1).max(2_048)),
  }).strict(),
]);

const slideSchema = z.object({
  align: z.enum(['start', 'center', 'end']).default('start'),
  body: words(200),
  button: z.object({ label: z.string().trim().min(1).max(30), link: slideLinkSchema }).strict().nullable().default(null),
  enabled: z.boolean().default(true),
  endsAt: moment,
  focus: z.enum(HOME_SLIDE_FOCUS).default('center'),
  heading: words(80),
  mediaId: lowerId,
  overlay: z.enum(['none', 'soft', 'strong']).default('soft'),
  startsAt: moment,
}).strict().superRefine((slide, context) => {
  if (slide.overlay === 'none' && (slide.heading || slide.body)) {
    context.addIssue({ code: 'custom', message: 'Words need a darkened picture under them.', path: ['overlay'] });
  }
  if (slide.startsAt && slide.endsAt && Date.parse(slide.endsAt) <= Date.parse(slide.startsAt)) {
    context.addIssue({ code: 'custom', message: 'A slide has to end after it starts.', path: ['endsAt'] });
  }
});

export const homeSlidesSchema = z.object({
  locale: z.enum(POST_LOCALES),
  slides: z.array(slideSchema).max(MAX_HOME_SLIDES),
}).strict();

export type HomeSlidesMutation = z.infer<typeof homeSlidesSchema>;
export type HomeSlideMutation = HomeSlidesMutation['slides'][number];
