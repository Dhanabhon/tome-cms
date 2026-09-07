import { useEffect, useRef } from 'react';

interface PageSettingsDrawerProps {
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
  errorMessage, metaDescription, metaTitle, onChangeMetaDescription,
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
    <dialog aria-label="Page settings" className="admin-editor-settings" onCancel={(event) => {
      event.preventDefault();
      onClose();
    }} ref={dialog}>
      <div className="admin-editor-settings__head">
        <div><h2>Page settings</h2><p>URL and search previews.</p></div>
        <button autoFocus aria-label="Close settings" className="admin-button admin-button--secondary" onClick={onClose} ref={closeButton} type="button">Close</button>
      </div>
      {errorMessage && <p className="admin-alert" role="alert">{errorMessage}</p>}
      <label className="admin-field">
        <span>Slug</span>
        <input className="admin-control" maxLength={160} onChange={(event) => onChangeSlug(event.target.value)} placeholder="page-slug" type="text" value={slug} />
        <small>Used in the page URL.</small>
      </label>
      <label className="admin-field">
        <span>Meta title <small>{metaTitle.length}/70</small></span>
        <input className="admin-control" maxLength={70} onChange={(event) => onChangeMetaTitle(event.target.value)} placeholder="Optional search result title" type="text" value={metaTitle} />
        <small>Falls back automatically when empty.</small>
      </label>
      <label className="admin-field">
        <span>Meta description <small>{metaDescription.length}/320</small></span>
        <textarea className="admin-control admin-control--textarea" maxLength={320} onChange={(event) => onChangeMetaDescription(event.target.value)} placeholder="A concise summary or direct answer" value={metaDescription} />
        <small>Used in search and social metadata.</small>
      </label>
    </dialog>
  );
}
