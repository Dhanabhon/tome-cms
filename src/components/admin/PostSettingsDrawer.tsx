import { useEffect, useRef, useState } from 'react';

import { fill, type AdminCopy } from '../../lib/admin-i18n';
import { postPath } from '../../lib/i18n';
import { COVER_IMAGE_GUIDANCE, MAX_IMAGE_BYTES } from '../../lib/media';
import type { MediaAsset, PostCategory, PostLocale } from '../../types/cms';
import MediaPicker from './MediaPicker';
import AdminIcon from './AdminIcon';

interface PostSettingsDrawerProps {
  categories: PostCategory[];
  copy: AdminCopy;
  coverImage: string | null;
  errorMessage: string | null;
  metaDescription: string;
  metaTitle: string;
  onChangeCategories: (value: string[]) => void;
  onChangeCover: (asset: MediaAsset | null) => void;
  onChangeMetaDescription: (value: string) => void;
  onChangeMetaTitle: (value: string) => void;
  onChangeSlug: (value: string) => void;
  locale: PostLocale;
  onClose: () => void;
  onManageCategories: () => void;
  open: boolean;
  ownerLocale?: PostLocale | null;
  selectedCategoryIds: string[];
  slug: string;
}

export default function PostSettingsDrawer({
  categories, copy, coverImage, errorMessage, locale, metaDescription, metaTitle,
  onChangeCategories, onChangeCover, onChangeMetaDescription, onChangeMetaTitle, onChangeSlug,
  onClose, onManageCategories, open, ownerLocale, selectedCategoryIds, slug,
}: PostSettingsDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const coverButton = useRef<HTMLButtonElement>(null);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  /* Built by the same function that builds the real link, so the two cannot drift. */
  const slugPrefix = postPath({ locale, slug: '' });

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
    <dialog aria-label={copy.drawer.postSettings} className="admin-editor-settings" onCancel={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      onClose();
    }} ref={dialog}>
      <div className="admin-editor-settings__head">
        <div><h2>{copy.drawer.postSettings}</h2><p>{copy.drawer.postSettingsHint}</p></div>
        <button autoFocus aria-label={copy.drawer.closeSettings} className="admin-button admin-button--ghost admin-button--icon" onClick={onClose} ref={closeButton} title={copy.drawer.closeSettings} type="button"><AdminIcon name="close" /></button>
      </div>
      {errorMessage && <p className="admin-alert" role="alert">{errorMessage}</p>}

      <section className="drawer-group">
        <h3>{copy.drawer.publishing}</h3>
        <label className="admin-field">
          <span>{copy.drawer.slug}</span>
          <div className="admin-control admin-control--prefixed">
            <span>{slugPrefix}</span>
            <input onChange={(event) => onChangeSlug(event.target.value)} placeholder="post-slug" type="text" value={slug} />
          </div>
          <small>{copy.drawer.slugHintPost}</small>
        </label>
        <fieldset aria-describedby="category-fallback-help" className="admin-field">
          <legend>{copy.drawer.categories}</legend>
          <div className="drawer-checks">
            {[...categories].sort((left, right) => Number(right.is_default) - Number(left.is_default) || left.name.localeCompare(right.name)).map((category) => (
              <label key={category.id}>
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
          </div>
          <small id="category-fallback-help">{copy.drawer.categoryFallback}</small>
          <button className="admin-button admin-button--secondary" onClick={onManageCategories} type="button">{copy.posts.manageCategories}</button>
        </fieldset>
      </section>

      <section className="drawer-group">
        <h3>{copy.drawer.coverImage}</h3>
        <div className="admin-field">
          {coverImage && <img alt="" className="admin-cover-preview" src={coverImage} />}
          <div className="admin-cover-actions">
            <button aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={() => setCoverPickerOpen(true)} ref={coverButton} type="button">
              {coverImage ? copy.drawer.changeImage : copy.drawer.chooseImage}
            </button>
            {coverImage && <button aria-label={copy.drawer.removeCover} className="admin-button admin-button--ghost admin-button--icon admin-cover-remove" onClick={() => onChangeCover(null)} title={copy.drawer.removeCover} type="button"><AdminIcon name="trash" /></button>}
          </div>
          <small className="admin-cover-help">
            {fill(copy.drawer.coverHelp, {
              height: COVER_IMAGE_GUIDANCE.recommendedHeight,
              max: MAX_IMAGE_BYTES / 1024 / 1024,
              recommended: COVER_IMAGE_GUIDANCE.recommendedMaxBytes / 1024 / 1024,
              width: COVER_IMAGE_GUIDANCE.recommendedWidth,
            })}
          </small>
        </div>
      </section>

      <section className="drawer-group">
        <h3>{copy.drawer.searchPreview}</h3>
        <label className="admin-field">
          <span>{copy.drawer.metaTitle} <small>{metaTitle.length}/70</small></span>
          <input className="admin-control" maxLength={70} onChange={(event) => onChangeMetaTitle(event.target.value)} placeholder={copy.drawer.metaTitlePlaceholder} type="text" value={metaTitle} />
          <small>{copy.drawer.metaTitleHint}</small>
        </label>
        <label className="admin-field">
          <span>{copy.drawer.metaDescription} <small>{metaDescription.length}/320</small></span>
          <textarea className="admin-control admin-control--textarea" maxLength={320} onChange={(event) => onChangeMetaDescription(event.target.value)} placeholder={copy.drawer.metaDescriptionPlaceholder} value={metaDescription} />
          <small>{copy.drawer.metaDescriptionHintPost}</small>
        </label>
      </section>
    </dialog>
    {coverPickerOpen && <MediaPicker
      onCancel={() => setCoverPickerOpen(false)}
      ownerLocale={ownerLocale}
      onSelect={(asset) => { onChangeCover(asset); setCoverPickerOpen(false); }}
      returnFocus={coverButton.current}
    />}
  </>);
}
