import type { ColumnType, Generated } from 'kysely';

import type { SupportedImageType } from '../../lib/media';
import type { EditorDocument, Json } from '../../types/cms';

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type RequiredTimestamp = ColumnType<Date, Date | string, Date | string>;

export interface AppMetadataTable {
  key: string;
  value: string;
  updated_at: Timestamp;
}

export interface Database {
  app_metadata: AppMetadataTable;
  user: UserTable;
  session: SessionTable;
  account: AccountTable;
  verification: VerificationTable;
  passkey: PasskeyTable;
  installation_enrollments: InstallationEnrollmentTable;
  recovery_codes: RecoveryCodeTable;
  security_rate_limits: SecurityRateLimitTable;
  site_settings: SiteSettingsTable;
  post_translation_groups: TranslationGroupTable;
  page_translation_groups: TranslationGroupTable;
  posts: PostTable;
  pages: PageTable;
  categories: CategoryTable;
  post_category_assignments: PostCategoryAssignmentTable;
  navigation_items: NavigationItemTable;
  media_folders: MediaFolderTable;
  media_items: MediaItemTable;
  media_upload_reservations: MediaUploadReservationTable;
  preview_tokens: PreviewTokenTable;
}

export interface UserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  role: 'owner';
}

export interface SessionTable {
  id: string;
  expiresAt: RequiredTimestamp;
  token: string;
  createdAt: Timestamp;
  updatedAt: RequiredTimestamp;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  credential_id: string;
}

export interface AccountTable {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Timestamp | null;
  refreshTokenExpiresAt: Timestamp | null;
  scope: string | null;
  password: string | null;
  createdAt: Timestamp;
  updatedAt: RequiredTimestamp;
}

export interface VerificationTable {
  id: string;
  identifier: string;
  value: string;
  expiresAt: RequiredTimestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PasskeyTable {
  id: string;
  name: string | null;
  publicKey: string;
  userId: string;
  credentialID: string;
  counter: number;
  deviceType: string;
  backedUp: boolean;
  transports: string | null;
  createdAt: Timestamp | null;
  aaguid: string | null;
  last_used_at: Timestamp | null;
}

export interface InstallationEnrollmentTable {
  id: string;
  context_hash: string;
  purpose: 'install' | 'recovery';
  pending_user_id: string;
  email: string;
  expires_at: RequiredTimestamp;
  consumed_at: Timestamp | null;
  created_at: Timestamp;
}

export interface RecoveryCodeTable {
  id: string;
  user_id: string;
  code_hash: string;
  created_at: Timestamp;
  consumed_at: Timestamp | null;
}

export interface SecurityRateLimitTable {
  key_hash: string;
  action: 'install' | 'signin' | 'recovery' | 'update-check' | 'update-apply';
  window_started_at: RequiredTimestamp;
  attempts: number;
}

export interface SiteSettingsTable {
  id: boolean;
  owner_id: string;
  site_name: string;
  tagline: Generated<string>;
  site_description: Generated<string>;
  default_locale: 'th' | 'en';
  timezone: 'Asia/Bangkok' | 'UTC';
  theme: Generated<'system' | 'light' | 'dark'>;
  admin_path: string;
  author_name: Generated<string>;
  author_avatar_media_id: string | null;
  author_bio_th: Generated<string>;
  author_bio_en: Generated<string>;
  author_links: Generated<Json>;
  installed_at: Timestamp;
  updated_at: Timestamp;
}

export interface TranslationGroupTable {
  id: Generated<string>;
  owner_id: string;
  created_at: Timestamp;
}

export interface ContentEditionColumns {
  id: Generated<string>;
  translation_group_id: string;
  locale: 'th' | 'en';
  title: string;
  slug: string;
  content_json: EditorDocument;
  content_html: string;
  meta_title: string | null;
  meta_description: string | null;
  status: 'draft' | 'published';
  published_at: Timestamp | null;
  owner_id: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PostTable extends ContentEditionColumns {
  cover_media_id: string | null;
}

export interface PageTable extends ContentEditionColumns {}

export interface CategoryTable {
  id: Generated<string>;
  owner_id: string;
  name: string;
  is_default: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PostCategoryAssignmentTable {
  translation_group_id: string;
  category_id: string;
  owner_id: string;
  created_at: Timestamp;
}

export interface NavigationItemTable {
  id: Generated<string>;
  owner_id: string;
  locale: 'th' | 'en';
  location: 'header' | 'footer';
  kind: 'home' | 'page' | 'custom';
  label: string;
  page_id: string | null;
  url: string | null;
  position: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type MediaState = 'ready' | 'deleting' | 'delete_failed';
export type ReservationState = 'pending' | 'finalized' | 'expired';

export interface MediaFolderTable {
  id: Generated<string>;
  owner_id: string;
  name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MediaItemTable {
  id: Generated<string>;
  owner_id: string;
  folder_id: string | null;
  object_key: string;
  original_name: string;
  mime_type: SupportedImageType;
  size_bytes: ColumnType<string, number, number>;
  checksum_sha256: string;
  width: number;
  height: number;
  alt_text: string | null;
  state: MediaState;
  delete_error_code: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MediaUploadReservationTable {
  id: Generated<string>;
  owner_id: string;
  folder_id: string | null;
  object_key: string;
  original_name: string;
  mime_type: SupportedImageType;
  expected_size_bytes: ColumnType<string, number, number>;
  expected_checksum_sha256: string;
  alt_text: string | null;
  state: ReservationState;
  expires_at: RequiredTimestamp;
  finalized_at: Timestamp | null;
  created_at: Timestamp;
}

export interface PreviewTokenTable {
  id: string;
  owner_id: string;
  token_hash: string;
  content_type: 'post' | 'page';
  content_id: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
}
