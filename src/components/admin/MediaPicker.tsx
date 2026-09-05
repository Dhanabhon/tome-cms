import { useEffect, useRef } from 'react';

import type { MediaAsset } from '../../types/cms';
import MediaLibrary from './MediaLibrary';

interface MediaPickerProps {
  onCancel: () => void;
  onSelect: (asset: MediaAsset) => void;
  returnFocus?: HTMLElement | null;
}

export default function MediaPicker({ onCancel, onSelect, returnFocus }: MediaPickerProps) {
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
      aria-label="Media library"
      className="media-picker"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      ref={dialog}
    >
      <button autoFocus className="media-picker-cancel" onClick={cancel} type="button">Cancel</button>
      <MediaLibrary mode="select" onCancel={cancel} onSelect={select} />
    </dialog>
  );
}
