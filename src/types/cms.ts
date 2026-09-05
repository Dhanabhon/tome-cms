import type { SupportedImageType } from '../lib/media';

export type { SupportedImageType } from '../lib/media';

export const POST_STATUSES = ['draft', 'published'] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

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

export interface SiteSettings {
  id: boolean;
  site_name: string;
  site_description: string;
  default_locale: 'th' | 'en';
  timezone: 'Asia/Bangkok' | 'UTC';
  owner_id: string;
  installed_at: string;
  updated_at: string;
}

export interface SiteSettingsInsert {
  id?: boolean;
  site_name: string;
  site_description?: string;
  default_locale: SiteSettings['default_locale'];
  timezone: SiteSettings['timezone'];
  owner_id: string;
  installed_at?: string;
  updated_at?: string;
}

export type SiteSettingsUpdate = Partial<Omit<SiteSettingsInsert, 'id' | 'owner_id' | 'installed_at'>>;

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
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
