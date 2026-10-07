import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { placePopover } from '../../lib/popover';
import { scrollTargetFor } from '../../lib/ui-select-scroll';
import Icon from '../Icon';

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
  submitOnChange?: boolean;
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
  submitOnChange = false,
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
   * by something it happens to be inside. Across, it is as wide as its options want and no
   * narrower than the trigger, and lines up with the trigger's end where it would leave the
   * window from its start (see placePopover).
   */
  const place = useCallback(() => {
    const button = trigger.current;
    const list = menu.current;
    if (!button || !list) return;
    // Measured at the width its options want, not the one an earlier placement gave it.
    list.style.minWidth = '';
    list.style.maxWidth = '';
    const where = placePopover(button.getBoundingClientRect(), list.scrollHeight, window.innerHeight,
      parseFloat(getComputedStyle(document.documentElement).fontSize || '16'),
      { gap: GAP, maxRows: MAX_ROWS, minHeight: MIN_HEIGHT, panelWidth: list.offsetWidth, viewportWidth: window.innerWidth });
    list.style.left = `${where.left}px`;
    list.style.right = 'auto';
    list.style.minWidth = where.minWidth === null ? '' : `${where.minWidth}px`;
    list.style.maxWidth = where.maxWidth === null ? '' : `${where.maxWidth}px`;
    list.style.maxHeight = `${where.maxHeight}px`;
    list.style.insetBlockStart = where.top === null ? 'auto' : `${where.top}px`;
    list.style.insetBlockEnd = where.bottom === null ? 'auto' : `${where.bottom}px`;
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

  // The active row is kept in sight when the keyboard moves it, the list opens, or a typed
  // letter finds one past the fold -- not when the pointer does, which would scroll the
  // list out from under it.
  const pointed = useRef(false);
  useLayoutEffect(() => {
    // Cleared on every run, closed or not: a hover committed with the close must not
    // make the next open skip its scroll.
    const wasPointed = pointed.current;
    pointed.current = false;
    if (!open || wasPointed) return;
    // The list's own scroll only: scrollIntoView would also move a dialog or the page under it.
    const list = menu.current;
    const row = list?.children[activeIndex] as HTMLElement | undefined;
    if (!list || !row) return;
    list.scrollTop = scrollTargetFor(list, row, activeIndex, options.length);
  }, [open, activeIndex, options.length]);

  // A list that filters a page submits its form once the new value is in its hidden input.
  const submitPending = useRef(false);
  useEffect(() => {
    if (!submitPending.current) return;
    submitPending.current = false;
    root.current?.closest('form')?.requestSubmit();
  }, [selectedValue]);

  const openMenu = () => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (submitOnChange && option.value !== selectedValue) submitPending.current = true;
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
            onPointerMove={() => {
              if (index === activeIndex) return;
              pointed.current = true;
              setActiveIndex(index);
            }}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <span>{option.label}</span>
            <span aria-hidden="true">{selectedValue === option.value && <Icon name="check" />}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
