import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { adminCopy, fill } from '../../lib/admin-i18n';
import { atLeast } from '../../lib/busy';
import {
  HEAVY_SLIDE_BYTES,
  MAX_HOME_SLIDES,
  NARROW_SLIDE_PIXELS,
  SHOWN_HOME_SLIDES,
  slideStatus,
} from '../../lib/home-slides';
import { formatBytes } from '../../lib/media';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import {
  HOME_SLIDE_FOCUS,
  type HomeSlide,
  type HomeSlideAlign,
  type HomeSlideFocus,
  type HomeSlideMedia,
  type HomeSlideOverlay,
  type MediaAsset,
  type NavigationKind,
  type PageLocale,
  type PostLocale,
} from '../../types/cms';
import Icon from '../Icon';
import MediaPicker from './MediaPicker';
import UiSelect from './UiSelect';
import { useDrawer } from './useDrawer';

interface SlidePage { id: string; locale: PageLocale; status: string; title: string }

/** A slide as the form holds it: every field a string or a flag, converted only on save. */
interface LocalSlide {
  align: HomeSlideAlign;
  body: string;
  buttonLabel: string;
  enabled: boolean;
  endsAt: string;
  focus: HomeSlideFocus;
  heading: string;
  id: string;
  linkKind: NavigationKind;
  mediaId: string;
  newTab: boolean;
  overlay: HomeSlideOverlay;
  pageId: string;
  startsAt: string;
  url: string;
}

// Autonyms stay in their own language; the rest follows the owner's.
const languages = [{ value: 'th', label: 'ไทย' }, { value: 'en', label: 'English' }] as const;
const none = (): Record<PageLocale, LocalSlide[]> => ({ en: [], th: [] });
const blank = (): LocalSlide => ({
  align: 'start', body: '', buttonLabel: '', enabled: true, endsAt: '', focus: 'center', heading: '',
  id: crypto.randomUUID(), linkKind: 'home', mediaId: '', newTab: false, overlay: 'soft', pageId: '', startsAt: '', url: '',
});
const local = (slide: HomeSlide): LocalSlide => ({
  align: slide.align, body: slide.body ?? '', buttonLabel: slide.button_label ?? '', enabled: slide.enabled,
  endsAt: slide.ends_at ?? '', focus: slide.focus, heading: slide.heading ?? '', id: slide.id,
  linkKind: slide.link_kind ?? 'home', mediaId: slide.media_id, newTab: slide.new_tab, overlay: slide.overlay,
  pageId: slide.page_id ?? '', startsAt: slide.starts_at ?? '', url: slide.url ?? '',
});
/** `datetime-local` speaks the device's own time and no zone; the server keeps UTC. */
const toInput = (iso: string) => {
  if (!iso) return '';
  const moment = new Date(iso);
  return new Date(moment.getTime() - moment.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromInput = (value: string) => value ? new Date(value).toISOString() : '';
const status = (slide: LocalSlide, now: Date) => slideStatus({ enabled: slide.enabled, endsAt: slide.endsAt || null, startsAt: slide.startsAt || null }, now);

function mutation(slide: LocalSlide) {
  const label = slide.buttonLabel.trim();
  return {
    align: slide.align,
    body: slide.body.trim() || null,
    button: label ? {
      label,
      link: slide.linkKind === 'page' ? { kind: 'page', pageId: slide.pageId }
        : slide.linkKind === 'custom' ? { kind: 'custom', newTab: slide.newTab, url: normalizeNavigationUrl(slide.url) }
          : { kind: 'home' },
    } : null,
    enabled: slide.enabled,
    endsAt: slide.endsAt || null,
    focus: slide.focus,
    heading: slide.heading.trim() || null,
    mediaId: slide.mediaId,
    overlay: slide.overlay,
    startsAt: slide.startsAt || null,
  };
}

interface SlidesManagerProps {
  heroUsesSlides: boolean;
  ownerLocale?: PostLocale | null;
  themesHref: string;
}

export default function SlidesManager({ heroUsesSlides, ownerLocale, themesHref }: SlidesManagerProps) {
  const copy = adminCopy(ownerLocale);
  const text = copy.slides;
  const [slides, setSlides] = useState(none);
  const [dirty, setDirty] = useState<Record<PageLocale, boolean>>({ en: false, th: false });
  const [media, setMedia] = useState<Record<string, HomeSlideMedia>>({});
  const [pages, setPages] = useState<SlidePage[]>([]);
  const [locale, setLocale] = useState<PageLocale>('th');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<{ index: number | null; slide: LocalSlide } | null>(null);
  const [draftError, setDraftError] = useState('');
  const [picking, setPicking] = useState(false);
  const savingRef = useRef(false);
  const dragged = useRef<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pictureButton = useRef<HTMLButtonElement>(null);
  const { close, dialog } = useDrawer({ focus: closeButton, onClose: () => setDraft(null), open: draft !== null });
  const items = slides[locale];
  const localePages = pages.filter((page) => page.locale === locale);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/admin/slides');
      if (!response.ok) throw new Error(text.loadFailed);
      const result = await response.json() as { media: HomeSlideMedia[]; pages: SlidePage[]; slides: HomeSlide[] };
      const next = none();
      for (const slide of result.slides) next[slide.locale].push(local(slide));
      setSlides(next);
      setPages(result.pages);
      setMedia(Object.fromEntries(result.media.map((item) => [item.id, item])));
      setDirty({ en: false, th: false });
    } catch {
      setLoadError(text.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => { void load(); }, [load]);

  function edit(next: LocalSlide[]) {
    if (savingRef.current) return;
    setSlides((current) => ({ ...current, [locale]: next }));
    setDirty((current) => ({ ...current, [locale]: true }));
    setSaveError('');
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

  function move(from: number, to: number, button?: HTMLButtonElement) {
    if (savingRef.current || from === to || to < 0 || to >= items.length) return;
    const next = [...items];
    const [slide] = next.splice(from, 1);
    next.splice(to, 0, slide!);
    edit(next);
    setMessage(fill(text.moved, { from: from + 1, to: to + 1 }));
    if (button) requestAnimationFrame(() => (button.disabled ? addButton.current : button)?.focus());
  }

  function remove(index: number) {
    edit(items.filter((_, position) => position !== index));
    setMessage(fill(text.removed, { index: index + 1 }));
    // The nearest slide left takes the focus, as a menu item does; an empty list gives it to Add.
    requestAnimationFrame(() => {
      const edits = list.current?.querySelectorAll<HTMLButtonElement>('.navigation-item__actions > button:first-child');
      if (edits?.length) edits[Math.min(index, edits.length - 1)]!.focus();
      else addButton.current?.focus();
    });
  }

  function open(index: number | null) {
    if (index === null && items.length >= MAX_HOME_SLIDES) {
      setMessage(text.max);
      return;
    }
    setDraftError('');
    setDraft({ index, slide: index === null ? blank() : { ...items[index]! } });
  }

  const change = (patch: Partial<LocalSlide>) => setDraft((current) => current && { ...current, slide: { ...current.slide, ...patch } });

  /** The same rules the server keeps, said here so a slide is fixed before it is sent. */
  function problem(slide: LocalSlide): string {
    const picture = media[slide.mediaId];
    if (!picture) return text.needPicture;
    if (slide.overlay === 'none' && (slide.heading.trim() || slide.body.trim())) return text.needOverlay;
    if (!slide.heading.trim() && !picture.alt_text?.trim()) return text.needAlt;
    if (slide.buttonLabel.trim() && slide.linkKind === 'page' && !localePages.some((page) => page.id === slide.pageId)) return text.needPage;
    if (slide.buttonLabel.trim() && slide.linkKind === 'custom') {
      const url = normalizeNavigationUrl(slide.url);
      if (!url || url.length > 2048) return text.badUrl;
    }
    if (slide.startsAt && slide.endsAt && Date.parse(slide.endsAt) <= Date.parse(slide.startsAt)) return text.badWindow;
    return '';
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const found = problem(draft.slide);
    if (found) {
      setDraftError(found);
      return;
    }
    const next = draft.index === null ? [...items, draft.slide] : items.map((slide, index) => index === draft.index ? draft.slide : slide);
    edit(next);
    setMessage(draft.index === null ? text.added : fill(text.changed, { index: draft.index + 1 }));
    close();
  }

  function pick(asset: MediaAsset) {
    if (asset.width && asset.height) {
      setMedia((current) => ({ ...current, [asset.id]: {
        alt_text: asset.alt_text, height: asset.height!, id: asset.id, publicUrl: asset.publicUrl, size_bytes: asset.size_bytes, width: asset.width!,
      } }));
      change({ mediaId: asset.id });
    }
    setPicking(false);
  }

  async function save(retry = false) {
    if (savingRef.current || !dirty[locale]) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    setMessage(text.saving);
    try {
      const response = await atLeast(fetch('/api/admin/slides', {
        body: JSON.stringify({ locale, slides: items.map(mutation) }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }));
      if (!response.ok) throw new Error(text.saveError);
      const result = await response.json() as { slides: HomeSlide[] };
      setSlides((current) => ({ ...current, [locale]: result.slides.map(local) }));
      setDirty((current) => ({ ...current, [locale]: false }));
      setMessage(text.saved);
    } catch {
      setSaveError(text.saveError);
      setMessage('');
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (retry) requestAnimationFrame(() => addButton.current?.focus());
    }
  }

  const now = new Date();
  let liveSeen = 0;
  const describe = (slide: LocalSlide) => {
    const state = status(slide, now);
    if (state === 'live') return liveSeen++ < SHOWN_HOME_SLIDES ? text.status.live : text.beyondFive;
    if (state === 'waiting') return fill(text.status.waiting, { when: new Date(slide.startsAt).toLocaleString(ownerLocale ?? undefined) });
    return text.status[state];
  };
  const buttonNote = (slide: LocalSlide) => {
    const label = slide.buttonLabel.trim();
    if (!label) return '';
    if (slide.linkKind === 'page') {
      const page = pages.find((entry) => entry.id === slide.pageId);
      if (!page) return text.pageGone;
      if (page.status !== 'published') return text.pageDraft;
    }
    return fill(text.buttonTo, { label });
  };
  const draftPicture = draft ? media[draft.slide.mediaId] : undefined;

  return (<>
    <section className="admin-page navigation-manager home-slides">
      <header className="admin-page__head">
        <div><h1>{text.heading}</h1><p>{text.subheading}</p></div>
        <button className="admin-button admin-button--primary" disabled={loading || !!loadError || saving} onClick={() => open(null)} ref={addButton} type="button">{text.add}</button>
      </header>
      {!heroUsesSlides && <p className="admin-alert">{text.notShown} <a href={themesHref}>{text.openThemes}</a></p>}
      <p aria-atomic="true" aria-live="polite" className="navigation-status" role="status">{loading ? text.loading : message}</p>
      {loadError && <div className="admin-alert" role="alert">{loadError} <button className="admin-button" onClick={() => void load()} type="button">{text.retry}</button></div>}
      {!loading && !loadError && <>
        <div aria-label={text.language} className="navigation-tabs" role="tablist">
          {languages.map((tab) => (
            <button aria-controls="home-slides-panel" aria-selected={locale === tab.value} className="navigation-tab" id={`home-slides-${tab.value}-tab`} key={tab.value}
              onClick={() => setLocale(tab.value)} onKeyDown={switchTab} role="tab" tabIndex={locale === tab.value ? 0 : -1} type="button">
              {tab.label}{dirty[tab.value] ? ' •' : ''}
            </button>
          ))}
        </div>
        <div aria-busy={saving} aria-labelledby={`home-slides-${locale}-tab`} id="home-slides-panel" role="tabpanel" tabIndex={0}>
          {!items.length && (
            <div className="admin-empty navigation-empty">
              <span aria-hidden="true" className="admin-empty__mark"><Icon name="slides" /></span>
              <div><p>{text.empty}</p></div>
            </div>
          )}
          <ol aria-label={text.list} className="navigation-items" ref={list}>
            {items.map((slide, index) => {
              const picture = media[slide.mediaId];
              const note = buttonNote(slide);
              return (
                <li className="navigation-item" draggable={!saving} key={slide.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDragStart={() => { dragged.current = index; }}
                  onDrop={(event) => { event.preventDefault(); if (dragged.current !== null) move(dragged.current, index); dragged.current = null; }}>
                  <span aria-hidden="true" className="navigation-grip"><Icon name="grip" /></span>
                  <div className="navigation-item__content">
                    {picture ? <img alt="" className="home-slides-thumb" src={picture.publicUrl} /> : <span aria-hidden="true" className="home-slides-thumb" />}
                    <p>{slide.heading.trim() || text.pictureOnly}</p>
                    <p className="navigation-visibility">{describe(slide)}</p>
                    {note && <p className="navigation-target">{note}</p>}
                  </div>
                  <div aria-label={fill(text.actionsFor, { index: index + 1 })} className="navigation-item__actions" role="group">
                    <button aria-label={text.edit} className="admin-button admin-button--ghost admin-button--icon" disabled={saving} onClick={() => open(index)} title={text.edit} type="button"><Icon name="pencil" /></button>
                    <button aria-label={text.moveUp} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || index === 0} onClick={(event) => move(index, index - 1, event.currentTarget)} title={text.moveUp} type="button"><Icon name="up" /></button>
                    <button aria-label={text.moveDown} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || index === items.length - 1} onClick={(event) => move(index, index + 1, event.currentTarget)} title={text.moveDown} type="button"><Icon name="down" /></button>
                    <button aria-label={text.remove} className="admin-button admin-button--ghost admin-button--icon navigation-remove" disabled={saving} onClick={() => remove(index)} title={text.remove} type="button"><Icon name="trash" /></button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="navigation-save">
            <button aria-busy={saving} className="admin-button admin-button--primary" disabled={saving || !dirty[locale]} onClick={() => void save()} type="button">{text.save}</button>
            <span>{saving ? text.saving : dirty[locale] ? text.unsaved : text.noUnsaved}</span>
            <a href={`/${locale}`} rel="noopener noreferrer" target="_blank">{text.viewOnSite}</a>
          </div>
          {saveError && <div className="admin-alert" role="alert">{saveError} <button className="admin-button" disabled={saving} onClick={() => void save(true)} type="button">{text.retry}</button></div>}
        </div>
      </>}
    </section>
    {draft && (
      <dialog aria-label={draft.index === null ? text.newTitle : fill(text.editTitle, { index: draft.index + 1 })} className="admin-editor-settings"
        onCancel={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); close(); }} ref={dialog}>
        <form noValidate onSubmit={apply}>
          <div className="admin-editor-settings__head">
            <div><h2>{draft.index === null ? text.newTitle : fill(text.editTitle, { index: draft.index + 1 })}</h2></div>
            <button aria-label={text.close} className="admin-button admin-button--ghost admin-button--icon" onClick={() => close()} ref={closeButton} type="button"><Icon name="close" /></button>
          </div>
          <section className="drawer-group home-slides-picture">
            <h3>{text.picture}</h3>
            {draftPicture && <img alt="" src={draftPicture.publicUrl} />}
            <div aria-live="polite">
              {draftPicture && <p className="home-slides-note">{draftPicture.width} × {draftPicture.height} · {formatBytes(draftPicture.size_bytes)}</p>}
              {draftPicture && draftPicture.size_bytes > HEAVY_SLIDE_BYTES && <p className="home-slides-note">{fill(text.heavy, { size: formatBytes(draftPicture.size_bytes) })}</p>}
              {draftPicture && draftPicture.width < NARROW_SLIDE_PIXELS && <p className="home-slides-note">{fill(text.narrow, { width: draftPicture.width })}</p>}
            </div>
            <button className="admin-button" onClick={() => setPicking(true)} ref={pictureButton} type="button">{draftPicture ? text.changePicture : text.choosePicture}</button>
          </section>
          <section className="drawer-group">
            <label className="admin-field">{text.headingField}<input className="admin-control" maxLength={80} onChange={(event) => change({ heading: event.target.value })} value={draft.slide.heading} /></label>
            <label className="admin-field">{text.body}<textarea className="admin-control" maxLength={200} onChange={(event) => change({ body: event.target.value })} rows={3} value={draft.slide.body} /></label>
          </section>
          <section className="drawer-group">
            <label className="admin-field">{text.button}<input aria-describedby="home-slides-button-hint" className="admin-control" maxLength={30} onChange={(event) => change({ buttonLabel: event.target.value })} value={draft.slide.buttonLabel} /></label>
            <small id="home-slides-button-hint">{text.buttonHint}</small>
            {draft.slide.buttonLabel.trim() && <>
              <fieldset className="navigation-kinds">
                <legend>{text.linkTarget}</legend>
                {([['home', text.linkHome], ['page', text.linkPage], ['custom', text.linkCustom]] as const).map(([value, label]) => (
                  <label className="admin-check" key={value}><input checked={draft.slide.linkKind === value} name="home-slide-link" onChange={() => change({ linkKind: value })} type="radio" /><span>{label}</span></label>
                ))}
              </fieldset>
              {draft.slide.linkKind === 'page' && <div className="admin-field">
                <label htmlFor="home-slide-page">{text.page}</label>
                <UiSelect ariaLabel={text.page} className="admin-control" disabled={!localePages.length} id="home-slide-page"
                  onValueChange={(value) => change({ pageId: value })}
                  options={localePages.length ? localePages.map((page) => ({ label: page.title, value: page.id })) : [{ label: text.noPages, value: '' }]}
                  value={draft.slide.pageId} />
              </div>}
              {draft.slide.linkKind === 'custom' && <>
                <label className="admin-field">{text.url}<input className="admin-control" onChange={(event) => change({ url: event.target.value })} placeholder={text.urlPlaceholder} value={draft.slide.url} /></label>
                <label className="admin-check"><input checked={draft.slide.newTab} onChange={(event) => change({ newTab: event.target.checked })} type="checkbox" /><span>{text.newTab}</span></label>
              </>}
            </>}
          </section>
          <section className="drawer-group">
            <div className="admin-field"><label htmlFor="home-slide-align">{text.align}</label>
              <UiSelect ariaLabel={text.align} className="admin-control" id="home-slide-align" onValueChange={(value) => change({ align: value as HomeSlideAlign })}
                options={[{ label: text.alignStart, value: 'start' }, { label: text.alignCenter, value: 'center' }, { label: text.alignEnd, value: 'end' }]} value={draft.slide.align} /></div>
            <div className="admin-field"><label htmlFor="home-slide-overlay">{text.overlay}</label>
              <UiSelect ariaLabel={text.overlay} className="admin-control" id="home-slide-overlay" onValueChange={(value) => change({ overlay: value as HomeSlideOverlay })}
                options={[{ label: text.overlayNone, value: 'none' }, { label: text.overlaySoft, value: 'soft' }, { label: text.overlayStrong, value: 'strong' }]} value={draft.slide.overlay} /></div>
            <div className="admin-field"><label htmlFor="home-slide-focus">{text.focus}</label>
              <UiSelect ariaLabel={text.focus} className="admin-control" id="home-slide-focus" onValueChange={(value) => change({ focus: value as HomeSlideFocus })}
                options={HOME_SLIDE_FOCUS.map((value) => ({ label: text.focusLabels[value], value }))} value={draft.slide.focus} /></div>
          </section>
          <section className="drawer-group">
            <label className="admin-check"><input checked={draft.slide.enabled} onChange={(event) => change({ enabled: event.target.checked })} type="checkbox" /><span>{text.enabled}</span></label>
            <label className="admin-field">{text.starts}<input className="admin-control" onChange={(event) => change({ startsAt: fromInput(event.target.value) })} type="datetime-local" value={toInput(draft.slide.startsAt)} /></label>
            <label className="admin-field">{text.ends}<input className="admin-control" onChange={(event) => change({ endsAt: fromInput(event.target.value) })} type="datetime-local" value={toInput(draft.slide.endsAt)} /></label>
            <small>{text.timesHint}</small>
          </section>
          {draftError && <p className="admin-alert" role="alert">{draftError}</p>}
          <div className="navigation-dialog__actions">
            <button className="admin-button" onClick={() => close()} type="button">{text.cancel}</button>
            <button className="admin-button admin-button--primary" type="submit">{text.done}</button>
          </div>
        </form>
      </dialog>
    )}
    {picking && <MediaPicker kind="image" onCancel={() => setPicking(false)} onSelect={pick} ownerLocale={ownerLocale} returnFocus={pictureButton.current} />}
  </>);
}
