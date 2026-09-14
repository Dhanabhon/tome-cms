import { useEffect, useRef } from 'react';

import { adminCopy } from '../../lib/admin-i18n';
import type { MediaAsset, PostLocale } from '../../types/cms';
import MediaLibrary from './MediaLibrary';

interface MediaPickerProps {
  onCancel: () => void;
  ownerLocale?: PostLocale | null;
  onSelect: (asset: MediaAsset) => void;
  returnFocus?: HTMLElement | null;
}

export default function MediaPicker({ onCancel, onSelect, ownerLocale, returnFocus }: MediaPickerProps) {
  const copy = adminCopy(ownerLocale);
  const dialog = useRef<HTMLDialogElement>(null);
  const completed = useRef(false);
  const focusTarget = useRef<HTMLElement | null>(
    returnFocus ?? (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      completed.current = true;
      if (element?.open) element.close();
    };
  }, []);

  const cancel = () => {
    if (completed.current) return;
    completed.current = true;
    dialog.current?.close();
    focusTarget.current?.focus();
    onCancel();
  };

  const select = (asset: MediaAsset) => {
    if (completed.current) return;
    completed.current = true;
    dialog.current?.close();
    focusTarget.current?.focus();
    onSelect(asset);
  };

  return (
    <dialog
      aria-label={copy.media.heading}
      className="media-picker"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      ref={dialog}
    >
      <button autoFocus className="media-picker-cancel" onClick={cancel} type="button">{copy.media.cancel}</button>
      <MediaLibrary mode="select" onCancel={cancel} onSelect={select} ownerLocale={ownerLocale} />
    </dialog>
  );
}
