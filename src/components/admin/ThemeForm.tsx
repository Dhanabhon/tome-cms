import { useEffect, useRef, useState, type FormEvent } from 'react';

import { adminCopy, fill, type AdminCopy } from '../../lib/admin-i18n';
import { adminHref } from '../../lib/admin';
import { THEME_MANIFESTS } from '../../themes/manifests';
import type { ThemeManifest } from '../../themes/contract';
import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from '../../themes/registry';
import type { PostLocale, SiteSettings } from '../../types/cms';
import Icon from '../Icon';
import UiSelect from './UiSelect';

/** Everything the settings record holds, because a write has to send all of it. */
type ThemeSettings = Pick<
  SiteSettings,
  'site_name' | 'tagline' | 'site_description' | 'default_locale' | 'theme' | 'theme_id'
  | 'allow_visitor_theme' | 'show_powered_by' | 'timezone' | 'updated_at'
>;

interface ThemeFormProps {
  adminPath: string;
  initialSettings: ThemeSettings;
  /** What the theme in use has been told. Only the one in use is customisable. */
  initialThemeSettings: Record<string, string>;
  ownerLocale?: PostLocale | null;
}

interface SaveResult {
  error?: string;
  settings?: { updated_at?: string };
}

/** The three this screen owns. Everything else in the record travels back untouched. */
interface Draft {
  allowVisitorTheme: boolean;
  theme: SiteSettings['theme'];
  themeId: ThemeId;
}

export default function ThemeForm({ adminPath, initialSettings, initialThemeSettings, ownerLocale }: ThemeFormProps) {
  const copy = adminCopy(ownerLocale);
  const locale = ownerLocale === 'th' ? 'th' : 'en';
  // A theme can leave in a release while its id stays in the database. The site falls back
  // to the default for one it does not know, and so does this screen, so that the card
  // marked in use is the one a reader is being served.
  const [draft, setDraft] = useState<Draft>({
    allowVisitorTheme: initialSettings.allow_visitor_theme,
    theme: initialSettings.theme,
    themeId: isThemeId(initialSettings.theme_id) ? initialSettings.theme_id : DEFAULT_THEME_ID,
  });
  const [updatedAt, setUpdatedAt] = useState(initialSettings.updated_at);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [customizing, setCustomizing] = useState(false);
  const [themeValues, setThemeValues] = useState(initialThemeSettings);

  /**
   * Every control here applies on the spot, so there is no save bar and nothing to leave
   * unsaved. The record is written whole: the six fields this screen does not show are
   * carried back exactly as they were drawn, and updatedAt is what makes that safe -- if
   * Settings saved since, the write is refused rather than quietly undoing it.
   */
  const write = async (change: Partial<Draft>, said: string, marker: string) => {
    if (busy) return;
    const next = { ...draft, ...change };
    setBusy(marker);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          allowVisitorTheme: next.allowVisitorTheme,
          defaultLocale: initialSettings.default_locale,
          showPoweredBy: initialSettings.show_powered_by,
          siteDescription: initialSettings.site_description,
          siteName: initialSettings.site_name,
          tagline: initialSettings.tagline,
          theme: next.theme,
          themeId: next.themeId,
          timezone: initialSettings.timezone,
          updatedAt,
        }),
      });
      const result = await response.json().catch(() => ({})) as SaveResult;
      if (!response.ok) throw new Error(result.error ?? copy.theme.activateFailed);
      if (typeof result.settings?.updated_at !== 'string') throw new Error(copy.settings.incompleteResponse);
      setUpdatedAt(result.settings.updated_at);
      setDraft(next);
      setStatus(said);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.theme.activateFailed);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="admin-card-stack">
      <ul className="theme-grid">
        {THEME_MANIFESTS.map((manifest) => {
          const { description, id, name } = manifest;
          const inUse = id === draft.themeId;
          return (
            <li className="theme-card" key={id} data-in-use={inUse ? '' : undefined}>
              {/* The theme, drawing this site's own posts. It is a picture of the card's
                  subject rather than a control, so it is out of the tab order and takes no
                  pointer -- the button below it is the only thing here to press. */}
              <span className="theme-card__preview">
                <iframe
                  loading="lazy"
                  src={adminHref({ admin_path: adminPath }, `/themes/preview/${id}`)}
                  tabIndex={-1}
                  title={fill(copy.theme.previewLabel, { name })}
                />
              </span>
              <span className="theme-card__body">
                <strong className="theme-card__name">{name}</strong>
                <span className="theme-card__note">{description}</span>
              </span>
              <span className="theme-card__foot">
                {inUse ? (
                  <>
                    <span className="theme-card__mark"><Icon name="check" />{copy.theme.active}</span>
                    {Boolean(manifest.settings?.length) && (
                      <button className="admin-button admin-button--secondary" onClick={() => setCustomizing(true)} type="button">
                        {copy.theme.customize}
                      </button>
                    )}
                    <a className="admin-button admin-button--secondary" href="/" rel="noopener noreferrer" target="_blank">
                      <Icon name="external" /><span>{copy.shell.viewSite}</span>
                    </a>
                  </>
                ) : (
                  <button
                    aria-busy={busy === id}
                    className="admin-button admin-button--primary"
                    disabled={Boolean(busy)}
                    onClick={() => write({ themeId: id as ThemeId }, fill(copy.theme.activated, { name }), id)}
                    type="button"
                  >
                    {copy.theme.activate}
                  </button>
                )}
              </span>
            </li>
          );
        })}
        {/* Not a button. Nothing here can install a theme, and a dashed card with a plus in
            it would say otherwise; this says where the next one actually comes from. */}
        <li className="theme-card theme-card--source">
          <strong className="theme-card__name">{copy.theme.sourceTitle}</strong>
          <span className="theme-card__note">{copy.theme.sourceBody}</span>
        </li>
      </ul>

      {customizing && (
        <ThemeCustomize
          copy={copy}
          locale={locale}
          manifest={THEME_MANIFESTS.find(({ id }) => id === draft.themeId)!}
          onClose={() => setCustomizing(false)}
          onSaved={(next) => { setThemeValues(next); setCustomizing(false); setError(''); setStatus(copy.theme.customized); }}
          values={themeValues}
        />
      )}

      <div className="theme-report">
        <p className="admin-form-error" role="alert">{error}</p>
        <p className="theme-status" role="status">{busy ? copy.settings.saving : status}</p>
      </div>

      <section className="admin-card" aria-labelledby="themes-appearance-heading">
        <header className="admin-card__head">
          <h2 id="themes-appearance-heading">{copy.settings.appearance}</h2>
          <p>{copy.theme.siteHint}</p>
        </header>
        <div className="admin-field admin-field--short">
          <label htmlFor="theme">{copy.theme.siteLabel}</label>
          <UiSelect
            className="admin-control"
            id="theme"
            name="theme"
            options={[{ label: copy.theme.system, value: 'system' }, { label: copy.theme.light, value: 'light' }, { label: copy.theme.dark, value: 'dark' }]}
            value={draft.theme}
            onValueChange={(next) => write({ theme: next as SiteSettings['theme'] }, copy.settings.saved, 'theme')}
          />
        </div>
        <div className="admin-check">
          <label>
            <input
              aria-describedby="allowVisitorTheme-help"
              checked={draft.allowVisitorTheme}
              name="allowVisitorTheme"
              onChange={(event) => write({ allowVisitorTheme: event.target.checked }, copy.settings.saved, 'allowVisitorTheme')}
              type="checkbox"
            />
            <span>{copy.theme.visitorLabel}</span>
          </label>
          <small id="allowVisitorTheme-help">{copy.theme.visitorHint}</small>
        </div>
      </section>

    </div>
  );
}

interface ThemeCustomizeProps {
  copy: AdminCopy;
  locale: 'en' | 'th';
  manifest: ThemeManifest;
  onClose: () => void;
  onSaved: (values: Record<string, string>) => void;
  values: Record<string, string>;
}

/**
 * A theme's own settings, in the panel the admin already uses for a panel of fields.
 *
 * The controls come from the manifest rather than from a form written per theme, which is
 * what keeps a theme from needing a screen of its own -- and what stops it from drawing one.
 * The same arrangement the plugins have.
 */
function ThemeCustomize({ copy, locale, manifest, onClose, onSaved, values }: ThemeCustomizeProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    closeButton.current?.focus();
    return () => {
      element.close();
      opener?.focus();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    // A switch sends nothing when it is off, so every declared key is named either way --
    // the store reads an absent key as "leave it", which is not what an unticked box means.
    const sent = Object.fromEntries((manifest.settings ?? []).map((setting) => [
      setting.key,
      setting.kind === 'switch' ? (form.get(setting.key) === 'on' ? 'on' : 'off') : String(form.get(setting.key) ?? setting.fallback),
    ]));
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/themes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: manifest.id, values: sent }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; settings?: Record<string, string> } | null;
      if (!response.ok || !payload?.settings) throw new Error(payload?.error || copy.theme.customizeFailed);
      onSaved(payload.settings);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.theme.customizeFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      aria-label={fill(copy.theme.customizeTitle, { name: manifest.name })}
      className="admin-editor-settings"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialog}
    >
      <header className="admin-editor-settings__head">
        <div>
          <h2>{fill(copy.theme.customizeTitle, { name: manifest.name })}</h2>
          <p>{manifest.description}</p>
        </div>
        <button
          aria-label={copy.plugins.close}
          className="admin-button admin-button--ghost admin-button--icon"
          onClick={onClose}
          ref={closeButton}
          type="button"
        >
          <Icon name="close" />
        </button>
      </header>
      <form className="plugin-setup" onSubmit={submit}>
        <fieldset disabled={busy}>
          {(manifest.settings ?? []).map((setting) => (
            setting.kind === 'switch' ? (
              <div className="admin-check" key={setting.key}>
                <label>
                  <input defaultChecked={values[setting.key] !== 'off'} name={setting.key} type="checkbox" />
                  <span>{setting.label[locale]}</span>
                </label>
                {setting.hint && <small>{setting.hint[locale]}</small>}
              </div>
            ) : (
              <div className="admin-field admin-field--short" key={setting.key}>
                <label htmlFor={`theme-${setting.key}`}>{setting.label[locale]}</label>
                <UiSelect
                  className="admin-control"
                  defaultValue={values[setting.key] ?? setting.fallback}
                  id={`theme-${setting.key}`}
                  name={setting.key}
                  options={(setting.options ?? []).map((option) => ({ label: option.label[locale], value: option.value }))}
                />
                {setting.hint && <small>{setting.hint[locale]}</small>}
              </div>
            )
          ))}
          <p className="admin-form-error" role="alert">{error}</p>
          <div className="admin-form-actions">
            <button aria-busy={busy} className="admin-button admin-button--primary" type="submit">
              {copy.settings.save}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
