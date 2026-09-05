import { imageDimensions, imageExtension, validateImageFile } from './media';
import { createBrowserSupabaseClient } from './supabase';
import type { MediaAsset, MediaFolder, MediaItem, SupportedImageType, UploadImageOptions } from '../types/cms';

export const MEDIA_PAGE_SIZE = 48;

export interface ListMediaInput {
  folderId?: string | null;
  page?: number;
  search?: string;
}

export interface MediaPage {
  hasMore: boolean;
  items: MediaAsset[];
}

export interface MediaDraft {
  altText: string;
  folderId: string;
}

export function publicMediaUrl(storagePath: string) {
  return createBrowserSupabaseClient().storage.from('blog-media').getPublicUrl(storagePath).data.publicUrl;
}

function toAsset(item: MediaItem): MediaAsset {
  return { ...item, publicUrl: publicMediaUrl(item.storage_path) };
}

async function mutationUser() {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('Sign in before changing media.');
  return { supabase, user: data.user };
}

function categoryError(error: { code?: string; message: string }) {
  if (error.code === '23505') return new Error('A category with this name already exists.');
  return error;
}

export async function listMediaFolders(): Promise<MediaFolder[]> {
  const { data, error } = await createBrowserSupabaseClient().from('media_folders').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function createMediaFolder(name: string): Promise<MediaFolder> {
  const { supabase, user } = await mutationUser();
  const { data, error } = await supabase
    .from('media_folders')
    .insert({ name: name.trim(), owner_id: user.id })
    .select('*')
    .single();
  if (error) throw categoryError(error);
  return data;
}

export async function renameMediaFolder(id: string, name: string): Promise<MediaFolder> {
  const { supabase, user } = await mutationUser();
  const { data, error } = await supabase
    .from('media_folders')
    .update({ name: name.trim() })
    .eq('id', id)
    .eq('owner_id', user.id)
    .select('*')
    .single();
  if (error) throw categoryError(error);
  return data;
}

export async function deleteMediaFolder(id: string) {
  const { supabase, user } = await mutationUser();
  const { error } = await supabase.from('media_folders').delete().eq('id', id).eq('owner_id', user.id);
  if (error) throw error;
}

export async function saveMediaDraft(id: string, draft: MediaDraft): Promise<MediaItem> {
  const { supabase, user } = await mutationUser();
  if (draft.altText.length > 300) throw new Error('Alt text must be 300 characters or fewer.');
  const { data, error } = await supabase
    .from('media_items')
    .update({ alt_text: draft.altText.trim() || null, folder_id: draft.folderId || null })
    .eq('id', id)
    .eq('owner_id', user.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listMedia(input: ListMediaInput = {}): Promise<MediaPage> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const start = (page - 1) * MEDIA_PAGE_SIZE;
  const searchTerm = input.search
    ?.trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
  const searchPattern = searchTerm?.trim().replace(/\s+/g, '%');
  let query = createBrowserSupabaseClient()
    .from('media_items')
    .select('*')
    .order('created_at', { ascending: false })
    .range(start, start + MEDIA_PAGE_SIZE);

  if (input.folderId === null) query = query.is('folder_id', null);
  else if (input.folderId) query = query.eq('folder_id', input.folderId);
  if (searchPattern) {
    query = query.or(`original_name.ilike.%${searchPattern}%,alt_text.ilike.%${searchPattern}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return {
    hasMore: data.length > MEDIA_PAGE_SIZE,
    items: data.slice(0, MEDIA_PAGE_SIZE).map(toAsset),
  };
}

export async function uploadImage(file: File, options: UploadImageOptions = {}): Promise<MediaAsset> {
  validateImageFile(file);
  const dimensions = await imageDimensions(file);
  const supabase = createBrowserSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error('Sign in before uploading images.');

  const extension = imageExtension(file.type);
  if (!extension) throw new Error('Unsupported image type.');
  const storagePath = `${userData.user.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from('blog-media').upload(storagePath, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data, error: metadataError } = await supabase
    .from('media_items')
    .insert({
      alt_text: options.altText?.trim() || null,
      folder_id: options.folderId ?? null,
      height: dimensions.height,
      mime_type: file.type as SupportedImageType,
      original_name: file.name,
      owner_id: userData.user.id,
      size_bytes: file.size,
      storage_path: storagePath,
      width: dimensions.width,
    })
    .select('*')
    .single();

  if (metadataError) {
    const { error: cleanupError } = await supabase.storage.from('blog-media').remove([storagePath]);
    if (cleanupError) throw new Error(`${metadataError.message} Cleanup also failed: ${cleanupError.message}`);
    throw metadataError;
  }

  return { ...data, publicUrl: publicMediaUrl(data.storage_path) };
}
