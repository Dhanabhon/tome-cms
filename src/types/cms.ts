import type { SupportedImageType } from '../lib/media';

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

export type PostCategoryInsert = Pick<PostCategory, 'owner_id' | 'name'>
  & Partial<Pick<PostCategory, 'id' | 'is_default' | 'created_at' | 'updated_at'>>;
export type PostCategoryUpdate = Partial<Omit<PostCategoryInsert, 'id' | 'owner_id' | 'created_at'>>;
export type PostCategoryAssignmentInsert = Omit<PostCategoryAssignment, 'created_at'>
  & Partial<Pick<PostCategoryAssignment, 'created_at'>>;
export type PostCategoryAssignmentUpdate = Partial<Omit<PostCategoryAssignmentInsert, 'owner_id' | 'created_at'>>;

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
  cover_image: string | null;
  content_json: EditorDocument;
  content_html: string;
  meta_title: string | null;
  meta_description: string | null;
  status: PostStatus;
  published_at: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostInsert {
  id?: string;
  title: string;
  slug: string;
  locale: PostLocale;
  translation_group_id?: string;
  cover_image?: string | null;
  content_json: EditorDocument;
  content_html: string;
  meta_title?: string | null;
  meta_description?: string | null;
  status?: PostStatus;
  published_at?: string | null;
  author_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type PostUpdate = Partial<Omit<PostInsert, 'id' | 'author_id' | 'created_at'>>;

export interface PostMutationInput {
  title: string;
  slug?: string;
  coverImage?: string | null;
  contentJson: EditorDocument;
  contentHtml: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  status: PostStatus;
  locale?: PostLocale;
  sourcePostId?: string;
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

export interface PageInsert {
  id?: string;
  translation_group_id?: string;
  locale: PageLocale;
  title: string;
  slug: string;
  content_json: EditorDocument;
  content_html: string;
  meta_title?: string | null;
  meta_description?: string | null;
  status?: PageStatus;
  published_at?: string | null;
  author_id: string;
  created_at?: string;
  updated_at?: string;
}

export type PageUpdate = Partial<Omit<PageInsert, 'id' | 'author_id' | 'created_at' | 'locale' | 'translation_group_id'>>;

export interface PageMutationInput {
  title: string;
  slug?: string;
  contentJson: EditorDocument;
  contentHtml: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  status: PageStatus;
  locale?: PageLocale;
  sourcePageId?: string;
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

export type NavigationItemInsert = Pick<NavigationItem, 'owner_id' | 'locale' | 'location' | 'kind' | 'label' | 'position'>
  & Partial<Pick<NavigationItem, 'id' | 'page_id' | 'url' | 'created_at' | 'updated_at'>>;
export type NavigationItemUpdate = Partial<Omit<NavigationItemInsert, 'id' | 'owner_id' | 'created_at'>>;

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
  timezone: 'Asia/Bangkok' | 'UTC';
  owner_id: string;
  installed_at: string;
  updated_at: string;
  author_name: string;
  author_avatar_media_id: string | null;
  author_bio_th: string;
  author_bio_en: string;
  author_links: AuthorLink[];
}

export interface SiteSettingsInsert {
  id?: boolean;
  site_name: string;
  tagline?: string;
  site_description?: string;
  default_locale: SiteSettings['default_locale'];
  timezone: SiteSettings['timezone'];
  owner_id: string;
  installed_at?: string;
  updated_at?: string;
  author_name?: string;
  author_avatar_media_id?: string | null;
  author_bio_th?: string;
  author_bio_en?: string;
  author_links?: AuthorLink[];
}

export type SiteSettingsUpdate = Partial<Omit<SiteSettingsInsert, 'id' | 'owner_id' | 'installed_at'>>;

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

export interface MediaFolderInsert {
  created_at?: string;
  id?: string;
  name: string;
  owner_id: string;
  updated_at?: string;
}

export interface MediaFolderUpdate {
  created_at?: string;
  id?: string;
  name?: string;
  owner_id?: string;
  updated_at?: string;
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

export interface MediaItemInsert {
  alt_text?: string | null;
  created_at?: string;
  folder_id?: string | null;
  height: number;
  id?: string;
  mime_type: SupportedImageType;
  original_name: string;
  owner_id: string;
  size_bytes: number;
  storage_path: string;
  updated_at?: string;
  width: number;
}

export interface MediaItemUpdate {
  alt_text?: string | null;
  created_at?: string;
  folder_id?: string | null;
  height?: number;
  id?: string;
  mime_type?: SupportedImageType;
  original_name?: string;
  owner_id?: string;
  size_bytes?: number;
  storage_path?: string;
  updated_at?: string;
  width?: number;
}

export interface MediaAsset extends MediaItem {
  publicUrl: string;
}

export interface UploadImageOptions {
  altText?: string | null;
  folderId?: string | null;
}

type PostRow = { [Key in keyof Post]: Post[Key] };
type DatabasePostInsert = { [Key in keyof PostInsert]: PostInsert[Key] };
type DatabasePostUpdate = { [Key in keyof PostUpdate]: PostUpdate[Key] };
type PageRow = { [Key in keyof Page]: Page[Key] };
type DatabasePageInsert = { [Key in keyof PageInsert]: PageInsert[Key] };
type DatabasePageUpdate = { [Key in keyof PageUpdate]: PageUpdate[Key] };
type NavigationItemRow = { [Key in keyof NavigationItem]: NavigationItem[Key] };
type DatabaseNavigationItemInsert = { [Key in keyof NavigationItemInsert]: NavigationItemInsert[Key] };
type DatabaseNavigationItemUpdate = { [Key in keyof NavigationItemUpdate]: NavigationItemUpdate[Key] };
type SiteSettingsRow = { [Key in keyof SiteSettings]: SiteSettings[Key] };
type DatabaseSiteSettingsInsert = { [Key in keyof SiteSettingsInsert]: SiteSettingsInsert[Key] };
type DatabaseSiteSettingsUpdate = { [Key in keyof SiteSettingsUpdate]: SiteSettingsUpdate[Key] };
type MediaFolderRow = { [Key in keyof MediaFolder]: MediaFolder[Key] };
type DatabaseMediaFolderInsert = { [Key in keyof MediaFolderInsert]: MediaFolderInsert[Key] };
type DatabaseMediaFolderUpdate = { [Key in keyof MediaFolderUpdate]: MediaFolderUpdate[Key] };
type MediaItemRow = { [Key in keyof MediaItem]: MediaItem[Key] };
type DatabaseMediaItemInsert = { [Key in keyof MediaItemInsert]: MediaItemInsert[Key] };
type DatabaseMediaItemUpdate = { [Key in keyof MediaItemUpdate]: MediaItemUpdate[Key] };

export interface Database {
  public: {
    Tables: {
      categories: {
        Row: { [Key in keyof PostCategory]: PostCategory[Key] };
        Insert: PostCategoryInsert;
        Update: PostCategoryUpdate;
        Relationships: [];
      };
      post_category_assignments: {
        Row: { [Key in keyof PostCategoryAssignment]: PostCategoryAssignment[Key] };
        Insert: PostCategoryAssignmentInsert;
        Update: PostCategoryAssignmentUpdate;
        Relationships: [
          {
            foreignKeyName: 'post_category_assignments_translation_group_id_owner_id_fkey';
            columns: ['translation_group_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'post_translation_groups';
            referencedColumns: ['id', 'author_id'];
          },
          {
            foreignKeyName: 'post_category_assignments_category_id_owner_id_fkey';
            columns: ['category_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id', 'owner_id'];
          },
        ];
      };
      post_translation_groups: {
        Row: { id: string; author_id: string | null };
        Insert: { id: string; author_id?: string | null };
        Update: { author_id?: string | null };
        Relationships: [];
      };
      pages: {
        Row: PageRow;
        Insert: DatabasePageInsert;
        Update: DatabasePageUpdate;
        Relationships: [];
      };
      navigation_items: {
        Row: NavigationItemRow;
        Insert: DatabaseNavigationItemInsert;
        Update: DatabaseNavigationItemUpdate;
        Relationships: [
          {
            foreignKeyName: 'navigation_items_page_owner_locale_fkey';
            columns: ['page_id', 'owner_id', 'locale'];
            isOneToOne: false;
            referencedRelation: 'pages';
            referencedColumns: ['id', 'author_id', 'locale'];
          },
        ];
      };
      media_folders: {
        Row: MediaFolderRow;
        Insert: DatabaseMediaFolderInsert;
        Update: DatabaseMediaFolderUpdate;
        Relationships: [];
      };
      media_items: {
        Row: MediaItemRow;
        Insert: DatabaseMediaItemInsert;
        Update: DatabaseMediaItemUpdate;
        Relationships: [
          {
            foreignKeyName: 'media_items_folder_id_fkey';
            columns: ['folder_id'];
            isOneToOne: false;
            referencedRelation: 'media_folders';
            referencedColumns: ['id'];
          },
        ];
      };
      posts: {
        Row: PostRow;
        Insert: DatabasePostInsert;
        Update: DatabasePostUpdate;
        Relationships: [];
      };
      site_settings: {
        Row: SiteSettingsRow;
        Insert: DatabaseSiteSettingsInsert;
        Update: DatabaseSiteSettingsUpdate;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      replace_post_categories: {
        Args: { requested_category_ids: string[]; target_post_id: string };
        Returns: { category_id: string }[];
      };
      delete_post_category: {
        Args: { target_category_id: string };
        Returns: number;
      };
      replace_navigation_items: {
        Args: {
          menu_items: Json;
          target_locale: PageLocale;
          target_location: NavigationLocation;
        };
        Returns: NavigationItem[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
