import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table media_folders (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null references "user"(id) on delete cascade,
      name text not null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      unique (id, owner_id),
      constraint media_folders_name_check check (name = btrim(name) and char_length(name) between 1 and 80)
    );

    create table media_items (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null references "user"(id) on delete cascade,
      folder_id uuid,
      object_key text not null unique,
      original_name text not null,
      mime_type text not null,
      size_bytes bigint not null,
      checksum_sha256 text not null,
      width integer not null,
      height integer not null,
      alt_text text,
      state text not null default 'ready',
      delete_error_code text,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      unique (id, owner_id),
      constraint media_items_folder_owner_fkey foreign key (folder_id, owner_id)
        references media_folders(id, owner_id) on delete set null (folder_id),
      constraint media_items_object_key_check check (
        object_key = btrim(object_key)
        and char_length(object_key) between 1 and 1024
        and object_key !~ '[[:cntrl:]]'
        and strpos(object_key, chr(92)) = 0
      ),
      constraint media_items_original_name_check check (
        original_name = btrim(original_name) and char_length(original_name) between 1 and 255
      ),
      constraint media_items_mime_type_check check (mime_type in ('image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp')),
      constraint media_items_size_check check (size_bytes between 1 and 8388608),
      constraint media_items_dimensions_check check (width between 1 and 100000 and height between 1 and 100000),
      constraint media_items_checksum_check check (checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
      constraint media_items_alt_text_check check (alt_text is null or char_length(alt_text) <= 300),
      constraint media_items_state_check check (state in ('ready', 'deleting', 'delete_failed')),
      constraint media_items_delete_error_check check (
        (state = 'delete_failed' and delete_error_code is not null and char_length(delete_error_code) between 1 and 64)
        or (state in ('ready', 'deleting') and delete_error_code is null)
      )
    );

    create table media_upload_reservations (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null references "user"(id) on delete cascade,
      folder_id uuid,
      object_key text not null unique,
      original_name text not null,
      mime_type text not null,
      expected_size_bytes bigint not null,
      expected_checksum_sha256 text not null,
      alt_text text,
      state text not null default 'pending',
      expires_at timestamptz not null,
      finalized_at timestamptz,
      created_at timestamptz not null default current_timestamp,
      constraint media_upload_reservations_folder_owner_fkey foreign key (folder_id, owner_id)
        references media_folders(id, owner_id) on delete set null (folder_id),
      constraint media_upload_reservations_object_key_check check (
        object_key = btrim(object_key)
        and char_length(object_key) between 1 and 1024
        and object_key !~ '[[:cntrl:]]'
        and strpos(object_key, chr(92)) = 0
      ),
      constraint media_upload_reservations_original_name_check check (
        original_name = btrim(original_name) and char_length(original_name) between 1 and 255
      ),
      constraint media_upload_reservations_mime_type_check check (mime_type in ('image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp')),
      constraint media_upload_reservations_size_check check (expected_size_bytes between 1 and 8388608),
      constraint media_upload_reservations_checksum_check check (expected_checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
      constraint media_upload_reservations_alt_text_check check (alt_text is null or char_length(alt_text) <= 300),
      constraint media_upload_reservations_expiry_check check (expires_at > created_at),
      constraint media_upload_reservations_state_check check (
        (state = 'finalized' and finalized_at is not null)
        or (state in ('pending', 'expired') and finalized_at is null)
      )
    );

    create unique index media_folders_owner_name_key on media_folders (owner_id, lower(name));
    create index media_items_owner_ready_idx on media_items (owner_id, created_at desc, id) where state = 'ready';
    create index media_items_owner_folder_idx on media_items (owner_id, folder_id, created_at desc, id) where state = 'ready';
    create index media_upload_reservations_cleanup_idx on media_upload_reservations (expires_at, id) where state in ('pending', 'expired');
    create index posts_content_json_media_idx on posts using gin (content_json jsonb_path_ops);
    create index pages_content_json_media_idx on pages using gin (content_json jsonb_path_ops);

    alter table site_settings alter column author_avatar_media_id type uuid using author_avatar_media_id::uuid;
    alter table posts add constraint posts_cover_media_owner_fkey
      foreign key (cover_media_id, owner_id) references media_items(id, owner_id) on delete set null (cover_media_id);
    alter table site_settings add constraint site_settings_avatar_media_owner_fkey
      foreign key (author_avatar_media_id, owner_id) references media_items(id, owner_id) on delete set null (author_avatar_media_id);

    create trigger media_folders_touch_updated_at before update on media_folders
      for each row execute function tomecms_touch_updated_at();
    create trigger media_items_touch_updated_at before update on media_items
      for each row execute function tomecms_touch_updated_at();

    create function tomecms_guard_media_reservation() returns trigger
    language plpgsql as $$
    begin
      if new.owner_id is distinct from old.owner_id
        or new.object_key is distinct from old.object_key
        or new.original_name is distinct from old.original_name
        or new.mime_type is distinct from old.mime_type
        or new.expected_size_bytes is distinct from old.expected_size_bytes
        or new.expected_checksum_sha256 is distinct from old.expected_checksum_sha256
        or new.alt_text is distinct from old.alt_text
        or new.expires_at is distinct from old.expires_at
      then
        raise exception 'Upload reservation details cannot be changed.' using errcode = '23514';
      end if;
      if old.state in ('finalized', 'expired') and new.state is distinct from old.state then
        raise exception 'Upload reservation state is terminal.' using errcode = '23514';
      end if;
      if old.state = 'finalized' and new.finalized_at is distinct from old.finalized_at then
        raise exception 'Upload reservation finalization is immutable.' using errcode = '23514';
      end if;
      return new;
    end;
    $$;

    create trigger media_upload_reservations_guard before update on media_upload_reservations
      for each row execute function tomecms_guard_media_reservation();
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table site_settings drop constraint site_settings_avatar_media_owner_fkey;
    alter table posts drop constraint posts_cover_media_owner_fkey;
    alter table site_settings alter column author_avatar_media_id type text using author_avatar_media_id::text;
    drop index pages_content_json_media_idx;
    drop index posts_content_json_media_idx;
    drop table media_upload_reservations;
    drop table media_items;
    drop table media_folders;
    drop function tomecms_guard_media_reservation();
  `.execute(db);
}
