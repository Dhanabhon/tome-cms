import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { adminCopy, fill } from '../../lib/admin-i18n';
import { canIndent, canOutdent, emptyGroups, fromRows, indent, moveBlock, outdent, removeItem, sibling, toMutation, type NavigationDraftItem } from '../../lib/navigation-tree';
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
  const dragged = useRef<string | null>(null);
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
    // A group has no link, and only the header holds sub-items for it.
    if (next === 'group') setPlacement('header');
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

  function nest(index: number, button: HTMLButtonElement) {
    if (savingRef.current) return;
    const item = items[index];
    const next = item.parentId ? outdent(items, index) : indent(items, index);
    if (next === items) return;
    const parentId = item.parentId ?? next.find((entry) => entry.id === item.id)!.parentId;
    const parent = items.find((entry) => entry.id === parentId)!;
    edit(next);
    setStatus(fill(item.parentId ? copy.navigation.outdented : copy.navigation.indented, { label: item.label, parent: parent.label }));
    keepFocus(button);
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

  return (
    <section className="admin-page navigation-manager">
      <header className="admin-page__head">
        <div><p className="admin-eyebrow">{copy.nav.groupContent}</p><h1>{copy.navigation.heading}</h1><p>{copy.navigation.subheading}</p></div>
        <button className="admin-button admin-button--primary" disabled={loading || !!loadError || saving} onClick={openAdd} ref={addButton} type="button">{copy.navigation.addItem}</button>
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
            <ol aria-label={copy.navigation.menuItems} className="navigation-items" ref={list}>
              {items.map((item, index) => {
                const page = pages.find((entry) => entry.id === item.pageId);
                const summary = item.kind === 'home' ? fill(copy.navigation.homeTarget, { locale }) : item.kind === 'custom' ? item.url : item.kind === 'group' ? copy.navigation.group : page?.title ?? copy.navigation.pageUnavailable;
                const parent = item.parentId ? items.find((entry) => entry.id === item.parentId) : undefined;
                const emptyNote = empty.has(index) ? `navigation-empty-${item.id}` : undefined;
                return <li className="navigation-item" data-depth={parent ? 1 : undefined} draggable={!saving} key={item.id} onDragStart={(event) => { dragged.current = item.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }} onDragEnd={() => { dragged.current = null; }} onDragOver={(event) => { if (dragged.current && !saving) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={(event) => { event.preventDefault(); move(items.findIndex((entry) => entry.id === dragged.current), index); dragged.current = null; }}>
                  <span aria-hidden="true" className="navigation-grip"><Icon name="grip" /></span>
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
                    {location === 'header' && <>
                      <button aria-label={copy.navigation.outdent} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || !canOutdent(items, index)} onClick={(event) => nest(index, event.currentTarget)} title={copy.navigation.outdent} type="button"><Icon name="arrowLeft" /></button>
                      <button aria-label={copy.navigation.indent} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || !canIndent(items, index, location)} onClick={(event) => nest(index, event.currentTarget)} title={copy.navigation.indent} type="button"><Icon name="arrowRight" /></button>
                    </>}
                    <button aria-label={copy.navigation.remove} className="admin-button admin-button--ghost admin-button--icon navigation-remove" disabled={saving} onClick={() => remove(index)} title={copy.navigation.remove} type="button"><Icon name="trash" /></button>
                  </div>
                </li>;
              })}
            </ol>
            <div className="navigation-save">
              <SaveButton
                describedBy={empty.size ? `navigation-empty-${items[Math.min(...empty)].id}` : undefined}
                disabled={saving || empty.size > 0}
                label={copy.navigation.saveMenu}
                onClick={() => void save()}
                savedLabel={copy.shell.saved}
                savingLabel={copy.shell.saving}
                state={saveButtonState({ saving: pressed === 'save', dirty: dirty[key], savedOnce })}
              />
            </div>
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
