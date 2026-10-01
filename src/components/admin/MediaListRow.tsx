import type { MouseEvent, Ref } from 'react';

import { formatBytes, formatLabel, isImageAsset, isPdfAsset } from '../../lib/media';
import type { MediaAsset } from '../../types/cms';

interface MediaListRowProps {
  /** The name a screen reader hears for the file: the card's own, so the two views say the same. */
  label: string;
  item: MediaAsset;
  onChoose: (event: MouseEvent<HTMLButtonElement>) => void;
  /** A PDF's first page as a blob address, once drawn. */
  page: string | undefined;
  /** Asks for a PDF's first page when its tile comes on screen. */
  watch: Ref<HTMLElement>;
  when: Intl.DateTimeFormat;
}

/** One file as a row of the list view: a small tile, its name, and what it is, beside the file's own button. */
export default function MediaListRow({ item, label, onChoose, page, watch, when }: MediaListRowProps) {
  const image = isImageAsset(item) ? item : null;
  const format = formatLabel(item.mime_type);
  return (
    <li>
      <button aria-label={label} className="media-row" onClick={onChoose} type="button">
        {image
          ? <img alt="" className="media-row__tile" height={48} loading="lazy" src={item.publicUrl} width={48} />
          : page
            ? <img alt="" className="media-row__tile media-row__tile--page media-page" src={page} />
            : <span aria-hidden="true" className="media-row__tile media-row__tile--file" data-pdf-id={isPdfAsset(item) ? item.id : undefined} ref={isPdfAsset(item) ? watch : undefined}>{format}</span>}
        <strong className="media-row__name">{item.original_name}</strong>
        <span className="media-row__meta">
          {image && <span>{image.width} × {image.height}</span>}
          <span>{format}</span>
          <span>{formatBytes(item.size_bytes)}</span>
          <time dateTime={item.created_at}>{when.format(new Date(item.created_at))}</time>
        </span>
      </button>
    </li>
  );
}
