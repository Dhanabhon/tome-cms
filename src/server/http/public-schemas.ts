import { z } from 'zod';

import { editorDocumentSchema, sanitizedContentHtmlSchema } from '../../lib/editor-content';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/media';
import type {
  ProblemDetails,
  PublicAuthor,
  PublicCategory,
  PublicHomeSlide,
  PublicListLinks,
  PublicListMeta,
  PublicMedia,
  PublicNavigation,
  PublicPage,
  PublicPost,
  PublicSeo,
  PublicSite,
  PublicTranslation,
} from '../../types/cms';
import { HOME_SLIDE_FOCUS, POST_LOCALES, POST_STATUSES } from '../../types/cms';
import { normalizedContentSlugSchema } from '../content/mutations';

export const localeQuerySchema = z.enum(POST_LOCALES);

export const listQuerySchema = z.object({
  locale: localeQuerySchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(2_048).optional(),
}).strict();

export const postListQuerySchema = listQuerySchema.extend({
  category: z.string().trim().min(1).max(80).optional(),
}).strict();

export const detailQuerySchema = z.object({ locale: localeQuerySchema }).strict();
export const emptyQuerySchema = z.object({}).strict();
export const publicContentSlugSchema = normalizedContentSlugSchema;

export function parsePublicQuery<TSchema extends z.ZodType>(
  searchParams: URLSearchParams,
  schema: TSchema,
): z.output<TSchema> {
  const values = Object.create(null) as Record<string, string | string[]>;
  for (const [key, value] of searchParams) {
    const previous = values[key];
    values[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return schema.parse(values);
}

const timestampSchema = z.iso.datetime({ offset: true });
const publicUrlSchema = z.string().min(1).max(2_048).refine((value) => {
  if (value.startsWith('/')) return !value.startsWith('//');
  return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol);
}, 'Use an absolute path or HTTP(S) URL.');

export const publicMediaSchema: z.ZodType<PublicMedia> = z.object({
  altText: z.string().max(300).nullable(),
  height: z.number().int().positive(),
  id: z.uuid(),
  mimeType: z.enum(ACCEPTED_IMAGE_TYPES),
  sizeBytes: z.number().int().positive(),
  url: publicUrlSchema,
  width: z.number().int().positive(),
}).strict();

export const publicTranslationSchema: z.ZodType<PublicTranslation> = z.object({
  href: publicUrlSchema,
  locale: localeQuerySchema,
}).strict();

export const publicCategorySchema: z.ZodType<PublicCategory> = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(80),
}).strict();

export const publicSeoSchema: z.ZodType<PublicSeo> = z.object({
  description: z.string().max(320).nullable(),
  title: z.string().max(70).nullable(),
}).strict();

const publicContentFields = {
  contentHtml: sanitizedContentHtmlSchema,
  contentJson: editorDocumentSchema,
  createdAt: timestampSchema,
  id: z.uuid(),
  locale: localeQuerySchema,
  media: z.array(publicMediaSchema),
  publishedAt: timestampSchema.nullable(),
  seo: publicSeoSchema,
  slug: publicContentSlugSchema,
  status: z.enum(POST_STATUSES),
  title: z.string().min(1).max(200),
  translationGroupId: z.uuid(),
  translations: z.array(publicTranslationSchema).max(2),
  updatedAt: timestampSchema,
};

export const publicPostSchema: z.ZodType<PublicPost> = z.object({
  ...publicContentFields,
  categories: z.array(publicCategorySchema).max(20),
  coverImage: publicMediaSchema.nullable(),
}).strict();

export const publicPageSchema: z.ZodType<PublicPage> = z.object(publicContentFields).strict();

const authorLinkSchema = z.object({
  label: z.string().min(1).max(80),
  url: z.url({ protocol: /^https?$/ }),
}).strict();

export const publicAuthorSchema: z.ZodType<PublicAuthor> = z.object({
  avatar: publicMediaSchema.nullable(),
  bio: z.object({ en: z.string().max(1_000), th: z.string().max(1_000) }).strict(),
  links: z.array(authorLinkSchema).max(5),
  name: z.string().min(1).max(120),
}).strict();

const brandUrlSchema = z.url({ protocol: /^https?$/ });
const brandImageSchema = z.object({
  height: z.number().int().positive(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']),
  url: brandUrlSchema,
  width: z.number().int().positive(),
}).strict();

export const publicSiteSchema: z.ZodType<PublicSite> = z.object({
  author: publicAuthorSchema.nullable(),
  brand: z.object({
    icon: z.object({ png180: brandUrlSchema, png32: brandUrlSchema, svg: brandUrlSchema.nullable() }).strict().nullable(),
    logo: brandImageSchema.nullable(),
    logoDark: brandImageSchema.nullable(),
    showSiteName: z.boolean(),
  }).strict(),
  defaultLocale: localeQuerySchema,
  description: z.string().max(160),
  name: z.string().min(1).max(120),
  supportedLocales: z.tuple([z.literal('th'), z.literal('en')]),
  tagline: z.string().max(120),
  timezone: z.enum(['Asia/Bangkok', 'UTC']),
  updatedAt: timestampSchema,
}).strict();

const publicNavigationItemSchema = z.object({
  href: publicUrlSchema,
  kind: z.enum(['home', 'page', 'custom']),
  label: z.string().min(1).max(80),
  newTab: z.boolean(),
}).strict();

export const publicNavigationSchema: z.ZodType<PublicNavigation> = z.object({
  footer: z.array(publicNavigationItemSchema).max(50),
  header: z.array(publicNavigationItemSchema).max(50),
}).strict();

const publicHomeSlideSchema = z.object({
  align: z.enum(['start', 'center', 'end']),
  body: z.string().min(1).max(200).nullable(),
  button: z.object({ href: publicUrlSchema, label: z.string().min(1).max(30), newTab: z.boolean() }).strict().nullable(),
  focus: z.enum(HOME_SLIDE_FOCUS),
  heading: z.string().min(1).max(80).nullable(),
  image: z.object({
    alt: z.string().max(300),
    height: z.number().int().positive(),
    src: publicUrlSchema,
    width: z.number().int().positive(),
  }).strict(),
  overlay: z.enum(['none', 'soft', 'strong']),
}).strict();

/** The live slides of one language, in order: at most the five a home page shows. */
export const publicHomeSlidesSchema: z.ZodType<PublicHomeSlide[]> = z.array(publicHomeSlideSchema).max(5);

export const publicListMetaSchema: z.ZodType<PublicListMeta> = z.object({
  hasMore: z.boolean(),
  limit: z.number().int().min(1).max(50),
  locale: localeQuerySchema,
}).strict();

export const publicListLinksSchema: z.ZodType<PublicListLinks> = z.object({
  next: z.url({ protocol: /^https?$/ }).nullable(),
}).strict();

export const problemDetailsSchema: z.ZodType<ProblemDetails> = z.object({
  detail: z.string().min(1),
  instance: z.string().min(1).max(2_048),
  maintenance: z.object({
    backAt: z.iso.datetime().nullable(),
    heading: z.string().min(1),
    locale: z.enum(POST_LOCALES),
    message: z.string().min(1),
  }).strict().optional(),
  requestId: z.uuid(),
  status: z.number().int().min(400).max(599),
  title: z.string().min(1),
  type: z.string().min(1).max(2_048),
}).strict();
