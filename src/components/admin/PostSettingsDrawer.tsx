import { useEffect, useRef, useState } from 'react';

import { COVER_IMAGE_GUIDANCE, MAX_IMAGE_BYTES } from '../../lib/media';
import type { MediaAsset, PostCategory } from '../../types/cms';
import MediaPicker from './MediaPicker';

interface PostSettingsDrawerProps {
  categories: PostCategory[];
  coverImage: string | null;
  errorMessage: string | null;
  metaDescription: string;
  metaTitle: string;
  onChangeCategories: (value: string[]) => void;
  onChangeCover: (asset: MediaAsset | null) => void;
  onChangeMetaDescription: (value: string) => void;
  onChangeMetaTitle: (value: string) => void;
  onChangeSlug: (value: string) => void;
  onClose: () => void;
  onManageCategories: () => void;
  open: boolean;
  selectedCategoryIds: string[];
  slug: string;
}

export default function PostSettingsDrawer({
  categories, coverImage, errorMessage, metaDescription, metaTitle,
  onChangeCategories, onChangeCover, onChangeMetaDescription, onChangeMetaTitle, onChangeSlug,
  onClose, onManageCategories, open, selectedCategoryIds, slug,
}: PostSettingsDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const coverButton = useRef<HTMLButtonElement>(null);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);

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

  return (<>
    <dialog aria-label="Post settings" className="admin-editor-settings" onCancel={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      onClose();
    }} ref={dialog}>
      <div className="admin-editor-settings__head">
        <div><h2>Post settings</h2><p>URL, Categories, search, and answer previews.</p></div>
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
      <div className="admin-field">
        <span>Cover image</span>
        {coverImage && <img alt="" className="admin-cover-preview" src={coverImage} />}
        <div className="admin-cover-actions">
          <button aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={() => setCoverPickerOpen(true)} ref={coverButton} type="button">
            {coverImage ? 'Change image' : 'Choose image'}
          </button>
          {coverImage && <button className="admin-button admin-button--secondary" onClick={() => onChangeCover(null)} type="button">Remove</button>}
        </div>
        <small className="admin-cover-help">
          JPEG, PNG, WebP, GIF, or AVIF; up to {MAX_IMAGE_BYTES / 1024 / 1024} MB. Recommended {COVER_IMAGE_GUIDANCE.recommendedWidth} × {COVER_IMAGE_GUIDANCE.recommendedHeight} px and under {COVER_IMAGE_GUIDANCE.recommendedMaxBytes / 1024 / 1024} MB.
        </small>
      </div>
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
    </dialog>
    {coverPickerOpen && <MediaPicker
      onCancel={() => setCoverPickerOpen(false)}
      onSelect={(asset) => { onChangeCover(asset); setCoverPickerOpen(false); }}
      returnFocus={coverButton.current}
    />}
  </>);
}
