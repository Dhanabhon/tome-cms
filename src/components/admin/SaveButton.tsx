import type { SaveState } from '../../lib/save-state';
import Icon from '../Icon';

interface SaveButtonProps {
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
 * Both words sit in one grid cell so the button never changes width; the hidden one is
 * visibility: hidden and aria-hidden. A screen reader hears the change from the status beside it.
 */
export default function SaveButton({ disabled = false, label, onClick, savedLabel, savingLabel, state, type = 'button' }: SaveButtonProps) {
  return (
    <>
      <button
        aria-busy={state === 'saving'}
        className="admin-button admin-button--primary admin-save-button"
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
