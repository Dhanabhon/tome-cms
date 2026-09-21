import type { SupportedImageType } from '../lib/media';
import type { SiteBrand } from '../lib/site-brand';

export type { SupportedImageType } from '../lib/media';

export const POST_STATUSES = ['draft', 'published'] as const;
export const POST_LOCALES = ['th', 'en'] as const;

export type PostStatus = (typeof POST_STATUSES)[number];
export type PostLocale = (typeof POST_LOCALES)[number];

export interface PostTranslationSummary {
  id: string;
  locale: PostLocale;
  status: PostStatus;
  title: string;
}

export interface PostCategory {
  id: string;
  owner_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PostCategorySummary extends PostCategory {
  postCount: number;
}

export interface PostCategoryAssignment {
  translation_group_id: string;
  category_id: string;
  owner_id: string;
  created_at: string;
}

export interface PostCategoryBadge {
  id: string;
  name: string;
}

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export interface EditorMark {
  type: string;
  attrs?: Record<string, Json>;
}

export interface EditorNode {
  type?: string;
  attrs?: Record<string, Json>;
  content?: EditorNode[];
  marks?: EditorMark[];
  text?: string;
}

export interface EditorDocument extends EditorNode {
  type: 'doc';
}

export interface Post {
  id: string;
  title: string;
  slug: string;
  locale: PostLocale;
  translation_group_id: string;
  cover_media_id: string | null;
  cover_image: string | null;
  content_json: EditorDocument;
  content_html: string;
  /** What a card shows. Empty means the theme falls back; see lib/posts.ts. */
  excerpt: string;
  meta_title: string | null;
  meta_description: string | null;
  status: PostStatus;
  published_at: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostMutationInput {
  categoryIds: string[];
  coverMediaId: string | null;
  title: string;
  slug: string;
  contentJson: EditorDocument;
  excerpt: string;
  metaTitle: string | null;
  metaDescription: string | null;
  status: PostStatus;
  locale?: PostLocale;
  sourcePostId?: string;
  updatedAt?: string;
}

export interface PostAlternate {
  href: string;
  locale: PostLocale;
}

export type PageLocale = PostLocale;
export type PageStatus = PostStatus;

export interface Page {
  id: string;
  translation_group_id: string;
  locale: PageLocale;
  title: string;
  slug: string;
  content_json: EditorDocument;
  content_html: string;
  /** A short line a theme may show where it lists or links to the page. */
  excerpt: string;
  meta_title: string | null;
  meta_description: string | null;
  status: PageStatus;
  published_at: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
}

export interface PageTranslationSummary {
  id: string;
  locale: PageLocale;
  status: PageStatus;
  title: string;
}

export interface PageMutationInput {
  title: string;
  slug: string;
  contentJson: EditorDocument;
  excerpt: string;
  metaTitle: string | null;
  metaDescription: string | null;
  status: PageStatus;
  locale?: PageLocale;
  sourcePageId?: string;
  updatedAt?: string;
}

export type NavigationLocation = 'header' | 'footer';
export type NavigationKind = 'home' | 'page' | 'custom';

export interface NavigationItem {
  id: string;
  owner_id: string;
  locale: PageLocale;
  location: NavigationLocation;
  kind: NavigationKind;
  label: string;
  page_id: string | null;
  url: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface NavigationMutationItem {
  kind: NavigationKind;
  label: string;
  pageId: string | null;
  url: string | null;
}

export interface PublicNavigationItem {
  href: string;
  kind: NavigationKind;
  label: string;
}

export interface PublicNavigation {
  footer: PublicNavigationItem[];
  header: PublicNavigationItem[];
}

export interface Meta {
  title: string | null;
  description: string | null;
  image: string | null;
}

export interface User {
  id: string;
  email: string | null;
}

export interface AuthorLink {
  label: string;
  url: string;
}

export interface SiteSettings {
  id: boolean;
  site_name: string;
  tagline: string;
  site_description: string;
  default_locale: PostLocale;
  theme: 'system' | 'light' | 'dark';
  allow_visitor_theme: boolean;
  show_powered_by: boolean;
  theme_id: string;
  timezone: 'Asia/Bangkok' | 'UTC';
  owner_id: string;
  installed_at: string;
  updated_at: string;
  author_name: string;
  author_avatar_media_id: string | null;
  author_bio_th: string;
  author_bio_en: string;
  author_links: AuthorLink[];
  hide_site_name: boolean;
}

export interface PublicAuthorProfile {
  avatarUrl: string | null;
  bio: string;
  links: AuthorLink[];
  name: string;
}

export interface MediaFolder {
  created_at: string;
  id: string;
  name: string;
  owner_id: string;
  updated_at: string;
}

export interface MediaItem {
  alt_text: string | null;
  created_at: string;
  folder_id: string | null;
  height: number;
  id: string;
  mime_type: SupportedImageType;
  original_name: string;
  owner_id: string;
  size_bytes: number;
  storage_path: string;
  updated_at: string;
  width: number;
}

export interface MediaAsset {
  alt_text: string | null;
  created_at: string;
  folder_id: string | null;
  height: number;
  id: string;
  mime_type: SupportedImageType;
  original_name: string;
  publicUrl: string;
  size_bytes: number;
  updated_at: string;
  width: number;
}

export interface MediaReferences {
  counts: { pageContent: number; postContent: number; postCovers: number; profile: number };
  pages: Array<{ id: string; title: string }>;
  posts: Array<{ id: string; title: string }>;
  profile: boolean;
}

export interface UploadImageOptions {
  altText?: string | null;
  folderId?: string | null;
  onProgress?: (percent: number) => void;
}

export interface PublicMedia {
  altText: string | null;
  height: number;
  id: string;
  mimeType: SupportedImageType;
  sizeBytes: number;
  url: string;
  width: number;
}

export interface PublicTranslation {
  href: string;
  locale: PostLocale;
}

export interface PublicCategory {
  id: string;
  name: string;
}

export interface PublicSeo {
  description: string | null;
  title: string | null;
}

export interface PublicPost {
  categories: PublicCategory[];
  contentHtml: string;
  contentJson: EditorDocument;
  coverImage: PublicMedia | null;
  createdAt: string;
  id: string;
  locale: PostLocale;
  media: PublicMedia[];
  publishedAt: string | null;
  seo: PublicSeo;
  slug: string;
  status: PostStatus;
  title: string;
  translationGroupId: string;
  translations: PublicTranslation[];
  updatedAt: string;
}

export interface PublicPage {
  contentHtml: string;
  contentJson: EditorDocument;
  createdAt: string;
  id: string;
  locale: PageLocale;
  media: PublicMedia[];
  publishedAt: string | null;
  seo: PublicSeo;
  slug: string;
  status: PageStatus;
  title: string;
  translationGroupId: string;
  translations: PublicTranslation[];
  updatedAt: string;
}

export interface PublicAuthor {
  avatar: PublicMedia | null;
  bio: { en: string; th: string };
  links: AuthorLink[];
  name: string;
}

export interface PublicSite {
  author: PublicAuthor | null;
  /** The site's logo, dark logo and icon as addresses, and whether its name is beside the logo. */
  brand: SiteBrand;
  defaultLocale: PostLocale;
  description: string;
  name: string;
  supportedLocales: ['th', 'en'];
  tagline: string;
  timezone: SiteSettings['timezone'];
  updatedAt: string;
}

export interface PublicListMeta {
  hasMore: boolean;
  limit: number;
  locale: PostLocale;
}

export interface PublicListLinks {
  next: string | null;
}

export interface ProblemDetails {
  detail: string;
  instance: string;
  requestId: string;
  status: number;
  title: string;
  type: string;
}
