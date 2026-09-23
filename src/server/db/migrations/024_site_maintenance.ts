import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The owner's switch for closing the site, and the page visitors see while it is closed.
 *
 * On the settings row, which the middleware already reads on every request, so the switch costs
 * no query and takes effect on the next one. A template is refused without what it draws, and
 * the library may not delete the picture from under the page. The words are an object whose
 * shape is checked where it is read (src/lib/site-maintenance.ts).
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table site_settings
      add column maintenance_enabled boolean not null default false,
      add column maintenance_template text not null default 'minimal',
      add column maintenance_copy jsonb not null default '{}'::jsonb,
      add column maintenance_media_id uuid,
      add column maintenance_back_at timestamptz,
      add constraint site_settings_maintenance_template_check
        check (maintenance_template in ('minimal', 'logo', 'picture', 'countdown')),
      add constraint site_settings_maintenance_copy_check check (jsonb_typeof(maintenance_copy) = 'object'),
      add constraint site_settings_maintenance_picture_check
        check (maintenance_template <> 'picture' or maintenance_media_id is not null),
      add constraint site_settings_maintenance_countdown_check
        check (maintenance_template <> 'countdown' or maintenance_back_at is not null),
      add constraint site_settings_maintenance_media_fkey
        foreign key (maintenance_media_id, owner_id) references media_items(id, owner_id) on delete restrict
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table site_settings
      drop constraint site_settings_maintenance_media_fkey,
      drop column maintenance_back_at,
      drop column maintenance_media_id,
      drop column maintenance_copy,
      drop column maintenance_template,
      drop column maintenance_enabled
  `.execute(db);
}
