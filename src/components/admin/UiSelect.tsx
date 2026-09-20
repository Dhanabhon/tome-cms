import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

/** The gap between the trigger and its list, and the shortest list worth opening. */
const GAP = 4;
const MIN_HEIGHT = 120;
const MAX_ROWS = 20;

export interface UiSelectOption {
  label: string;
  value: string;
}

interface UiSelectProps {
  ariaDescribedBy?: string;
  ariaLabel?: string;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  id: string;
  invalid?: boolean;
  name?: string;
  onValueChange?: (value: string) => void;
  options: UiSelectOption[];
  value?: string;
}

export default function UiSelect({
  ariaDescribedBy,
  ariaLabel,
  className = '',
  defaultValue,
  disabled = false,
  id,
  invalid = false,
  name,
  onValueChange,
  options,
  value,
}: UiSelectProps) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef('');
  const searchTimer = useRef<number>();
  const [internalValue, setInternalValue] = useState(defaultValue ?? options[0]?.value ?? '');
  const [open, setOpen] = useState(false);
  const selectedValue = value ?? internalValue;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === selectedValue));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  /**
   * Where the list goes. It is fixed, so this is the whole of its placement.
   *
   * It opens below unless the list does not fit there and more of it fits above, and it is
   * capped by whichever room it took -- a list can be shorter than it wants, never cut off
   * by something it happens to be inside.
   */
  const place = useCallback(() => {
    const button = trigger.current;
    const list = menu.current;
    if (!button || !list) return;
    const rect = button.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - GAP;
    const above = rect.top - GAP;
    const flip = list.scrollHeight > below && above > below;
    const room = Math.max(flip ? above : below, MIN_HEIGHT);
    const cap = MAX_ROWS * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
    list.style.insetInlineStart = `${rect.left}px`;
    list.style.width = `${rect.width}px`;
    list.style.maxHeight = `${Math.min(room, cap)}px`;
    list.style.insetBlockStart = flip ? 'auto' : `${rect.bottom + GAP}px`;
    list.style.insetBlockEnd = flip ? `${window.innerHeight - rect.top + GAP}px` : 'auto';
  }, []);

  // Before paint, so the list is never seen in the corner it starts in. Scrolling is
  // listened for in the capture phase: the box that moves is usually a dialog, not the page.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const openMenu = () => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (value === undefined) setInternalValue(option.value);
    onValueChange?.(option.value);
    setOpen(false);
    trigger.current?.focus();
  };

  const move = (amount: number) => {
    if (!open) {
      setActiveIndex((selectedIndex + amount + options.length) % options.length);
      setOpen(true);
      return;
    }
    setActiveIndex((current) => (current + amount + options.length) % options.length);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!options.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex);
      else openMenu();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;

    window.clearTimeout(searchTimer.current);
    search.current += event.key.toLocaleLowerCase();
    searchTimer.current = window.setTimeout(() => { search.current = ''; }, 500);
    const match = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(search.current));
    if (match >= 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(match);
    }
  };

  return (
    <div className="ui-select" ref={root}>
      {name && <input name={name} type="hidden" value={selectedValue} />}
      <button
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        aria-controls={listboxId}
        aria-describedby={ariaDescribedBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        className={`${className} ui-select__trigger`.trim()}
        data-state={invalid ? 'error' : undefined}
        data-value={selectedValue}
        disabled={disabled}
        id={id}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={handleKeyDown}
        ref={trigger}
        role="combobox"
        type="button"
      >
        <span className="ui-select__label">{options[selectedIndex]?.label}</span>
        <span aria-hidden="true" className="ui-select__chevron" />
      </button>
      <div className="ui-select__menu" hidden={!open} id={listboxId} ref={menu} role="listbox">
        {options.map((option, index) => (
          <button
            aria-selected={selectedValue === option.value}
            className="ui-select__option"
            data-active={activeIndex === index}
            id={`${id}-option-${index}`}
            key={option.value}
            onClick={() => choose(index)}
            onPointerMove={() => setActiveIndex(index)}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <span>{option.label}</span>
            <span aria-hidden="true">{selectedValue === option.value ? '✓' : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
