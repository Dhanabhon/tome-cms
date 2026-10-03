import type { SaveState } from '../../lib/save-state';
import Icon from '../Icon';

interface SaveButtonProps {
  describedBy?: string;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  savedLabel: string;
  savingLabel: string;
  state: SaveState;
  type?: 'button' | 'submit';
}

/**
 * The state is on the button: a spinner while saving, "Saved" after, "Save" once something changes.
 * Only a change makes it the screen's primary: unchanged or just saved, it is a secondary button,
 * so an idle Save is never a faded fill beside the screen's real primary.
 * Both words sit in one grid cell so the button never changes width; the hidden one is
 * visibility: hidden and aria-hidden. A screen reader hears the change from the status beside it.
 */
export default function SaveButton({ describedBy, disabled = false, label, onClick, savedLabel, savingLabel, state, type = 'button' }: SaveButtonProps) {
  return (
    <>
      <button
        aria-busy={state === 'saving'}
        aria-describedby={describedBy}
        className={`admin-button ${state === 'dirty' || state === 'saving' ? 'admin-button--primary' : 'admin-button--secondary'} admin-save-button`}
        data-state={state}
        disabled={disabled || state !== 'dirty'}
        onClick={onClick}
        type={type}
      >
        <span aria-hidden={state === 'saved'} className="admin-save-button__label">{label}</span>
        <span aria-hidden={state !== 'saved'} className="admin-save-button__label admin-save-button__label--saved"><Icon name="check" />{savedLabel}</span>
      </button>
      <span className="sr-only" role="status">{state === 'saving' ? savingLabel : state === 'saved' ? savedLabel : ''}</span>
    </>
  );
}
