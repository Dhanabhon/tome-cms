import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

import { adminCopy, fill } from '../../lib/admin-i18n';
import { wireDetailsMenus } from '../../lib/details-menu';
import { applyDrop, canIndent, canOutdent, dropAction, emptyGroups, fromRows, indent, indentParent, moveBlock, outdent, removeItem, sibling, toMutation, type DropAction, type NavigationDraftItem } from '../../lib/navigation-tree';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import { animateDismissals, closeOverlay } from '../../lib/overlay-motion';
import type { NavigationItem, NavigationKind, NavigationLocation, NavigationMutationItem, Page, PageLocale, PostLocale } from '../../types/cms';
import Icon from '../Icon';
import SaveButton from './SaveButton';
import UiSelect from './UiSelect';
import { atLeast } from '../../lib/busy';
import { saveButtonState } from '../../lib/save-state';

type MenuKey = `${NavigationLocation}:${PageLocale}`;
type PageSummary = Pick<Page, 'id' | 'translation_group_id' | 'locale' | 'title' | 'slug' | 'status'>;
type SavedItem = Omit<NavigationItem, 'owner_id'>;
const languages = [{ value: 'th', label: 'ไทย' }, { value: 'en', label: 'English' }] as const;
const emptyMenus = (): Record<MenuKey, NavigationDraftItem[]> => ({ 'header:th': [], 'header:en': [], 'footer:th': [], 'footer:en': [] });
const cleanMenus = (): Record<MenuKey, boolean> => ({ 'header:th': false, 'header:en': false, 'footer:th': false, 'footer:en': false });
// A group has no target, so any number of them can share a menu.
const target = (item: NavigationMutationItem) => item.kind === 'group' ? null : `${item.kind}:${item.pageId ?? item.url ?? ''}`;
/** How far the pointer moves before a press on the grip becomes a drag, and how near an edge of the window scrolls it. */
const DRAG_START_PX = 4;
const SCROLL_EDGE_PX = 56;

interface NavigationManagerProps {
  ownerLocale?: PostLocale | null;
}

export default function NavigationManager({ ownerLocale }: NavigationManagerProps = {}) {
  const copy = adminCopy(ownerLocale);
  // Autonyms stay in their own language; the rest follows the owner's.
  const locations = [
    { value: 'header', label: copy.navigation.menuBar },
    { value: 'footer', label: copy.navigation.footer },
  ] as const;
  const [menus, setMenus] = useState(emptyMenus);
  const [dirty, setDirty] = useState(cleanMenus);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [location, setLocation] = useState<NavigationLocation>('header');
  // The site's own language first; English when it is not known, as the admin's words are.
  const [locale, setLocale] = useState<PageLocale>(ownerLocale ?? 'en');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  // Save and Retry both save; only the one that was pressed spins.
  const [pressed, setPressed] = useState<'retry' | 'save' | null>(null);
  const [status, setStatus] = useState('');
  // A save confirms the menu that was open; another tab is another menu, so it starts over.
  const [savedOnce, setSavedOnce] = useState(false);
  const [kind, setKind] = useState<NavigationKind>('home');
  const [pageId, setPageId] = useState('');
  const [label, setLabel] = useState(copy.navigation.home);
  const [url, setUrl] = useState('');
  const [newTab, setNewTab] = useState(false);
  const [placement, setPlacement] = useState<NavigationLocation | 'both'>('header');
  const [addError, setAddError] = useState('');
  // The field an empty or malformed submit was about: it is marked, focused, and released as the owner types.
  const [addInvalid, setAddInvalid] = useState<'label' | 'url' | null>(null);
  const savingRef = useRef(false);
  // The item being dragged and where it would land; null when nothing is dragged.
  const [drag, setDrag] = useState<{ id: string; action: DropAction | null } | null>(null);
  const hint = useRef<HTMLParagraphElement>(null);
  // Ends the drag in progress, if any: one drag at a time, and none left running after the screen goes.
  const endDrag = useRef<((drop: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const labelField = useRef<HTMLInputElement>(null);
  const urlField = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const key: MenuKey = `${location}:${locale}`;
  const items = menus[key];
  // An item's label is read by that menu's readers, so it starts in the menu's language.
  const homeLabel = adminCopy(locale).navigation.home;
  const availablePages = pages.filter((page) => page.locale === locale);
  const empty = new Set(emptyGroups(items));
  const missingPages = pages.filter((page) => page.locale !== locale && !availablePages.some((edition) => edition.translation_group_id === page.translation_group_id));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/admin/navigation');
      if (!response.ok) throw new Error(copy.navigation.loadFailed);
      const result = await response.json() as { items: SavedItem[]; pages: PageSummary[] };
      const next = emptyMenus();
      for (const menu of Object.keys(next) as MenuKey[]) next[menu] = fromRows(result.items.filter((item) => `${item.location}:${item.locale}` === menu));
      setMenus(next);
      setPages(result.pages);
      setDirty(cleanMenus());
    } catch {
      setLoadError(copy.navigation.loadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => (dialog.current ? animateDismissals(dialog.current) : undefined), []);
  // A row's ⋯ menu closes on a press outside and on Escape, and only one is open at a time.
  useEffect(() => wireDetailsMenus('details.navigation-nest-menu'), []);
  useEffect(() => () => endDrag.current?.(false), []);

  function closeDialog() {
    if (dialog.current) void closeOverlay(dialog.current);
  }

  function edit(next: NavigationDraftItem[]) {
    if (savingRef.current) return;
    setMenus((current) => ({ ...current, [key]: next }));
    setDirty((current) => ({ ...current, [key]: true }));
    setSaveError('');
    setStatus('');
  }

  function switchTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = tabs.indexOf(event.currentTarget);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  }

  function openAdd() {
    setKind('home');
    setLabel(homeLabel);
    setPageId(availablePages[0]?.id ?? '');
    setUrl('');
    setNewTab(false);
    setPlacement(location);
    setAddError('');
    setAddInvalid(null);
    dialog.current?.showModal();
  }

  function selectKind(next: NavigationKind) {
    setKind(next);
    setAddError('');
    setAddInvalid(null);
    setLabel(next === 'home' ? homeLabel : next === 'page' ? availablePages.find((page) => page.id === pageId)?.title ?? '' : '');
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const normalizedUrl = kind === 'custom' ? normalizeNavigationUrl(url) : null;
    if (!label.trim() || label.trim().length > 80) {
      setAddError(copy.navigation.labelLength);
      setAddInvalid('label');
      labelField.current?.focus();
      return;
    }
    if (kind === 'custom' && (!normalizedUrl || normalizedUrl.length > 2048)) {
      setAddError(copy.navigation.urlInvalid);
      setAddInvalid('url');
      urlField.current?.focus();
      return;
    }
    if (kind === 'page' && !availablePages.some((page) => page.id === pageId)) {
      setAddError(copy.navigation.pageTranslationRequired);
      return;
    }
    const item: NavigationMutationItem = { kind, label: label.trim(), pageId: kind === 'page' ? pageId : null, url: normalizedUrl, newTab: kind === 'custom' && newTab };
    // A group goes in the header whatever the placement says, so choosing one leaves the placement as it was.
    const keys: MenuKey[] = kind === 'group' ? [`header:${locale}`] : placement === 'both' ? [`header:${locale}`, `footer:${locale}`] : [`${placement}:${locale}`];
    if (keys.some((destination) => target(item) && menus[destination].some((entry) => target(entry) === target(item)))) {
      setAddError(copy.navigation.targetInUse);
      return;
    }
    if (keys.some((destination) => menus[destination].length >= 50)) {
      setAddError(copy.navigation.maxItems);
      return;
    }
    const next = { ...menus };
    const nextDirty = { ...dirty };
    for (const destination of keys) {
      next[destination] = [...menus[destination], { ...item, id: crypto.randomUUID(), parentId: null }];
      nextDirty[destination] = true;
    }
    setMenus(next);
    setDirty(nextDirty);
    setSaveError('');
    setStatus(fill(copy.navigation.added, { label: item.label }));
    closeDialog();
  }

  // A button that has just done its work stays focused, or hands focus to its row when it cannot go again.
  function keepFocus(button?: HTMLButtonElement) {
    if (button) requestAnimationFrame(() => {
      if (button.disabled) button.closest('li')?.querySelector('input')?.focus();
      else button.focus();
    });
  }

  function move(from: number, to: number, button?: HTMLButtonElement) {
    if (savingRef.current) return;
    const next = moveBlock(items, from, to);
    if (next === items) return;
    const item = items[from];
    edit(next);
    setStatus(fill(copy.navigation.moved, { label: item.label, position: next.indexOf(item) + 1 }));
    keepFocus(button);
  }

  /** Says where an item went: under a parent, out of one, or to a new position. */
  function announce(item: NavigationDraftItem, next: NavigationDraftItem[]) {
    const moved = next.find((entry) => entry.id === item.id)!;
    const parentId = moved.parentId ?? item.parentId;
    const parent = items.find((entry) => entry.id === parentId);
    if (moved.parentId && moved.parentId !== item.parentId) setStatus(fill(copy.navigation.indented, { label: item.label, parent: parent!.label }));
    else if (!moved.parentId && item.parentId) setStatus(fill(copy.navigation.outdented, { label: item.label, parent: parent!.label }));
    else setStatus(fill(copy.navigation.moved, { label: item.label, position: next.indexOf(moved) + 1 }));
  }

  /** The ⋯ menu's choice: under the top-level item above, or out to the main menu. */
  function nest(index: number, menu: HTMLDetailsElement | null) {
    if (menu) menu.open = false;
    if (savingRef.current) return;
    const item = items[index];
    const next = item.parentId ? outdent(items, index) : indent(items, index);
    if (next === items) return;
    edit(next);
    announce(item, next);
    // The row's menu now offers the way back; its label takes focus if it has none.
    requestAnimationFrame(() => {
      const row = list.current?.querySelector(`li[data-item-id="${item.id}"]`);
      (row?.querySelector<HTMLElement>('.navigation-nest-menu summary') ?? row?.querySelector('input'))?.focus();
    });
  }

  /**
   * A press on a row's grip: past a few pixels it becomes a drag, with a ghost of the row under
   * the pointer, the drop it would make on the list and in the hint, and the window scrolling near
   * its edges. Release drops; Escape, or a cancelled pointer, puts everything back.
   */
  function startDrag(event: ReactPointerEvent<HTMLElement>, from: number) {
    // A second finger or pen while one drag runs would drop onto a list the first has already changed.
    if (savingRef.current || endDrag.current || event.button !== 0) return;
    event.preventDefault();
    const { pointerId, clientX: startX, clientY: startY } = event;
    event.currentTarget.setPointerCapture?.(pointerId);
    const item = items[from];
    const row = event.currentTarget.closest('li')!.getBoundingClientRect();
    let x = startX;
    let y = startY;
    let ghost: HTMLElement | null = null;
    let action: DropAction | null = null;
    let shown = '';
    let frame = 0;

    const locate = () => {
      const over = document.elementFromPoint(x, y)?.closest<HTMLElement>('li[data-item-id]');
      const at = over && list.current?.contains(over) ? items.findIndex((entry) => entry.id === over.dataset.itemId) : -1;
      const box = over?.getBoundingClientRect();
      action = at < 0 || !box ? null : dropAction(items, from, at, (y - box.top) / box.height, location);
      const key = JSON.stringify(action);
      if (key !== shown) { shown = key; setDrag({ id: item.id, action }); }
    };
    const scroll = () => {
      const near = y < SCROLL_EDGE_PX ? y - SCROLL_EDGE_PX : y > innerHeight - SCROLL_EDGE_PX ? y - innerHeight + SCROLL_EDGE_PX : 0;
      if (near) { window.scrollBy(0, Math.round(near / 3)); locate(); }
      frame = requestAnimationFrame(scroll);
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      x = move.clientX;
      y = move.clientY;
      if (!ghost) {
        if (Math.hypot(x - startX, y - startY) < DRAG_START_PX) return;
        ghost = document.createElement('div');
        ghost.className = 'navigation-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.textContent = item.label;
        document.body.append(ghost);
        // The line keeps the height it had, so a shorter hint does not pull the list from under the pointer.
        if (hint.current) hint.current.style.minBlockSize = `${hint.current.offsetHeight}px`;
        frame = requestAnimationFrame(scroll);
      }
      ghost.style.transform = `translate(${x - (startX - row.left)}px, ${y - (startY - row.top)}px)`;
      locate();
    };
    const finish = (drop: boolean) => {
      endDrag.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(frame);
      ghost?.remove();
      if (hint.current) hint.current.style.minBlockSize = '';
      setDrag(null);
      if (!drop || !ghost || !action || savingRef.current) return;
      const next = applyDrop(items, from, action);
      if (next === items) return;
      edit(next);
      announce(item, next);
    };
    const onUp = (up: PointerEvent) => { if (up.pointerId === pointerId) finish(true); };
    const onCancel = (cancel: PointerEvent) => { if (cancel.pointerId === pointerId) finish(false); };
    const onKey = (key: globalThis.KeyboardEvent) => {
      if (key.key !== 'Escape') return;
      key.preventDefault();
      key.stopPropagation();
      finish(false);
    };
    endDrag.current = finish;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  }

  /** What the drop under the pointer would do, in words. */
  function dropHint(action: DropAction | null): string {
    if (!action) return '';
    if ('refused' in action) return { 'one-level': copy.navigation.dropOneLevel, self: copy.navigation.dropSelf, group: copy.navigation.dropGroup }[action.refused];
    const onto = items[action.target];
    if (action.kind === 'into') return fill(copy.navigation.dropInto, { label: onto.label });
    const above = action.kind === 'before';
    const parent = onto.parentId ? items.find((entry) => entry.id === onto.parentId) : undefined;
    if (parent) return fill(above ? copy.navigation.dropAboveSub : copy.navigation.dropBelowSub, { label: onto.label, parent: parent.label });
    if (location === 'footer') return fill(above ? copy.navigation.dropAbove : copy.navigation.dropBelow, { label: onto.label });
    return fill(above ? copy.navigation.dropAboveMain : copy.navigation.dropBelowMain, { label: onto.label });
  }

  /** The row that shows the drop: the target, or for "after" a top-level row, the last row of its block. */
  function dropMark(): { row: number; mark: string } | null {
    const action = drag?.action;
    if (!action || 'refused' in action) return null;
    const onto = items[action.target];
    if (action.kind !== 'after' || onto.parentId) return { row: action.target, mark: action.kind };
    let row = action.target;
    while (items[row + 1]?.parentId === onto.id) row += 1;
    return { row, mark: row === action.target ? 'after' : 'after-block' };
  }

  function remove(index: number) {
    edit(removeItem(items, index));
    setStatus(fill(copy.navigation.removed, { label: items[index].label }));
    requestAnimationFrame(() => {
      const inputs = list.current?.querySelectorAll<HTMLInputElement>('input');
      if (inputs?.length) inputs[Math.min(index, inputs.length - 1)].focus();
      else addButton.current?.focus();
    });
  }

  async function save(restoreFocus = false) {
    if (savingRef.current || !dirty[key]) return;
    if (items.some((item) => !item.label.trim() || item.label.trim().length > 80)) {
      setSaveError(copy.navigation.everyLabelRequired);
      list.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
      return;
    }
    // Each empty group already says so on its row, and Save is disabled until it holds an item.
    if (empty.size) return;
    savingRef.current = true;
    setSaving(true);
    setPressed(restoreFocus ? 'retry' : 'save');
    setSaveError('');
    try {
      const response = await atLeast(fetch('/api/admin/navigation', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale, location, items: toMutation(items) }),
      }));
      if (!response.ok) throw new Error(copy.navigation.saveFailed);
      const result = await response.json() as { items: SavedItem[] };
      setMenus((current) => ({ ...current, [key]: fromRows(result.items) }));
      setDirty((current) => ({ ...current, [key]: false }));
      setSavedOnce(true);
    } catch {
      setSaveError(copy.navigation.saveError);
      setStatus('');
    } finally {
      savingRef.current = false;
      setSaving(false);
      setPressed(null);
      if (restoreFocus) requestAnimationFrame(() => addButton.current?.focus());
    }
  }

  const mark = dropMark();

  return (
    <section className="admin-page navigation-manager">
      <header className="admin-page__head">
        <div><p className="admin-eyebrow">{copy.nav.groupContent}</p><h1>{copy.navigation.heading}</h1><p>{copy.navigation.subheading}</p></div>
        <button className="admin-button admin-button--secondary" disabled={loading || !!loadError || saving} onClick={openAdd} ref={addButton} type="button">{copy.navigation.addItem}</button>
      </header>
      <p className="navigation-status" role="status" aria-live="polite" aria-atomic="true">{loading ? copy.navigation.loading : status}</p>
      {loadError && <div className="admin-alert" role="alert">{loadError} <button className="admin-button" onClick={() => void load()} type="button">{copy.navigation.retry}</button></div>}
      {!loading && !loadError && <>
        <div aria-label={copy.navigation.menuLocation} className="navigation-tabs" role="tablist">
          {locations.map((tab) => {
            const unsaved = languages.some((language) => dirty[`${tab.value}:${language.value}`]);
            return <button aria-controls="navigation-location-panel" aria-describedby={unsaved ? `navigation-${tab.value}-dirty` : undefined} aria-label={tab.label} aria-selected={location === tab.value} className="navigation-tab" disabled={saving} id={`navigation-${tab.value}-tab`} key={tab.value} onClick={() => { setLocation(tab.value); setSavedOnce(false); setSaveError(''); setStatus(''); }} onKeyDown={switchTab} role="tab" tabIndex={location === tab.value ? 0 : -1} type="button">{tab.label}{unsaved && <span className="navigation-dirty" id={`navigation-${tab.value}-dirty`}>{copy.navigation.unsaved}</span>}</button>;
          })}
        </div>
        <div aria-labelledby={`navigation-${location}-tab`} id="navigation-location-panel" role="tabpanel">
          <div aria-label={copy.navigation.menuLanguage} className="navigation-tabs" role="tablist">
            {languages.map((tab) => <button aria-controls="navigation-language-panel" aria-describedby={dirty[`${location}:${tab.value}`] ? `navigation-${tab.value}-dirty` : undefined} aria-label={tab.label} aria-selected={locale === tab.value} className="navigation-tab" disabled={saving} id={`navigation-${tab.value}-tab`} key={tab.value} onClick={() => { setLocale(tab.value); setSavedOnce(false); setSaveError(''); setStatus(''); }} onKeyDown={switchTab} role="tab" tabIndex={locale === tab.value ? 0 : -1} type="button">{tab.label}{dirty[`${location}:${tab.value}`] && <span className="navigation-dirty" id={`navigation-${tab.value}-dirty`}>{copy.navigation.unsaved}</span>}</button>)}
          </div>
          <div aria-busy={saving} aria-labelledby={`navigation-${locale}-tab`} id="navigation-language-panel" role="tabpanel" tabIndex={0}>
            {!items.length && (
              // One sentence, no title: the copy has none, and a sentence at 28px reads as a shout.
              <div className="admin-empty">
                <p className="admin-eyebrow">{copy.empty.eyebrow}</p>
                <p>{copy.navigation.empty}</p>
              </div>
            )}
            {items.length > 1 && <p className="navigation-hint" data-refused={drag?.action && 'refused' in drag.action ? '' : undefined} ref={hint}><span aria-live="polite">{drag ? dropHint(drag.action) : ''}</span>{!drag && (location === 'header' ? copy.navigation.dragHint : copy.navigation.dragHintFooter)}</p>}
            <ol aria-label={copy.navigation.menuItems} className="navigation-items" data-dragging={drag ? '' : undefined} ref={list}>
              {items.map((item, index) => {
                const page = pages.find((entry) => entry.id === item.pageId);
                const summary = item.kind === 'home' ? fill(copy.navigation.homeTarget, { locale }) : item.kind === 'custom' ? item.url : item.kind === 'group' ? copy.navigation.group : page?.title ?? copy.navigation.pageUnavailable;
                const parent = item.parentId ? items.find((entry) => entry.id === item.parentId) : undefined;
                const emptyNote = empty.has(index) ? `navigation-empty-${item.id}` : undefined;
                const nesting = location === 'header' && (canIndent(items, index, location) || canOutdent(items, index));
                return <li className="navigation-item" data-depth={parent ? 1 : undefined} data-dragging={drag && (item.id === drag.id || item.parentId === drag.id) ? '' : undefined} data-drop={mark?.row === index ? mark.mark : undefined} data-item-id={item.id} key={item.id}>
                  <span aria-hidden="true" className="navigation-grip navigation-grip--pointer" onPointerDown={(event) => startDrag(event, index)}><Icon name="grip" /></span>
                  <div className="navigation-item__content">
                    <label className="admin-field"><span className="sr-only">{fill(copy.navigation.itemLabel, { index: index + 1 })}{parent && ` ${fill(copy.navigation.subItemOf, { label: parent.label })}`}</span><input aria-describedby={emptyNote} aria-invalid={!item.label.trim() || undefined} className="admin-control" disabled={saving} maxLength={80} onChange={(event) => edit(items.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry))} required value={item.label} /></label>
                    <p className="navigation-target">{summary}</p>
                    {emptyNote && <p className="admin-field-error" id={emptyNote}>{copy.navigation.emptyGroup}</p>}
                    <p className="navigation-visibility">{item.kind === 'page' && page?.status !== 'published' ? page ? copy.navigation.hiddenDraft : copy.navigation.hiddenUnavailable : copy.navigation.visible}</p>
                    {item.kind === 'custom' && <div className="admin-check navigation-new-tab"><label><input aria-label={fill(copy.navigation.newTabForItem, { index: index + 1 })} checked={item.newTab} disabled={saving} onChange={(event) => edit(items.map((entry) => entry.id === item.id ? { ...entry, newTab: event.target.checked } : entry))} type="checkbox" /><span>{copy.navigation.newTab}</span></label></div>}
                  </div>
                  <div aria-label={fill(copy.navigation.actionsForItem, { index: index + 1 })} className="navigation-item__actions" role="group">
                    <button aria-label={copy.navigation.moveUp} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || sibling(items, index, -1) < 0} onClick={(event) => move(index, sibling(items, index, -1), event.currentTarget)} title={copy.navigation.moveUp} type="button"><Icon name="up" /></button>
                    <button aria-label={copy.navigation.moveDown} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || sibling(items, index, 1) < 0} onClick={(event) => move(index, sibling(items, index, 1), event.currentTarget)} title={copy.navigation.moveDown} type="button"><Icon name="down" /></button>
                    {/* A row with no nesting choice keeps the ⋯ button's slot, so every row's columns line up. */}
                    {location === 'header' && !nesting && <span aria-hidden="true" className="navigation-nest-slot" />}
                    {nesting && <details className="admin-story-menu navigation-nest-menu" name="navigation-nest-menu">
                      <summary aria-label={fill(copy.navigation.nestMenu, { index: index + 1 })} title={fill(copy.navigation.nestMenu, { index: index + 1 })}><Icon name="more" /></summary>
                      <div>
                        <button disabled={saving} onClick={(event) => nest(index, event.currentTarget.closest('details'))} type="button">{item.parentId ? copy.navigation.outdent : fill(copy.navigation.indent, { label: items[indentParent(items, index)].label })}</button>
                      </div>
                    </details>}
                    <button aria-label={copy.navigation.remove} className="admin-button admin-button--ghost admin-button--icon navigation-remove" disabled={saving} onClick={() => remove(index)} title={copy.navigation.remove} type="button"><Icon name="trash" /></button>
                  </div>
                </li>;
              })}
            </ol>
            {/* No change, no save row: a disabled primary under an unchanged menu said nothing but "faded". */}
            {(dirty[key] || pressed === 'save' || savedOnce) && <div className="navigation-save">
              <SaveButton
                describedBy={empty.size ? `navigation-empty-${items[Math.min(...empty)].id}` : undefined}
                disabled={saving || empty.size > 0}
                label={copy.navigation.saveMenu}
                onClick={() => void save()}
                savedLabel={copy.shell.saved}
                savingLabel={copy.shell.saving}
                state={saveButtonState({ saving: pressed === 'save', dirty: dirty[key], savedOnce })}
              />
            </div>}
            {saveError && <div className="admin-alert" role="alert">{saveError} <button aria-busy={pressed === 'retry'} className="admin-button" disabled={saving} onClick={() => void save(true)} type="button">{copy.navigation.retrySave}</button></div>}
          </div>
        </div>
      </>}
      <dialog aria-labelledby="navigation-add-title" className="navigation-dialog" onClose={() => addButton.current?.focus()} ref={dialog}>
        <form noValidate onSubmit={add}>
          <h2 id="navigation-add-title">{copy.navigation.addTitle}</h2>
          <fieldset className="navigation-kinds"><legend>{copy.navigation.target}</legend>{([{ value: 'home', label: copy.navigation.home }, { value: 'page', label: copy.navigation.page }, { value: 'custom', label: copy.navigation.customUrl }, ...(location === 'header' ? [{ value: 'group', label: copy.navigation.group }] as const : [])] as const).map((option) => <label key={option.value}><input checked={kind === option.value} name="navigation-kind" onChange={() => selectKind(option.value)} type="radio" value={option.value} /> {option.label}</label>)}</fieldset>
          {kind === 'page' && <div className="admin-field">
            <label htmlFor="navigation-page">{copy.navigation.page}</label>
            <UiSelect ariaLabel={copy.navigation.page} ariaDescribedBy="navigation-page-help" className="admin-control" disabled={!availablePages.length} id="navigation-page" onValueChange={(next) => { setPageId(next); setLabel(availablePages.find((page) => page.id === next)?.title ?? ''); }} options={availablePages.length ? availablePages.map((page) => ({ value: page.id, label: `${page.title}${page.status === 'draft' ? copy.navigation.draftSuffix : ''}` })) : [{ value: '', label: copy.navigation.noPages }]} value={pageId} />
            <small id="navigation-page-help">{copy.navigation.pageHelp}</small>
            {missingPages.length > 0 && <ul className="navigation-missing">{missingPages.map((page) => <li key={page.id}><button disabled type="button">{fill(copy.navigation.missingTranslation, { language: locale === 'th' ? copy.filters.thai : copy.filters.english, title: page.title })}</button></li>)}</ul>}
          </div>}
          {kind === 'custom' && <label className="admin-field">{copy.navigation.urlLabel}<input aria-invalid={addInvalid === 'url' || undefined} className="admin-control" onChange={(event) => { setUrl(event.target.value); if (addInvalid === 'url') { setAddInvalid(null); setAddError(''); } }} placeholder={copy.navigation.urlPlaceholder} ref={urlField} required value={url} /></label>}
          {kind === 'custom' && <div className="admin-check"><label><input checked={newTab} onChange={(event) => setNewTab(event.target.checked)} type="checkbox" /><span>{copy.navigation.newTab}</span></label></div>}
          {kind === 'group' && <small>{copy.navigation.groupHint}</small>}
          <label className="admin-field">{copy.navigation.label}<input aria-invalid={addInvalid === 'label' || undefined} className="admin-control" maxLength={80} onChange={(event) => { setLabel(event.target.value); if (addInvalid === 'label') { setAddInvalid(null); setAddError(''); } }} ref={labelField} required value={label} /></label>
          {kind !== 'group' && <div className="admin-field"><label htmlFor="navigation-placement">{copy.navigation.placement}</label><UiSelect ariaLabel={copy.navigation.placement} className="admin-control" id="navigation-placement" onValueChange={(next) => setPlacement(next as NavigationLocation | 'both')} options={[...locations, { value: 'both', label: copy.navigation.both }]} value={placement} /><small>{fill(copy.navigation.placementHelp, { language: locale === 'th' ? copy.filters.thai : copy.filters.english })}</small></div>}
          {addError && <p className="admin-alert" role="alert">{addError}</p>}
          <div className="navigation-dialog__actions"><button className="admin-button" onClick={closeDialog} type="button">{copy.navigation.cancel}</button><button className="admin-button admin-button--primary" disabled={kind === 'page' && !availablePages.length} type="submit">{copy.navigation.addToMenu}</button></div>
        </form>
      </dialog>
    </section>
  );
}
