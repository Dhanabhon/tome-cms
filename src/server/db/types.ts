import type { ColumnType, Generated } from 'kysely';

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
  action: 'install' | 'signin' | 'recovery';
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
  admin_path: string;
  author_name: Generated<string>;
  author_avatar_media_id: string | null;
  author_bio_th: Generated<string>;
  author_bio_en: Generated<string>;
  author_links: unknown;
  installed_at: Timestamp;
  updated_at: Timestamp;
}
