import { useEffect, useRef } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';
import { pagePath } from '../../lib/i18n';
import type { PageLocale } from '../../types/cms';
import Icon from '../Icon';

interface PageSettingsDrawerProps {
  copy: AdminCopy;
  errorMessage: string | null;
  locale: PageLocale;
  metaDescription: string;
  metaTitle: string;
  onChangeMetaDescription: (value: string) => void;
  onChangeMetaTitle: (value: string) => void;
  onChangeSlug: (value: string) => void;
  onClose: () => void;
  open: boolean;
  slug: string;
}

export default function PageSettingsDrawer({
  copy, errorMessage, locale, metaDescription, metaTitle, onChangeMetaDescription,
  onChangeMetaTitle, onChangeSlug, onClose, open, slug,
}: PageSettingsDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  /* Built by the same function that builds the real link, so the two cannot drift. */
  const slugPrefix = pagePath({ locale, slug: '' });

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

  return (
    <dialog aria-label={copy.drawer.pageSettings} className="admin-editor-settings" onCancel={(event) => {
      event.preventDefault();
      onClose();
    }} ref={dialog}>
      <div className="admin-editor-settings__head">
        <div><h2>{copy.drawer.pageSettings}</h2><p>{copy.drawer.pageSettingsHint}</p></div>
        <button autoFocus aria-label={copy.drawer.closeSettings} className="admin-button admin-button--ghost admin-button--icon" onClick={onClose} ref={closeButton} title={copy.drawer.closeSettings} type="button"><Icon name="close" /></button>
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
      </section>
    </dialog>
  );
}
