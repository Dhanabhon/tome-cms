import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';
import { addDays, addMonths, endOfWeek, formatLocal, isBefore, monthGrid, parseLocal, startOfWeek, todayLocal, type LocalParts } from '../../lib/calendar';
import { placePopover } from '../../lib/popover';
import Icon from '../Icon';

interface UiDateTimeProps {
  ariaDescribedBy?: string;
  disabled?: boolean;
  id: string;
  invalid?: boolean;
  labels: AdminCopy['dateTime'];
  locale: 'en' | 'th';
  /** YYYY-MM-DD: days before it cannot be chosen. */
  min?: string;
  onChange: (value: string) => void;
  required?: boolean;
  /** What a datetime-local held: YYYY-MM-DDTHH:mm, or '' for none. */
  value: string;
}

const TIME_FIELDS = [{ field: 'hour', limit: 23 }, { field: 'minute', limit: 59 }] as const;
type TimeField = (typeof TIME_FIELDS)[number]['field'];

/** A Sunday, so seven days from it are the week's names in order. */
const A_SUNDAY = '2026-09-06';

const tag = (locale: 'en' | 'th') => (locale === 'th' ? 'th-TH' : 'en');
const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The admin's date and time field. A button that says the chosen moment in the owner's language
 * (Thai shows the Buddhist-era year, as the admin's dates do), and a panel with a month grid and
 * two time fields. No system calendar opens anywhere.
 */
export default function UiDateTime({ ariaDescribedBy, disabled = false, id, invalid = false, labels, locale, min, onChange, required = false, value }: UiDateTimeProps) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const focusGrid = useRef(false);
  const parts = parseLocal(value);
  const [open, setOpen] = useState(false);
  const [focusDate, setFocusDate] = useState(parts?.date ?? todayLocal());
  const [typing, setTyping] = useState<{ field: TimeField; text: string } | null>(null);
  const today = todayLocal();
  const panelId = `${id}-panel`;
  const monthId = `${id}-month`;

  const commit = (next: LocalParts) => onChange(formatLocal(next));
  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };
  // Moves the focused day, and asks the grid to take the keyboard there once it has rendered.
  const goTo = (date: string) => {
    focusGrid.current = true;
    setFocusDate(date);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  // Before paint, so the panel is never seen in the corner it starts in. Scrolling is listened
  // for in the capture phase: the box that moves is usually a drawer, not the page.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const where = placePopover(trigger.current.getBoundingClientRect(), panel.current.scrollHeight, window.innerHeight,
        parseFloat(getComputedStyle(document.documentElement).fontSize || '16'), { matchWidth: false, maxRows: 40 });
      Object.assign(panel.current.style, {
        // Kept inside the window on a narrow screen, where the field can sit near the right edge.
        insetInlineStart: `${Math.max(8, Math.min(where.left, window.innerWidth - panel.current.offsetWidth - 8))}px`,
        maxHeight: `${where.maxHeight}px`,
        insetBlockStart: where.top === null ? 'auto' : `${where.top}px`,
        insetBlockEnd: where.bottom === null ? 'auto' : `${where.bottom}px`,
      });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // The panel opens with the keyboard on the focused day; after that only a move made in the
  // grid takes it back, so pressing Next month leaves the keyboard on Next month.
  useEffect(() => {
    if (!open || !focusGrid.current) return;
    focusGrid.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus();
  }, [focusDate, open]);

  const chooseDay = (date: string) => {
    if (min && isBefore(date, min)) return;
    commit({ date, hour: parts?.hour ?? 9, minute: parts?.minute ?? 0 });
  };

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusDate, -1),
      ArrowRight: () => addDays(focusDate, 1),
      ArrowUp: () => addDays(focusDate, -7),
      ArrowDown: () => addDays(focusDate, 7),
      PageUp: () => addMonths(focusDate, -1),
      PageDown: () => addMonths(focusDate, 1),
      Home: () => startOfWeek(focusDate),
      End: () => endOfWeek(focusDate),
    };
    if (moves[event.key]) {
      event.preventDefault();
      goTo(moves[event.key]());
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseDay(focusDate);
    }
  };

  // What is typed stays as typed while the field has the keyboard ("1" on its way to "15"); a
  // whole number in range is passed on at once, and the field shows the padded time again on blur.
  const setTime = (field: TimeField, limit: number, raw: string) => {
    const text = raw.replace(/\D/g, '').slice(0, 2);
    setTyping({ field, text });
    if (text === '') return;
    commit({ date: parts?.date ?? focusDate, hour: parts?.hour ?? 9, minute: parts?.minute ?? 0, [field]: Math.min(Number(text), limit) });
  };

  const stamp = (date: string) => new Intl.DateTimeFormat(tag(locale), { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  const triggerLabel = parts
    ? new Intl.DateTimeFormat(tag(locale), { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(`${parts.date}T${pad(parts.hour)}:${pad(parts.minute)}`))
    : labels.placeholder;
  const heading = new Intl.DateTimeFormat(tag(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${focusDate.slice(0, 7)}-01T00:00:00Z`));
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const when = new Date(`${addDays(A_SUNDAY, index)}T00:00:00Z`);
    return {
      long: new Intl.DateTimeFormat(tag(locale), { weekday: 'long', timeZone: 'UTC' }).format(when),
      narrow: new Intl.DateTimeFormat(tag(locale), { weekday: 'narrow', timeZone: 'UTC' }).format(when),
    };
  });
  const cells = monthGrid(focusDate);

  return (
    <div
      className="ui-datetime"
      onBlur={(event) => {
        // Tabbing past the panel closes it, as it does a menu; a press on its blank corner (no target) does not.
        if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          close();
        }
      }}
      ref={root}
    >
      <button
        aria-controls={open ? panelId : undefined}
        aria-describedby={ariaDescribedBy}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-invalid={invalid || undefined}
        className="admin-control ui-datetime__trigger"
        data-empty={parts ? undefined : ''}
        disabled={disabled}
        id={id}
        onClick={() => {
          if (open) return setOpen(false);
          focusGrid.current = true;
          setFocusDate(parts?.date ?? today);
          setOpen(true);
        }}
        ref={trigger}
        type="button"
      >
        <span>{triggerLabel}</span>
        <Icon name="clock" />
      </button>
      {open && (
        <div aria-label={labels.calendar} className="ui-datetime__panel" id={panelId} ref={panel} role="dialog">
          <div className="ui-datetime__head">
            <button aria-label={labels.previousMonth} className="admin-button admin-button--ghost admin-button--icon" onClick={() => setFocusDate(addMonths(focusDate, -1))} type="button"><Icon name="arrowLeft" /></button>
            <p aria-live="polite" className="ui-datetime__month" id={monthId}>{heading}</p>
            <button aria-label={labels.nextMonth} className="admin-button admin-button--ghost admin-button--icon" onClick={() => setFocusDate(addMonths(focusDate, 1))} type="button"><Icon name="arrowRight" /></button>
          </div>
          <div aria-labelledby={monthId} className="ui-datetime__grid" onKeyDown={onGridKey} ref={grid} role="grid">
            <div className="ui-datetime__week" role="row">
              {weekdays.map((day) => <span aria-label={day.long} className="ui-datetime__weekday" key={day.long} role="columnheader">{day.narrow}</span>)}
            </div>
            {Array.from({ length: 6 }, (_, week) => (
              <div className="ui-datetime__week" key={cells[week * 7].date} role="row">
                {cells.slice(week * 7, week * 7 + 7).map((cell) => (
                  <span aria-selected={cell.date === parts?.date} key={cell.date} role="gridcell">
                    <button
                      aria-current={cell.date === today ? 'date' : undefined}
                      aria-label={stamp(cell.date)}
                      className="ui-datetime__day"
                      data-date={cell.date}
                      data-outside={cell.inMonth ? undefined : ''}
                      data-selected={cell.date === parts?.date ? '' : undefined}
                      disabled={Boolean(min && isBefore(cell.date, min))}
                      onClick={() => { setFocusDate(cell.date); chooseDay(cell.date); }}
                      tabIndex={cell.date === focusDate ? 0 : -1}
                      type="button"
                    >
                      {Number(cell.date.slice(8))}
                    </button>
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="ui-datetime__time">
            {TIME_FIELDS.map(({ field, limit }) => (
              <Fragment key={field}>
                {field === 'minute' && <span aria-hidden="true">:</span>}
                <label>{labels[field]}
                  <input
                    autoComplete="off"
                    className="admin-control"
                    inputMode="numeric"
                    maxLength={2}
                    onBlur={() => setTyping(null)}
                    onChange={(event) => setTime(field, limit, event.target.value)}
                    onFocus={(event) => event.target.select()}
                    value={typing?.field === field ? typing.text : parts ? pad(parts[field]) : ''}
                  />
                </label>
              </Fragment>
            ))}
          </div>
          <div className="ui-datetime__foot">
            {!required && <button className="admin-button admin-button--ghost" onClick={() => { onChange(''); close(); }} type="button">{labels.clear}</button>}
            <button className="admin-button admin-button--primary" onClick={() => close()} type="button">{labels.done}</button>
          </div>
        </div>
      )}
    </div>
  );
}
