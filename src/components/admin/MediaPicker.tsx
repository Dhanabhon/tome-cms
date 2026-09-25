import { useEffect, useRef } from 'react';

import { adminCopy } from '../../lib/admin-i18n';
import type { MediaKind } from '../../lib/media';
import { closeOverlay } from '../../lib/overlay-motion';
import type { MediaAsset, PostLocale } from '../../types/cms';
import MediaLibrary from './MediaLibrary';

interface MediaPickerProps {
  kind: MediaKind;
  onCancel: () => void;
  ownerLocale?: PostLocale | null;
  onSelect: (asset: MediaAsset) => void;
  returnFocus?: HTMLElement | null;
}

export default function MediaPicker({ kind, onCancel, onSelect, ownerLocale, returnFocus }: MediaPickerProps) {
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

  /**
   * Plays the exit, and only then hands the focus back and tells the caller, who unmounts it.
   * `played` is false when the browser has already closed it itself, as an Escape the page may
   * not hold back does: there is no exit left to play.
   */
  const leave = (then: () => void, played = true) => {
    if (completed.current) return;
    completed.current = true;
    const done = () => {
      focusTarget.current?.focus();
      then();
    };
    if (played && dialog.current) void closeOverlay(dialog.current).then(done);
    else done();
  };
  const cancel = () => leave(onCancel);
  const select = (asset: MediaAsset) => leave(() => onSelect(asset));

  return (
    <dialog
      aria-label={copy.media.heading}
      className="media-picker"
      onCancel={(event) => {
        // Chromium lets a page hold Escape back only once the reader has done something on it.
        if (event.cancelable) event.preventDefault();
        leave(onCancel, event.cancelable);
      }}
      ref={dialog}
    >
      <MediaLibrary kind={kind} mode="select" onCancel={cancel} onSelect={select} ownerLocale={ownerLocale} />
    </dialog>
  );
}
