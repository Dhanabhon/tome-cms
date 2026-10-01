import type { AdminCopy } from '../../lib/admin-i18n';
import type { MediaView } from '../../lib/media-view';
import Icon from '../Icon';

interface MediaViewSwitchProps {
  copy: AdminCopy;
  onChange: (view: MediaView) => void;
  value: MediaView;
}

/** Grid or list: two buttons, one pressed, at the end of the row the filters sit in. */
export default function MediaViewSwitch({ copy, onChange, value }: MediaViewSwitchProps) {
  const choices: ReadonlyArray<{ icon: 'list' | 'table'; label: string; view: MediaView }> = [
    { icon: 'table', label: copy.media.viewGrid, view: 'grid' },
    { icon: 'list', label: copy.media.viewList, view: 'list' },
  ];
  return (
    <div aria-label={copy.media.viewLabel} className="media-view-switch" role="group">
      {choices.map(({ icon, label, view }) => (
        <button aria-label={label} aria-pressed={value === view} className="admin-button admin-button--ghost admin-button--icon" key={view} onClick={() => onChange(view)} title={label} type="button">
          <Icon name={icon} />
        </button>
      ))}
    </div>
  );
}
