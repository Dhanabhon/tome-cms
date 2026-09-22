import { createImageUpload } from 'novel';

import type { AdminCopy } from '../../lib/admin-i18n';
import { declaredMediaType } from '../../lib/media';
import { uploadFailureText, uploadImage as uploadMedia } from '../../lib/media-client';
import { alertUi } from '../../lib/ui-dialog';

export async function uploadImage(file: File): Promise<string> {
  return (await uploadMedia(file)).publicUrl;
}

/** An image dropped or pasted into the editor, and why it was not kept, in its owner's language. */
export function createUploadFn(copy: AdminCopy) {
  const failed = (error: unknown) => void alertUi({
    title: copy.media.imageUploadFailed,
    message: uploadFailureText(error, copy) ?? (error instanceof Error ? error.message : copy.media.imageUploadFailed),
  });
  return createImageUpload({
    validateFn: (file) => {
      try {
        declaredMediaType(file, 'image');
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    onUpload: async (file) => {
      try {
        return await uploadImage(file);
      } catch (error) {
        failed(error);
        throw error;
      }
    },
  });
}
