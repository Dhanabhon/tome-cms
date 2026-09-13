import { z } from 'zod';

import { editorDocumentSchema, sanitizedContentHtmlSchema } from '../../lib/editor-content';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/media';
import type {
  ProblemDetails,
  PublicAuthor,
  PublicCategory,
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
import { POST_LOCALES, POST_STATUSES } from '../../types/cms';
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

export const publicSiteSchema: z.ZodType<PublicSite> = z.object({
  author: publicAuthorSchema.nullable(),
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
}).strict();

export const publicNavigationSchema: z.ZodType<PublicNavigation> = z.object({
  footer: z.array(publicNavigationItemSchema).max(50),
  header: z.array(publicNavigationItemSchema).max(50),
}).strict();

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
  requestId: z.uuid(),
  status: z.number().int().min(400).max(599),
  title: z.string().min(1),
  type: z.string().min(1).max(2_048),
}).strict();
