import type { SupportedImageType, SupportedMediaType } from '../lib/media';
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
  /** For the chip: a published edition whose date is still to come is Scheduled. */
  published_at: string | null;
  title: string;
}

export interface PostCategory {
  id: string;
  owner_id: string;
  name: string;
  /** The address of the category's page, /<locale>/category/<slug>; unique per owner. */
  slug: string;
  description_th: string;
  description_en: string;
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
  slug: string;
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
  show_cover: boolean;
  content_json: EditorDocument;
  content_html: string;
  /** What a card shows. Empty means the theme falls back; see lib/posts.ts. */
  excerpt: string;
  meta_title: string | null;
  meta_description: string | null;
  status: PostStatus;
  published_at: string | null;
  /** The date a draft is planned to go out on. Null once published, or when none was chosen. */
  planned_at: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostMutationInput {
  categoryIds: string[];
  coverMediaId: string | null;
  showCover?: boolean;
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
  /** The date a draft is planned to go out on. Null once published, or when none was chosen. */
  planned_at: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
}

export interface PageTranslationSummary {
  id: string;
  locale: PageLocale;
  status: PageStatus;
  /** For the chip: a published edition whose date is still to come is Scheduled. */
  published_at: string | null;
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
/** A group is a label with no link; it only opens its sub-items. */
export type NavigationKind = 'home' | 'page' | 'custom' | 'group';

export interface NavigationItem {
  id: string;
  owner_id: string;
  locale: PageLocale;
  location: NavigationLocation;
  kind: NavigationKind;
  label: string;
  page_id: string | null;
  url: string | null;
  /** The header item this sub-item sits under; null at the top level. */
  parent_id: string | null;
  position: number;
  new_tab: boolean;
  created_at: string;
  updated_at: string;
}

export interface NavigationSubItem {
  kind: Exclude<NavigationKind, 'group'>;
  label: string;
  pageId: string | null;
  url: string | null;
  /** Only a custom item may: the site's own pages open in place. */
  newTab: boolean;
}

export interface NavigationMutationItem extends Omit<NavigationSubItem, 'kind'> {
  kind: NavigationKind;
  /** Header only, one level: a sub-item is never a group and holds none. A group needs at least one. */
  children?: NavigationSubItem[];
}

export interface PublicNavigationItem {
  /** Null only for a group, which is a label with no link. */
  href: string | null;
  kind: NavigationKind;
  label: string;
  /** The owner asked for this link to open in a new tab; a theme adds target and rel. */
  newTab: boolean;
  /** The sub-items of a header item: always present, empty for a sub-item and in the footer. */
  children: PublicNavigationItem[];
}

export interface PublicNavigation {
  footer: PublicNavigationItem[];
  header: PublicNavigationItem[];
}

export const HOME_SLIDE_FOCUS = [
  'top-start', 'top', 'top-end', 'start', 'center', 'end', 'bottom-start', 'bottom', 'bottom-end',
] as const;
export type HomeSlideFocus = (typeof HOME_SLIDE_FOCUS)[number];
export type HomeSlideAlign = 'start' | 'center' | 'end';
export type HomeSlideOverlay = 'none' | 'soft' | 'strong';

/** A slide as the admin keeps it. */
export interface HomeSlide {
  align: HomeSlideAlign;
  body: string | null;
  button_label: string | null;
  created_at: string;
  enabled: boolean;
  ends_at: string | null;
  focus: HomeSlideFocus;
  heading: string | null;
  id: string;
  link_kind: Exclude<NavigationKind, 'group'> | null;
  locale: PostLocale;
  media_id: string;
  new_tab: boolean;
  overlay: HomeSlideOverlay;
  page_id: string | null;
  position: number;
  starts_at: string | null;
  updated_at: string;
  url: string | null;
}

/** What the admin needs to draw and judge a slide's picture. */
export interface HomeSlideMedia {
  alt_text: string | null;
  height: number;
  id: string;
  publicUrl: string;
  size_bytes: number;
  width: number;
}

/** A live slide, resolved for a theme or a headless site to draw. */
export interface PublicHomeSlide {
  align: HomeSlideAlign;
  body: string | null;
  button: { href: string; label: string; newTab: boolean } | null;
  focus: HomeSlideFocus;
  heading: string | null;
  /** `srcset` is the theme's, from the picture's copies, and is never in the API's answer. */
  image: { alt: string; height: number; src: string; srcset?: string; width: number };
  overlay: HomeSlideOverlay;
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
  /** The default language's description, kept for a rollback to 1.18. */
  site_description: string;
  site_description_th: string;
  site_description_en: string;
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
  hide_from_search: boolean;
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
  /** Null for a document: only an image has dimensions. */
  height: number | null;
  id: string;
  mime_type: SupportedMediaType;
  original_name: string;
  publicUrl: string;
  size_bytes: number;
  updated_at: string;
  width: number | null;
}

export interface MediaReferences {
  counts: { maintenance: number; pageContent: number; plugins: number; postContent: number; postCovers: number; profile: number; slides: number };
  maintenance: boolean;
  pages: Array<{ id: string; title: string }>;
  plugins: Array<{ id: string; name: string }>;
  posts: Array<{ id: string; title: string }>;
  profile: boolean;
  slides: Array<{ heading: string | null; id: string; locale: PostLocale; position: number }>;
}

export interface UploadImageOptions {
  altText?: string | null;
  folderId?: string | null;
  onProgress?: (percent: number) => void;
  /** Aborting it stops the upload wherever it is: the request in flight is cancelled, the next is never sent. */
  signal?: AbortSignal;
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
  slug: string;
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
  showCover: boolean;
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
  /**
   * The site's logo, dark logo and icon as addresses, and whether its name is beside the logo.
   * Not the share image: that is for the head of the site's own pages.
   */
  brand: Omit<SiteBrand, 'share'>;
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

/** What a closed site tells a headless client, in the language it asked for. */
export interface MaintenanceNotice {
  backAt: string | null;
  heading: string;
  locale: PostLocale;
  message: string;
}

export interface ProblemDetails {
  detail: string;
  instance: string;
  maintenance?: MaintenanceNotice;
  requestId: string;
  status: number;
  title: string;
  type: string;
}
