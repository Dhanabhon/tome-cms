import type { ColumnType } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface AppMetadataTable {
  key: string;
  value: string;
  updated_at: Timestamp;
}

export interface Database {
  app_metadata: AppMetadataTable;
}
