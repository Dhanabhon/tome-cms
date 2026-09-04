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

type PostRow = { [Key in keyof Post]: Post[Key] };
type DatabasePostInsert = { [Key in keyof PostInsert]: PostInsert[Key] };
type DatabasePostUpdate = { [Key in keyof PostUpdate]: PostUpdate[Key] };
type SiteSettingsRow = { [Key in keyof SiteSettings]: SiteSettings[Key] };
type DatabaseSiteSettingsInsert = { [Key in keyof SiteSettingsInsert]: SiteSettingsInsert[Key] };
type DatabaseSiteSettingsUpdate = { [Key in keyof SiteSettingsUpdate]: SiteSettingsUpdate[Key] };

export interface Database {
  public: {
    Tables: {
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
