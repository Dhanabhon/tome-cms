import { useEffect, useRef, useState } from 'react';

import { ACCEPTED_IMAGE_TYPES, COVER_IMAGE_GUIDANCE } from '../../lib/media';
import type { MediaAsset, PostCategory } from '../../types/cms';
import MediaPicker from './MediaPicker';

interface PostSettingsDrawerProps {
  categories: PostCategory[];
  coverAsset: MediaAsset | null;
  coverImage: string;
  errorMessage: string | null;
  metaDescription: string;
  metaTitle: string;
  onChangeCategories: (value: string[]) => void;
  onChangeMetaDescription: (value: string) => void;
  onChangeMetaTitle: (value: string) => void;
  onChangeSlug: (value: string) => void;
  onChooseCover: (asset: MediaAsset) => void;
  onClose: () => void;
  onManageCategories: () => void;
  onRemoveCover: () => void;
  onUploadCover: (file: File, input: HTMLInputElement) => Promise<void>;
  open: boolean;
  selectedCategoryIds: string[];
  slug: string;
  uploadingCover: boolean;
}

export default function PostSettingsDrawer({
  categories, coverAsset, coverImage, errorMessage, metaDescription, metaTitle,
  onChangeCategories, onChangeMetaDescription, onChangeMetaTitle, onChangeSlug, onChooseCover,
  onClose, onManageCategories, onRemoveCover, onUploadCover, open, selectedCategoryIds, slug, uploadingCover,
}: PostSettingsDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const coverPickerTrigger = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    closeButton.current?.focus();
    return () => {
      element.close();
      opener?.focus();
    };
  }, [open]);

  const lowResolution = coverAsset && (
    coverAsset.width < COVER_IMAGE_GUIDANCE.recommendedMinWidth
    || coverAsset.height < COVER_IMAGE_GUIDANCE.recommendedMinHeight
  );

  return (
    <dialog aria-label="Post settings" className="admin-editor-settings" onCancel={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      onClose();
    }} ref={dialog}>
      <div className="admin-editor-settings__head">
        <div><h2>Post settings</h2><p>URL, search and answer previews, and cover image.</p></div>
        <button autoFocus aria-label="Close settings" className="admin-button admin-button--secondary" onClick={onClose} ref={closeButton} type="button">Close</button>
      </div>
      {errorMessage && <p className="admin-alert" role="alert">{errorMessage}</p>}
      <label className="admin-field">
        <span>Slug</span>
        <input className="admin-control" onChange={(event) => onChangeSlug(event.target.value)} placeholder="post-slug" type="text" value={slug} />
        <small>Used in the post URL.</small>
      </label>
      <fieldset aria-describedby="category-fallback-help" className="admin-field">
        <legend>Categories</legend>
        {[...categories].sort((left, right) => Number(right.is_default) - Number(left.is_default) || left.name.localeCompare(right.name)).map((category) => (
          <label className="flex items-center gap-2 py-2" key={category.id}>
            <input
              checked={selectedCategoryIds.includes(category.id)}
              disabled={category.is_default && categories.some(({ id, is_default }) => !is_default && selectedCategoryIds.includes(id))}
              onChange={(event) => onChangeCategories(event.target.checked
                ? [...selectedCategoryIds, category.id]
                : selectedCategoryIds.filter((id) => id !== category.id))}
              type="checkbox"
            />
            <span>{category.name}</span>
          </label>
        ))}
        <small id="category-fallback-help">Uncategorized is used when no custom categories are selected.</small>
        <button className="admin-button admin-button--secondary" onClick={onManageCategories} type="button">Manage categories</button>
      </fieldset>
      <label className="admin-field">
        <span>Meta title <small>{metaTitle.length}/70</small></span>
        <input className="admin-control" maxLength={70} onChange={(event) => onChangeMetaTitle(event.target.value)} placeholder="Optional search result title" type="text" value={metaTitle} />
        <small>Falls back automatically when empty.</small>
      </label>
      <label className="admin-field">
        <span>Meta description <small>{metaDescription.length}/320</small></span>
        <textarea className="admin-control admin-control--textarea" maxLength={320} onChange={(event) => onChangeMetaDescription(event.target.value)} placeholder="A concise summary or direct answer" value={metaDescription} />
        <small>Shown below the article title and reused in search and social metadata.</small>
      </label>
      <div className="admin-field">
        <span>Cover image</span>
        <div className="admin-cover-actions">
          <button className="admin-button admin-button--secondary" onClick={() => setPickerOpen(true)} ref={coverPickerTrigger} type="button">Choose from library</button>
          <label className="admin-upload" data-state={uploadingCover ? 'loading' : undefined}>
            <input aria-label="Upload new" className="sr-only" accept={ACCEPTED_IMAGE_TYPES.join(',')} disabled={uploadingCover} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void onUploadCover(file, event.currentTarget);
            }} type="file" />
            {uploadingCover ? 'Uploading…' : 'Upload new'}
          </label>
          {coverImage && <button className="admin-button admin-button--secondary" onClick={onRemoveCover} type="button">Remove</button>}
        </div>
        <input name="coverImage" type="hidden" value={coverImage} />
        <p className="admin-cover-help">
          Recommended: {COVER_IMAGE_GUIDANCE.recommendedWidth} × {COVER_IMAGE_GUIDANCE.recommendedHeight} px (16:9).
          {' '}Minimum: {COVER_IMAGE_GUIDANCE.recommendedMinWidth} × {COVER_IMAGE_GUIDANCE.recommendedMinHeight} px.
          {' '}Best: WebP or JPEG; PNG and AVIF are also supported. GIF is accepted but discouraged for covers, especially when animated.
          {' '}Aim for {COVER_IMAGE_GUIDANCE.recommendedMaxBytes / 1024 / 1024} MB or less; {COVER_IMAGE_GUIDANCE.hardLimitBytes / 1024 / 1024} MB maximum.
        </p>
        {lowResolution && <p className="admin-cover-warning" role="status">This image is below the recommended minimum of {COVER_IMAGE_GUIDANCE.recommendedMinWidth} × {COVER_IMAGE_GUIDANCE.recommendedMinHeight} px.</p>}
        {coverImage && <img alt="Current cover" className="admin-cover-preview" src={coverImage} />}
      </div>
      {pickerOpen && <MediaPicker onCancel={() => setPickerOpen(false)} onSelect={(asset) => {
        setPickerOpen(false);
        onChooseCover(asset);
      }} returnFocus={coverPickerTrigger.current} />}
    </dialog>
  );
}
