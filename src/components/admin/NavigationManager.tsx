import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { adminCopy, fill } from '../../lib/admin-i18n';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import type { NavigationItem, NavigationKind, NavigationLocation, NavigationMutationItem, Page, PageLocale, PostLocale } from '../../types/cms';
import Icon from '../Icon';
import UiSelect from './UiSelect';
import { atLeast } from '../../lib/busy';

type MenuKey = `${NavigationLocation}:${PageLocale}`;
type LocalItem = NavigationMutationItem & { id: string };
type PageSummary = Pick<Page, 'id' | 'translation_group_id' | 'locale' | 'title' | 'slug' | 'status'>;
type SavedItem = Omit<NavigationItem, 'owner_id'>;
const languages = [{ value: 'th', label: 'ไทย' }, { value: 'en', label: 'English' }] as const;
const emptyMenus = (): Record<MenuKey, LocalItem[]> => ({ 'header:th': [], 'header:en': [], 'footer:th': [], 'footer:en': [] });
const cleanMenus = (): Record<MenuKey, boolean> => ({ 'header:th': false, 'header:en': false, 'footer:th': false, 'footer:en': false });
const localItem = (item: SavedItem): LocalItem => ({ id: item.id, kind: item.kind, label: item.label, pageId: item.page_id, url: item.url });
const target = (item: NavigationMutationItem) => `${item.kind}:${item.pageId ?? item.url ?? ''}`;

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
  const [locale, setLocale] = useState<PageLocale>('th');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  // Save and Retry both save; only the one that was pressed spins.
  const [pressed, setPressed] = useState<'retry' | 'save' | null>(null);
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState<NavigationKind>('home');
  const [pageId, setPageId] = useState('');
  const [label, setLabel] = useState(copy.navigation.home);
  const [url, setUrl] = useState('');
  const [placement, setPlacement] = useState<NavigationLocation | 'both'>('header');
  const [addError, setAddError] = useState('');
  const savingRef = useRef(false);
  const dragged = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const key: MenuKey = `${location}:${locale}`;
  const items = menus[key];
  const availablePages = pages.filter((page) => page.locale === locale);
  const missingPages = pages.filter((page) => page.locale !== locale && !availablePages.some((edition) => edition.translation_group_id === page.translation_group_id));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/admin/navigation');
      if (!response.ok) throw new Error(copy.navigation.loadFailed);
      const result = await response.json() as { items: SavedItem[]; pages: PageSummary[] };
      const next = emptyMenus();
      for (const item of result.items) next[`${item.location}:${item.locale}`].push(localItem(item));
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

  function edit(next: LocalItem[]) {
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
    setLabel('Home');
    setPageId(availablePages[0]?.id ?? '');
    setUrl('');
    setPlacement(location);
    setAddError('');
    dialog.current?.showModal();
  }

  function selectKind(next: NavigationKind) {
    setKind(next);
    setAddError('');
    setLabel(next === 'home' ? 'Home' : next === 'page' ? availablePages.find((page) => page.id === pageId)?.title ?? '' : '');
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const normalizedUrl = kind === 'custom' ? normalizeNavigationUrl(url) : null;
    if (!label.trim() || label.trim().length > 80) {
      setAddError(copy.navigation.labelLength);
      return;
    }
    if (kind === 'custom' && (!normalizedUrl || normalizedUrl.length > 2048)) {
      setAddError(copy.navigation.urlInvalid);
      return;
    }
    if (kind === 'page' && !availablePages.some((page) => page.id === pageId)) {
      setAddError(copy.navigation.pageTranslationRequired);
      return;
    }
    const item: NavigationMutationItem = { kind, label: label.trim(), pageId: kind === 'page' ? pageId : null, url: normalizedUrl };
    const keys: MenuKey[] = placement === 'both' ? [`header:${locale}`, `footer:${locale}`] : [`${placement}:${locale}`];
    if (keys.some((destination) => menus[destination].some((entry) => target(entry) === target(item)))) {
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
      next[destination] = [...menus[destination], { ...item, id: crypto.randomUUID() }];
      nextDirty[destination] = true;
    }
    setMenus(next);
    setDirty(nextDirty);
    setSaveError('');
    setStatus(fill(copy.navigation.added, { label: item.label }));
    dialog.current?.close();
  }

  function move(from: number, to: number, button?: HTMLButtonElement) {
    if (savingRef.current || from === to || from < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    edit(next);
    setStatus(fill(copy.navigation.moved, { label: item.label, position: to + 1 }));
    if (button) requestAnimationFrame(() => {
      if (button.disabled) button.closest('li')?.querySelector('input')?.focus();
      else button.focus();
    });
  }

  function remove(index: number) {
    edit(items.filter((_, position) => position !== index));
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
    savingRef.current = true;
    setSaving(true);
    setPressed(restoreFocus ? 'retry' : 'save');
    setSaveError('');
    setStatus(copy.navigation.savingMenu);
    try {
      const response = await atLeast(fetch('/api/admin/navigation', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale, location, items: items.map(({ id: _id, ...item }) => item) }),
      }));
      if (!response.ok) throw new Error(copy.navigation.saveFailed);
      const result = await response.json() as { items: SavedItem[] };
      setMenus((current) => ({ ...current, [key]: result.items.map(localItem) }));
      setDirty((current) => ({ ...current, [key]: false }));
      setStatus(copy.navigation.menuSaved);
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
        <div><h1>{copy.navigation.heading}</h1><p>{copy.navigation.subheading}</p></div>
        <button className="admin-button admin-button--primary" disabled={loading || !!loadError || saving} onClick={openAdd} ref={addButton} type="button">{copy.navigation.addItem}</button>
      </header>
      <p className="navigation-status" role="status" aria-live="polite" aria-atomic="true">{loading ? copy.navigation.loading : status}</p>
      {loadError && <div className="admin-alert" role="alert">{loadError} <button className="admin-button" onClick={() => void load()} type="button">{copy.navigation.retry}</button></div>}
      {!loading && !loadError && <>
        <div aria-label={copy.navigation.menuLocation} className="navigation-tabs" role="tablist">
          {locations.map((tab) => {
            const unsaved = languages.some((language) => dirty[`${tab.value}:${language.value}`]);
            return <button aria-controls="navigation-location-panel" aria-describedby={unsaved ? `navigation-${tab.value}-dirty` : undefined} aria-label={tab.label} aria-selected={location === tab.value} className="navigation-tab" disabled={saving} id={`navigation-${tab.value}-tab`} key={tab.value} onClick={() => { setLocation(tab.value); setSaveError(''); setStatus(''); }} onKeyDown={switchTab} role="tab" tabIndex={location === tab.value ? 0 : -1} type="button">{tab.label}{unsaved && <span className="navigation-dirty" id={`navigation-${tab.value}-dirty`}>{copy.navigation.unsaved}</span>}</button>;
          })}
        </div>
        <div aria-labelledby={`navigation-${location}-tab`} id="navigation-location-panel" role="tabpanel">
          <div aria-label={copy.navigation.menuLanguage} className="navigation-tabs" role="tablist">
            {languages.map((tab) => <button aria-controls="navigation-language-panel" aria-describedby={dirty[`${location}:${tab.value}`] ? `navigation-${tab.value}-dirty` : undefined} aria-label={tab.label} aria-selected={locale === tab.value} className="navigation-tab" disabled={saving} id={`navigation-${tab.value}-tab`} key={tab.value} onClick={() => { setLocale(tab.value); setSaveError(''); setStatus(''); }} onKeyDown={switchTab} role="tab" tabIndex={locale === tab.value ? 0 : -1} type="button">{tab.label}{dirty[`${location}:${tab.value}`] && <span className="navigation-dirty" id={`navigation-${tab.value}-dirty`}>{copy.navigation.unsaved}</span>}</button>)}
          </div>
          <div aria-busy={saving} aria-labelledby={`navigation-${locale}-tab`} id="navigation-language-panel" role="tabpanel" tabIndex={0}>
            {!items.length && (
              <div className="admin-empty navigation-empty">
                <span className="admin-empty__mark" aria-hidden="true"><Icon name="navigation" /></span>
                <div><p>{copy.navigation.empty}</p></div>
              </div>
            )}
            <ol aria-label={copy.navigation.menuItems} className="navigation-items" ref={list}>
              {items.map((item, index) => {
                const page = pages.find((entry) => entry.id === item.pageId);
                const summary = item.kind === 'home' ? fill(copy.navigation.homeTarget, { locale }) : item.kind === 'custom' ? item.url : page?.title ?? copy.navigation.pageUnavailable;
                return <li className="navigation-item" draggable={!saving} key={item.id} onDragStart={(event) => { dragged.current = item.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }} onDragEnd={() => { dragged.current = null; }} onDragOver={(event) => { if (dragged.current && !saving) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={(event) => { event.preventDefault(); move(items.findIndex((entry) => entry.id === dragged.current), index); dragged.current = null; }}>
                  <span aria-hidden="true" className="navigation-grip"><Icon name="grip" /></span>
                  <div className="navigation-item__content">
                    <label className="admin-field"><span className="sr-only">{fill(copy.navigation.itemLabel, { index: index + 1 })}</span><input aria-invalid={!item.label.trim() || undefined} className="admin-control" disabled={saving} maxLength={80} onChange={(event) => edit(items.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry))} required value={item.label} /></label>
                    <p className="navigation-target">{summary}</p>
                    <p className="navigation-visibility">{item.kind === 'page' && page?.status !== 'published' ? page ? copy.navigation.hiddenDraft : copy.navigation.hiddenUnavailable : copy.navigation.visible}</p>
                  </div>
                  <div aria-label={fill(copy.navigation.actionsForItem, { index: index + 1 })} className="navigation-item__actions" role="group">
                    <button aria-label={copy.navigation.moveUp} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || index === 0} onClick={(event) => move(index, index - 1, event.currentTarget)} title={copy.navigation.moveUp} type="button"><Icon name="up" /></button>
                    <button aria-label={copy.navigation.moveDown} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || index === items.length - 1} onClick={(event) => move(index, index + 1, event.currentTarget)} title={copy.navigation.moveDown} type="button"><Icon name="down" /></button>
                    <button aria-label={copy.navigation.remove} className="admin-button admin-button--ghost admin-button--icon navigation-remove" disabled={saving} onClick={() => remove(index)} title={copy.navigation.remove} type="button"><Icon name="trash" /></button>
                  </div>
                </li>;
              })}
            </ol>
            <div className="navigation-save">
              <button aria-busy={pressed === 'save'} className="admin-button admin-button--primary" disabled={saving || !dirty[key]} onClick={() => void save()} type="button">{copy.navigation.saveMenu}</button>
              {/* The words live here, so the button keeps its width while it spins. */}
              <span>{saving ? copy.navigation.saving : dirty[key] ? copy.navigation.unsavedChanges : copy.navigation.noUnsavedChanges}</span>
            </div>
            {saveError && <div className="admin-alert" role="alert">{saveError} <button aria-busy={pressed === 'retry'} className="admin-button" disabled={saving} onClick={() => void save(true)} type="button">{copy.navigation.retrySave}</button></div>}
          </div>
        </div>
      </>}
      <dialog aria-labelledby="navigation-add-title" className="navigation-dialog" onClose={() => addButton.current?.focus()} ref={dialog}>
        <form noValidate onSubmit={add}>
          <h2 id="navigation-add-title">{copy.navigation.addTitle}</h2>
          <fieldset className="navigation-kinds"><legend>{copy.navigation.target}</legend>{([{ value: 'home', label: copy.navigation.home }, { value: 'page', label: copy.navigation.page }, { value: 'custom', label: copy.navigation.customUrl }] as const).map((option) => <label key={option.value}><input checked={kind === option.value} name="navigation-kind" onChange={() => selectKind(option.value)} type="radio" value={option.value} /> {option.label}</label>)}</fieldset>
          {kind === 'page' && <div className="admin-field">
            <label htmlFor="navigation-page">{copy.navigation.page}</label>
            <UiSelect ariaLabel={copy.navigation.page} ariaDescribedBy="navigation-page-help" className="admin-control" disabled={!availablePages.length} id="navigation-page" onValueChange={(next) => { setPageId(next); setLabel(availablePages.find((page) => page.id === next)?.title ?? ''); }} options={availablePages.length ? availablePages.map((page) => ({ value: page.id, label: `${page.title}${page.status === 'draft' ? copy.navigation.draftSuffix : ''}` })) : [{ value: '', label: copy.navigation.noPages }]} value={pageId} />
            <small id="navigation-page-help">{copy.navigation.pageHelp}</small>
            {missingPages.length > 0 && <ul className="navigation-missing">{missingPages.map((page) => <li key={page.id}><button disabled type="button">{fill(copy.navigation.missingTranslation, { language: locale === 'th' ? copy.filters.thai : copy.filters.english, title: page.title })}</button></li>)}</ul>}
          </div>}
          {kind === 'custom' && <label className="admin-field">{copy.navigation.urlLabel}<input className="admin-control" onChange={(event) => setUrl(event.target.value)} placeholder={copy.navigation.urlPlaceholder} required value={url} /></label>}
          <label className="admin-field">{copy.navigation.label}<input className="admin-control" maxLength={80} onChange={(event) => setLabel(event.target.value)} required value={label} /></label>
          <div className="admin-field"><label htmlFor="navigation-placement">{copy.navigation.placement}</label><UiSelect ariaLabel={copy.navigation.placement} className="admin-control" id="navigation-placement" onValueChange={(next) => setPlacement(next as NavigationLocation | 'both')} options={[...locations, { value: 'both', label: copy.navigation.both }]} value={placement} /><small>{fill(copy.navigation.placementHelp, { language: locale === 'th' ? copy.filters.thai : copy.filters.english })}</small></div>
          {addError && <p className="admin-alert" role="alert">{addError}</p>}
          <div className="navigation-dialog__actions"><button className="admin-button" onClick={() => dialog.current?.close()} type="button">{copy.navigation.cancel}</button><button className="admin-button admin-button--primary" disabled={kind === 'page' && !availablePages.length} type="submit">{copy.navigation.addToMenu}</button></div>
        </form>
      </dialog>
    </section>
  );
}
