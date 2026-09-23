import { z } from 'zod';

import type { MaintenanceNotice, PostLocale } from '../types/cms';

export const MAINTENANCE_TEMPLATES = ['minimal', 'logo', 'picture', 'countdown'] as const;
export type MaintenanceTemplate = (typeof MAINTENANCE_TEMPLATES)[number];

export interface MaintenanceWords { heading: string; message: string }
export type MaintenanceCopy = Partial<Record<PostLocale, MaintenanceWords>>;

/** The page as the admin edits it: the switch, and what a visitor would see. */
export interface MaintenanceSettings {
  backAt: string | null;
  copy: MaintenanceCopy;
  enabled: boolean;
  mediaId: string | null;
  template: MaintenanceTemplate;
}

/** What the page says where its owner wrote nothing: a site closed in a hurry still says something. */
export const DEFAULT_MAINTENANCE_WORDS: Readonly<Record<PostLocale, MaintenanceWords>> = {
  en: { heading: 'Down for maintenance', message: 'We’ll be back soon.' },
  th: { heading: 'ปิดปรับปรุงชั่วคราว', message: 'เราจะกลับมาเร็ว ๆ นี้' },
};

const wordsSchema = z.object({
  heading: z.string().trim().max(80).default(''),
  message: z.string().trim().max(280).default(''),
}).strict();

const copySchema = z.object({ en: wordsSchema.optional(), th: wordsSchema.optional() }).strict();

export const maintenanceSchema = z.object({
  backAt: z.iso.datetime({ offset: true }).nullable().default(null),
  copy: copySchema.default({}),
  mediaId: z.uuid().transform((id) => id.toLowerCase()).nullable().default(null),
  template: z.enum(MAINTENANCE_TEMPLATES),
}).strict().superRefine((page, context) => {
  if (page.template === 'picture' && !page.mediaId) {
    context.addIssue({ code: 'custom', message: 'Picture needs a picture.', path: ['mediaId'] });
  }
  if (page.template === 'countdown' && !page.backAt) {
    context.addIssue({ code: 'custom', message: 'Countdown needs a time to count down to.', path: ['backAt'] });
  }
}).transform((page) => (page.template === 'picture' ? page : { ...page, mediaId: null }));

export type MaintenanceMutation = z.infer<typeof maintenanceSchema>;

export const maintenanceStateSchema = z.object({ enabled: z.boolean() }).strict();

/** The stored words, or none: a value of any other shape reads as nothing written. */
export function parseMaintenanceCopy(value: unknown): MaintenanceCopy {
  const parsed = copySchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function maintenanceWords(copy: MaintenanceCopy, locale: PostLocale): MaintenanceWords {
  const written = copy[locale];
  const fallback = DEFAULT_MAINTENANCE_WORDS[locale];
  return { heading: written?.heading || fallback.heading, message: written?.message || fallback.message };
}

/** Whether the return time is still to come. A time equal to now has passed, as a slide's end has. */
export function isAhead(backAt: Date | string | null, now: Date): boolean {
  return backAt !== null && new Date(backAt).getTime() > now.getTime();
}

/** `Retry-After` as an HTTP date, or nothing once the time has come or when none was set. */
export function retryAfter(backAt: Date | string | null, now: Date): string | null {
  return backAt !== null && isAhead(backAt, now) ? new Date(backAt).toUTCString() : null;
}

/** The path's language first, then the API's `?locale=`, then the site's own. */
export function maintenanceLocale(url: URL, fallback: PostLocale): PostLocale {
  const first = url.pathname.split('/')[1];
  if (first === 'th' || first === 'en') return first;
  const asked = url.searchParams.get('locale');
  return asked === 'th' || asked === 'en' ? asked : fallback;
}

export function maintenanceNotice(
  settings: { maintenance_back_at: Date | null; maintenance_copy: MaintenanceCopy },
  locale: PostLocale,
): MaintenanceNotice {
  return {
    ...maintenanceWords(settings.maintenance_copy, locale),
    backAt: settings.maintenance_back_at?.toISOString() ?? null,
    locale,
  };
}
