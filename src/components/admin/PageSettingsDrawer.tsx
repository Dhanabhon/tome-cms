import { useEffect, useRef } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';

interface PageSettingsDrawerProps {
  copy: AdminCopy;
  errorMessage: string | null;
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
  copy, errorMessage, metaDescription, metaTitle, onChangeMetaDescription,
  onChangeMetaTitle, onChangeSlug, onClose, open, slug,
}: PageSettingsDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

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
        <button autoFocus aria-label={copy.drawer.closeSettings} className="admin-button admin-button--secondary" onClick={onClose} ref={closeButton} type="button">{copy.shell.close}</button>
      </div>
      {errorMessage && <p className="admin-alert" role="alert">{errorMessage}</p>}
      <label className="admin-field">
        <span>{copy.drawer.slug}</span>
        <input className="admin-control" maxLength={160} onChange={(event) => onChangeSlug(event.target.value)} placeholder="page-slug" type="text" value={slug} />
        <small>{copy.drawer.slugHintPage}</small>
      </label>
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
    </dialog>
  );
}
