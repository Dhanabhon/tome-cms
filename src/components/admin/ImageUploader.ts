import { createImageUpload } from 'novel';

import { uploadImage as uploadMedia } from '../../lib/media-client';
import { validateImageFile } from '../../lib/media';
import { alertUi } from '../../lib/ui-dialog';

export async function uploadImage(file: File): Promise<string> {
  return (await uploadMedia(file)).publicUrl;
}

export const uploadFn = createImageUpload({
  validateFn: (file) => {
    try {
      validateImageFile(file);
      return true;
    } catch (error) {
      void alertUi({ title: 'Image upload failed', message: error instanceof Error ? error.message : 'The image is invalid.' });
      return false;
    }
  },
  onUpload: async (file) => {
    try {
      return await uploadImage(file);
    } catch (error) {
      void alertUi({ title: 'Image upload failed', message: error instanceof Error ? error.message : 'The image could not be uploaded.' });
      throw error;
    }
  },
});
