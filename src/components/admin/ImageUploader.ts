import { createImageUpload } from 'novel';

import { imageExtension, MAX_IMAGE_BYTES } from '../../lib/media';
import { createBrowserSupabaseClient } from '../../lib/supabase';

function imageError(file: File): string | null {
  if (!imageExtension(file.type)) return 'Use a JPEG, PNG, WebP, GIF, or AVIF image.';
  if (!file.size || file.size > MAX_IMAGE_BYTES) return 'Images must be between 1 byte and 8 MB.';
  return null;
}

export async function uploadImage(file: File): Promise<string> {
  const validationError = imageError(file);
  if (validationError) throw new Error(validationError);

  const extension = imageExtension(file.type);
  if (!extension) throw new Error('Unsupported image type.');

  const supabase = createBrowserSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;
  if (!user) throw new Error('Sign in before uploading images.');

  const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('blog-media').upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  });

  if (error) throw error;
  return supabase.storage.from('blog-media').getPublicUrl(path).data.publicUrl;
}

export const uploadFn = createImageUpload({
  validateFn: (file) => {
    const error = imageError(file);
    if (error) window.alert(error);
    return !error;
  },
  onUpload: async (file) => {
    try {
      return await uploadImage(file);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'The image could not be uploaded.');
      throw error;
    }
  },
});

