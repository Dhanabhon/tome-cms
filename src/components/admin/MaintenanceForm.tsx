import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { adminCopy, fill } from '../../lib/admin-i18n';
import { atLeast } from '../../lib/busy';
import { HEAVY_SLIDE_BYTES, NARROW_SLIDE_PIXELS } from '../../lib/home-slides';
import { fromLocalInput, toLocalInput } from '../../lib/local-datetime';
import { formatBytes } from '../../lib/media';
import {
  DEFAULT_MAINTENANCE_WORDS,
  MAINTENANCE_TEMPLATES,
  type MaintenanceSettings,
  type MaintenanceTemplate,
} from '../../lib/site-maintenance';
import { confirmUi } from '../../lib/ui-dialog';
import type { HomeSlideMedia, MediaAsset, PageLocale, PostLocale } from '../../types/cms';
import MediaPicker from './MediaPicker';
import { moveTabFocus } from './tabs';

/** The page as the form holds it: every field a string, converted only on save. */
interface Draft {
  backAt: string;
  copy: Record<PageLocale, { heading: string; message: string }>;
  mediaId: string;
  template: MaintenanceTemplate;
}

// Autonyms stay in their own language; the rest follows the owner's.
const languages = [{ value: 'th', label: 'ไทย' }, { value: 'en', label: 'English' }] as const;

const draftOf = (page: MaintenanceSettings): Draft => ({
  backAt: page.backAt ?? '',
  copy: {
    en: { heading: page.copy.en?.heading ?? '', message: page.copy.en?.message ?? '' },
    th: { heading: page.copy.th?.heading ?? '', message: page.copy.th?.message ?? '' },
  },
  mediaId: page.mediaId ?? '',
  template: page.template,
});

interface MaintenanceFormProps {
  ownerLocale?: PostLocale | null;
  previewHref: string;
}

export default function MaintenanceForm({ ownerLocale, previewHref }: MaintenanceFormProps) {
  const copy = adminCopy(ownerLocale);
  const text = copy.maintenance;
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [media, setMedia] = useState<HomeSlideMedia | null>(null);
  const [locale, setLocale] = useState<PageLocale>('th');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'save' | 'state' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const pictureButton = useRef<HTMLButtonElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetch('/api/admin/maintenance');
      if (!response.ok) throw new Error(text.loadFailed);
      const result = await response.json() as { maintenance: MaintenanceSettings; media: HomeSlideMedia | null };
      const next = draftOf(result.maintenance);
      setEnabled(result.maintenance.enabled);
      setSaved(next);
      setDraft(next);
      setMedia(result.media);
    } catch {
      setLoadError(text.loadFailed);
    }
  }, [text]);

  useEffect(() => { void load(); }, [load]);

  const change = (patch: Partial<Draft>) => {
    setDraft((current) => current && { ...current, ...patch });
    setStatus('');
    setError('');
  };
  const changeWords = (patch: Partial<Draft['copy'][PageLocale]>) => {
    setDraft((current) => current && {
      ...current, copy: { ...current.copy, [locale]: { ...current.copy[locale], ...patch } },
    });
    setStatus('');
    setError('');
  };

  /** The same rules the server keeps, said here so the page is fixed before it is sent. */
  function problem(page: Draft): string {
    if (page.template === 'picture' && !page.mediaId) return text.needPicture;
    if (page.template === 'countdown' && !page.backAt) return text.needBack;
    return '';
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy || !dirty) return;
    const found = problem(draft);
    if (found) {
      setError(found);
      return;
    }
    setBusy('save');
    setError('');
    setStatus(text.saving);
    try {
      const response = await atLeast(fetch('/api/admin/maintenance', {
        // A picture chosen and then left for another template is not kept: it would stop the
        // library deleting a file the page no longer shows.
        body: JSON.stringify({
          backAt: draft.backAt || null,
          copy: draft.copy,
          mediaId: draft.template === 'picture' ? draft.mediaId || null : null,
          template: draft.template,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }));
      if (!response.ok) throw new Error(text.saveError);
      const next = draftOf((await response.json() as { maintenance: MaintenanceSettings }).maintenance);
      setSaved(next);
      setDraft(next);
      setStatus(text.saved);
    } catch {
      setError(text.saveError);
      setStatus('');
    } finally {
      setBusy(null);
    }
  }

  async function switchState() {
    if (busy) return;
    const next = !enabled;
    if (next && !(await confirmUi({ cancelLabel: text.cancel, confirmLabel: text.confirm, message: text.confirmBody, title: text.confirmTitle }))) return;
    setBusy('state');
    setError('');
    try {
      const response = await atLeast(fetch('/api/admin/maintenance/state', {
        body: JSON.stringify({ enabled: next }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }));
      if (!response.ok) throw new Error(text.stateError);
      setEnabled(next);
      setStatus(next ? text.turnedOn : text.turnedOff);
    } catch {
      setError(text.stateError);
    } finally {
      setBusy(null);
    }
  }

  function pick(asset: MediaAsset) {
    if (asset.width && asset.height) {
      setMedia({ alt_text: asset.alt_text, height: asset.height, id: asset.id, publicUrl: asset.publicUrl, size_bytes: asset.size_bytes, width: asset.width });
      change({ mediaId: asset.id });
    }
    setPicking(false);
  }

  if (!draft) {
    return loadError
      ? <div className="admin-alert" role="alert">{loadError} <button className="admin-button" onClick={() => void load()} type="button">{text.retry}</button></div>
      : <p role="status">{text.loading}</p>;
  }
  const picture = media && media.id === draft.mediaId ? media : null;

  return (<>
    <section className="admin-page admin-form-page maintenance-screen">
      <header className="admin-page__head"><div><h1>{text.heading}</h1><p>{text.subheading}</p></div></header>
      <div className="admin-card-stack">
        <section aria-labelledby="maintenance-state-heading" className="admin-card maintenance-state" data-enabled={enabled}>
          <header className="admin-card__head">
            <h2 id="maintenance-state-heading">{text.stateGroup}</h2>
            <p>{enabled ? text.closed : text.open}</p>
          </header>
          <div className="maintenance-state__actions">
            <button aria-busy={busy === 'state'} aria-describedby={!enabled && dirty ? 'maintenance-save-first' : undefined}
              className={`admin-button ${enabled ? 'admin-button--secondary' : 'admin-button--primary'}`}
              disabled={busy !== null || (!enabled && dirty)} onClick={() => void switchState()} type="button">
              {enabled ? text.turnOff : text.turnOn}
            </button>
            {!enabled && dirty && <small id="maintenance-save-first">{text.saveFirst}</small>}
          </div>
        </section>

        <form className="admin-card-stack" noValidate onSubmit={(event) => void save(event)}>
          <section aria-labelledby="maintenance-template-heading" className="admin-card">
            <header className="admin-card__head"><h2 id="maintenance-template-heading">{text.templateGroup}</h2></header>
            <fieldset aria-labelledby="maintenance-template-heading" className="maintenance-templates">
              {MAINTENANCE_TEMPLATES.map((value) => (
                <label className="maintenance-template" key={value}>
                  <input checked={draft.template === value} name="maintenance-template" onChange={() => change({ template: value })} type="radio" />
                  <span aria-hidden="true" className="maintenance-template__sketch" data-template={value}><span /><span /><span /></span>
                  <strong>{text.templates[value]}</strong>
                  <small>{text.templateHints[value]}</small>
                </label>
              ))}
            </fieldset>
          </section>

          <section aria-labelledby="maintenance-words-heading" className="admin-card">
            <header className="admin-card__head"><h2 id="maintenance-words-heading">{text.wordsGroup}</h2><p>{text.wordsHint}</p></header>
            <div aria-label={text.language} className="navigation-tabs" role="tablist">
              {languages.map((tab) => (
                <button aria-controls="maintenance-words-panel" aria-selected={locale === tab.value} className="navigation-tab" id={`maintenance-${tab.value}-tab`} key={tab.value}
                  onClick={() => setLocale(tab.value)} onKeyDown={moveTabFocus} role="tab" tabIndex={locale === tab.value ? 0 : -1} type="button">
                  {tab.label}
                </button>
              ))}
            </div>
            <div aria-labelledby={`maintenance-${locale}-tab`} className="maintenance-words" id="maintenance-words-panel" role="tabpanel">
              <label className="admin-field">{text.headingField}
                <input className="admin-control" maxLength={80} onChange={(event) => changeWords({ heading: event.target.value })}
                  placeholder={DEFAULT_MAINTENANCE_WORDS[locale].heading} value={draft.copy[locale].heading} />
              </label>
              <label className="admin-field">{text.message}
                <textarea className="admin-control admin-control--textarea" maxLength={280} onChange={(event) => changeWords({ message: event.target.value })}
                  placeholder={DEFAULT_MAINTENANCE_WORDS[locale].message} rows={3} value={draft.copy[locale].message} />
              </label>
            </div>
          </section>

          {draft.template === 'picture' && (
            <section aria-labelledby="maintenance-picture-heading" className="admin-card">
              <header className="admin-card__head"><h2 id="maintenance-picture-heading">{text.pictureGroup}</h2></header>
              <div className="admin-field">
                {picture && <img alt="" className="admin-cover-preview maintenance-preview" src={picture.publicUrl} />}
                <div className="admin-cover-actions">
                  <button aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={() => setPicking(true)} ref={pictureButton} type="button">
                    {picture ? text.changePicture : text.choosePicture}
                  </button>
                </div>
                <div aria-live="polite" className="maintenance-facts">
                  {picture && <small>{picture.width} × {picture.height} · {formatBytes(picture.size_bytes)}</small>}
                  {picture && picture.size_bytes > HEAVY_SLIDE_BYTES && <small>{fill(text.heavy, { size: formatBytes(picture.size_bytes) })}</small>}
                  {picture && picture.width < NARROW_SLIDE_PIXELS && <small>{fill(text.narrow, { width: picture.width })}</small>}
                </div>
              </div>
            </section>
          )}

          <section aria-labelledby="maintenance-back-heading" className="admin-card">
            <header className="admin-card__head"><h2 id="maintenance-back-heading">{text.backGroup}</h2><p>{text.backHint}</p></header>
            <label className="admin-field">{text.backAt}
              <input className="admin-control" onChange={(event) => change({ backAt: fromLocalInput(event.target.value) ?? '' })}
                required={draft.template === 'countdown'} type="datetime-local" value={toLocalInput(draft.backAt)} />
            </label>
          </section>

          {error && <p className="admin-form-error" role="alert">{error}</p>}
          <div className="admin-save-bar">
            <button aria-busy={busy === 'save'} className="admin-button admin-button--primary" disabled={busy !== null || !dirty} type="submit">{text.save}</button>
            <a aria-label={text.previewLabel} className="admin-button admin-button--secondary" href={`${previewHref}?lang=${locale}`} rel="noopener" target="_blank">{text.preview}</a>
            <p role="status">{busy === 'save' ? text.saving : status || (dirty ? `${text.unsaved} · ${text.previewSaved}` : text.noChanges)}</p>
          </div>
        </form>
      </div>
    </section>
    {picking && <MediaPicker kind="image" onCancel={() => setPicking(false)} onSelect={pick} ownerLocale={ownerLocale} returnFocus={pictureButton.current} />}
  </>);
}
