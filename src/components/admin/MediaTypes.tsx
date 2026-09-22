import type { AdminCopy } from '../../lib/admin-i18n';
import { formatLabel, type MediaTypeFilter } from '../../lib/media';
import UiSelect from './UiSelect';

interface MediaTypesProps {
  copy: AdminCopy;
  /** The choices, in order. Null is every kind; in a file picker, `file` stands for every document. */
  filters: ReadonlyArray<MediaTypeFilter | null>;
  onChange: (filter: MediaTypeFilter | null) => void;
  value: MediaTypeFilter | null;
}

/** PDF and ZIP are called what their cards call them, in every language; the rest are the owner's. */
function filterLabel(filter: MediaTypeFilter | null, copy: AdminCopy): string {
  switch (filter) {
    case null:
    case 'file':
      return copy.media.allTypes;
    case 'image':
      return copy.media.images;
    case 'document':
      return copy.media.documents;
    case 'spreadsheet':
      return copy.media.spreadsheets;
    case 'slides':
      return copy.media.slides;
    case 'pdf':
      return formatLabel('application/pdf');
    case 'zip':
      return formatLabel('application/zip');
  }
}

const key = (filter: MediaTypeFilter | null) => filter ?? 'all';

/** The library's types beside its search: a row of choices on a wide screen, a select on a phone, as its folders are. */
export default function MediaTypes({ copy, filters, onChange, value }: MediaTypesProps) {
  return (
    <div className="media-types">
      <div aria-label={copy.media.fileTypes} className="media-types__choices" role="group">
        {filters.map((filter) => (
          <button aria-pressed={value === filter} className="media-category" key={key(filter)} onClick={() => onChange(filter)} type="button">
            {filterLabel(filter, copy)}
          </button>
        ))}
      </div>
      <div className="media-types__select">
        <span aria-hidden="true" className="media-select-label">{copy.media.fileTypes}</span>
        <UiSelect
          ariaLabel={copy.media.fileTypes}
          className="admin-control"
          id="media-types"
          onValueChange={(next) => onChange(filters.find((filter) => key(filter) === next) ?? null)}
          options={filters.map((filter) => ({ label: filterLabel(filter, copy), value: key(filter) }))}
          value={key(value)}
        />
      </div>
    </div>
  );
}
