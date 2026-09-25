import { useRef } from 'react';

import { useDrawer } from './useDrawer';

import type { AdminCopy } from '../../lib/admin-i18n';
import { pagePath } from '../../lib/i18n';
import type { PageLocale } from '../../types/cms';
import Icon from '../Icon';
import { fromLocalInput, toLocalInput } from '../../lib/local-datetime';
import ExcerptSuggestion from './ExcerptSuggestion';

interface PageSettingsDrawerProps {
  /** Absent when this installation has no key for it. */
  onSuggestExcerpt?: () => Promise<string | null>;
  /** Absent on the same terms. */
  onSuggestDescription?: () => Promise<string | null>;
  publishedAt: string | null;
  onChangePublishedAt: (value: string | null) => void;
  copy: AdminCopy;
  errorMessage: string | null;
  excerpt: string;
  locale: PageLocale;
  metaDescription: string;
  metaTitle: string;
  onChangeExcerpt: (value: string) => void;
  onChangeMetaDescription: (value: string) => void;
  onChangeMetaTitle: (value: string) => void;
  onChangeSlug: (value: string) => void;
  onClose: () => void;
  open: boolean;
  slug: string;
}

export default function PageSettingsDrawer({
  copy, errorMessage, excerpt, locale, metaDescription, metaTitle, onChangeExcerpt,
  onChangeMetaDescription, onChangeMetaTitle, onChangePublishedAt, onChangeSlug, onSuggestDescription, onSuggestExcerpt, onClose, open, publishedAt, slug,
}: PageSettingsDrawerProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  /* Built by the same function that builds the real link, so the two cannot drift. */
  const slugPrefix = pagePath({ locale, slug: '' });

  const { cancel, close, dialog } = useDrawer({ focus: closeButton, onClose, open });

  return (
    <dialog aria-label={copy.drawer.pageSettings} className="admin-editor-settings" onCancel={cancel} ref={dialog}>
      <div className="admin-editor-settings__head">
        <div><h2>{copy.drawer.pageSettings}</h2><p>{copy.drawer.pageSettingsHint}</p></div>
        <button autoFocus aria-label={copy.drawer.closeSettings} className="admin-button admin-button--ghost admin-button--icon" onClick={() => close()} ref={closeButton} title={copy.drawer.closeSettings} type="button"><Icon name="close" /></button>
      </div>
      {errorMessage && <p className="admin-alert" role="alert">{errorMessage}</p>}
      <section className="drawer-group">
        <h3>{copy.drawer.publishing}</h3>
        <label className="admin-field">
          <span>{copy.drawer.slug}</span>
          <div className="admin-control admin-control--prefixed">
            <span>{slugPrefix}</span>
            <input maxLength={160} onChange={(event) => onChangeSlug(event.target.value)} placeholder="page-slug" type="text" value={slug} />
          </div>
          <small>{copy.drawer.slugHintPage}</small>
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
      </section>

      {/* Apart from Search preview, for the reason a post's is: one of these is written
          for a search result and the other for someone deciding whether to follow a link. */}
      <section className="drawer-group">
        <h3>{copy.drawer.pageSummary}</h3>
        <label className="admin-field">
          <span>{copy.drawer.excerpt} <small>{excerpt.length}/120</small></span>
          <textarea className="admin-control admin-control--textarea" maxLength={120} onChange={(event) => onChangeExcerpt(event.target.value)} placeholder={copy.drawer.excerptPlaceholder} value={excerpt} />
          <small>{copy.drawer.pageExcerptHint}</small>
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
          <small>{copy.drawer.metaDescriptionHintPage}</small>
        </label>
        {onSuggestDescription && <ExcerptSuggestion copy={copy} onSuggest={onSuggestDescription} onUse={onChangeMetaDescription} purpose="description" />}
      </section>
    </dialog>
  );
}
