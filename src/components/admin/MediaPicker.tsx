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
  const focusTarget = useRef<HTMLElement | null>(
    returnFocus ?? (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  const cancel = () => {
    dialog.current?.close();
    focusTarget.current?.focus();
    onCancel();
  };

  const select = (asset: MediaAsset) => {
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
