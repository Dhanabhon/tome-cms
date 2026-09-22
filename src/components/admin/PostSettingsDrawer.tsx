import { useRef, useState } from 'react';

import { useDrawer } from './useDrawer';

import { fill, type AdminCopy } from '../../lib/admin-i18n';
import { postPath } from '../../lib/i18n';
import { COVER_IMAGE_GUIDANCE, MAX_IMAGE_BYTES } from '../../lib/media';
import type { MediaAsset, PostCategory, PostLocale } from '../../types/cms';
import MediaPicker from './MediaPicker';
import Icon from '../Icon';
import { fromLocalInput, toLocalInput } from '../../lib/local-datetime';
import ExcerptSuggestion from './ExcerptSuggestion';
import { atLeast } from '../../lib/busy';

export interface CategorySuggestion {
  /** Likely is offered as a suggestion; possible as a maybe, apart from them. */
  band: 'likely' | 'possible';
  id: string;
  name: string;
}

interface PostSettingsDrawerProps {
  /** Absent when this installation has no key for it. */
  onSuggestExcerpt?: () => Promise<string | null>;
  /** Absent on the same terms. */
  onSuggestDescription?: () => Promise<string | null>;
  /** Absent when this installation has no key for it, which is the usual case. */
  onSuggestCategories?: () => Promise<CategorySuggestion[]>;
  publishedAt: string | null;
  onChangePublishedAt: (value: string | null) => void;
  categories: PostCategory[];
  copy: AdminCopy;
  coverImage: string | null;
  errorMessage: string | null;
  excerpt: string;
  metaDescription: string;
  metaTitle: string;
  onChangeCategories: (value: string[]) => void;
  onChangeCover: (asset: MediaAsset | null) => void;
  onChangeExcerpt: (value: string) => void;
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
  categories, copy, coverImage, errorMessage, excerpt, locale, metaDescription, metaTitle,
  onChangeCategories, onChangeCover, onChangeExcerpt, onChangeMetaDescription, onChangeMetaTitle, onChangeSlug,
  onChangePublishedAt, onSuggestDescription, onSuggestExcerpt, onClose, onManageCategories, onSuggestCategories, open, ownerLocale, publishedAt, selectedCategoryIds, slug,
}: PostSettingsDrawerProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<CategorySuggestion[] | null>(null);
  const [suggestFailed, setSuggestFailed] = useState(false);
  const coverButton = useRef<HTMLButtonElement>(null);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  /* Built by the same function that builds the real link, so the two cannot drift. */
  const slugPrefix = postPath({ locale, slug: '' });

  const { close, dialog } = useDrawer({ focus: closeButton, onClose, open });

  return (<>
    <dialog aria-label={copy.drawer.postSettings} className="admin-editor-settings" onCancel={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      close();
    }} ref={dialog}>
      <div className="admin-editor-settings__head">
        <div><h2>{copy.drawer.postSettings}</h2><p>{copy.drawer.postSettingsHint}</p></div>
        <button autoFocus aria-label={copy.drawer.closeSettings} className="admin-button admin-button--ghost admin-button--icon" onClick={() => close()} ref={closeButton} title={copy.drawer.closeSettings} type="button"><Icon name="close" /></button>
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
        <label className="admin-field">
          <span>{copy.drawer.publishAt}</span>
          <input
            className="admin-control"
            onChange={(event) => onChangePublishedAt(fromLocalInput(event.target.value))}
            type="datetime-local"
            value={toLocalInput(publishedAt)}
          />
          <small>{copy.drawer.publishAtHint}</small>
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
          {onSuggestCategories && (
            <div className="drawer-suggest">
              <button
                aria-busy={suggesting}
                className="admin-button admin-button--secondary"
                disabled={suggesting}
                onClick={() => {
                  setSuggesting(true);
                  setSuggested(null);
                  setSuggestFailed(false);
                  void atLeast(onSuggestCategories())
                    .then((found) => setSuggested(found.filter(({ id }) => !selectedCategoryIds.includes(id))))
                    // Not an empty answer: "nothing matches" would be a claim nobody made.
                    .catch(() => setSuggestFailed(true))
                    .finally(() => setSuggesting(false));
                }}
                type="button"
              >
                {copy.drawer.suggestCategories}
              </button>
              {/* The words live beside the button, so it keeps its width while it spins. */}
              {suggesting && <small role="status">{copy.drawer.suggestingCategories}</small>}
              {/* Offered, never applied: the owner files their own writing, and a wrong
                  guess costs a glance rather than a correction. */}
              {(['likely', 'possible'] as const).map((band) => {
                const inBand = suggested?.filter((suggestion) => suggestion.band === band) ?? [];
                if (!inBand.length) return null;
                return (
                  <div className="drawer-suggest__band" data-band={band} key={band}>
                    {/* The maybes are named as such: the model said it was not sure, and the
                        screen should not make it sound as if it were. */}
                    {band === 'possible' && <small>{copy.drawer.suggestCategoriesPossible}</small>}
                    {inBand.map((suggestion) => (
                      <button
                        className="admin-chip"
                        key={suggestion.id}
                        onClick={() => {
                          onChangeCategories([...selectedCategoryIds, suggestion.id]);
                          setSuggested((rest) => rest?.filter(({ id }) => id !== suggestion.id) ?? null);
                        }}
                        type="button"
                      >
                        + {suggestion.name}
                      </button>
                    ))}
                  </div>
                );
              })}
              {suggested?.length === 0 && <small>{copy.drawer.suggestCategoriesEmpty}</small>}
              {suggestFailed && <small role="status">{copy.drawer.suggestUnavailable}</small>}
            </div>
          )}
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
            {coverImage && <button aria-label={copy.drawer.removeCover} className="admin-button admin-button--ghost admin-button--icon admin-cover-remove" onClick={() => onChangeCover(null)} title={copy.drawer.removeCover} type="button"><Icon name="trash" /></button>}
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

      {/* Not under Search preview: that sentence is written for a search result, and this
          one is written for someone deciding what to open. They were the same field until
          now, which is why a card and a snippet could not be changed apart. */}
      <section className="drawer-group">
        <h3>{copy.drawer.homepageCard}</h3>
        <label className="admin-field">
          <span>{copy.drawer.excerpt} <small>{excerpt.length}/120</small></span>
          <textarea className="admin-control admin-control--textarea" maxLength={120} onChange={(event) => onChangeExcerpt(event.target.value)} placeholder={copy.drawer.excerptPlaceholder} value={excerpt} />
          <small>{copy.drawer.excerptHint}</small>
        </label>
        {onSuggestExcerpt && <ExcerptSuggestion copy={copy} onSuggest={onSuggestExcerpt} onUse={onChangeExcerpt} />}
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
        {onSuggestDescription && <ExcerptSuggestion copy={copy} onSuggest={onSuggestDescription} onUse={onChangeMetaDescription} purpose="description" />}
      </section>
    </dialog>
    {coverPickerOpen && <MediaPicker
      kind="image"
      onCancel={() => setCoverPickerOpen(false)}
      ownerLocale={ownerLocale}
      onSelect={(asset) => { onChangeCover(asset); setCoverPickerOpen(false); }}
      returnFocus={coverButton.current}
    />}
  </>);
}
