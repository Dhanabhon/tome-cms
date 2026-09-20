import { useState, type FormEvent } from 'react';

import { adminCopy } from '../../lib/admin-i18n';
import { THEME_MANIFESTS } from '../../themes/manifests';
import { DEFAULT_THEME_ID, isThemeId } from '../../themes/registry';
import type { PostLocale, SiteSettings } from '../../types/cms';
import UiSelect from './UiSelect';

const THEME_CHOICES = THEME_MANIFESTS.map(({ id, name }) => ({ label: name, value: id }));

/** Everything the settings record holds, because a write has to send all of it. */
type ThemeSettings = Pick<
  SiteSettings,
  'site_name' | 'tagline' | 'site_description' | 'default_locale' | 'theme' | 'theme_id'
  | 'allow_visitor_theme' | 'show_powered_by' | 'timezone' | 'updated_at'
>;

interface ThemeFormProps {
  initialSettings: ThemeSettings;
  ownerLocale?: PostLocale | null;
}

interface SaveResult {
  error?: string;
  issues?: { properties?: Record<string, { errors?: string[] }> };
  settings?: { updated_at?: string };
}

export default function ThemeForm({ initialSettings, ownerLocale }: ThemeFormProps) {
  const copy = adminCopy(ownerLocale);
  const [theme, setTheme] = useState(initialSettings.theme);
  const [allowVisitorTheme, setAllowVisitorTheme] = useState(initialSettings.allow_visitor_theme);
  // A theme can leave in a release while its id stays in the database. The site falls back
  // to the default for one it does not know, and so does the control, so that what the
  // owner is shown is what a save would store.
  const [themeId, setThemeId] = useState(isThemeId(initialSettings.theme_id) ? initialSettings.theme_id : DEFAULT_THEME_ID);
  const [updatedAt, setUpdatedAt] = useState(initialSettings.updated_at);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [themeError, setThemeError] = useState('');
  const [status, setStatus] = useState('');

  /** Serialised, so a value edited and edited back counts as clean. */
  const snapshot = (values: readonly unknown[]) => JSON.stringify(values);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot([
    initialSettings.theme, initialSettings.allow_visitor_theme, initialSettings.theme_id,
  ]));
  const currentSnapshot = snapshot([theme, allowVisitorTheme, themeId]);
  const dirty = currentSnapshot !== savedSnapshot;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setThemeError('');
    setStatus('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // The settings record is written whole. The five fields this screen does not show
        // are carried back exactly as they were drawn, and updatedAt is what makes that
        // safe: if the Settings screen saved since, the write is refused rather than
        // quietly putting its old values back.
        body: JSON.stringify({
          allowVisitorTheme,
          defaultLocale: initialSettings.default_locale,
          showPoweredBy: initialSettings.show_powered_by,
          siteDescription: initialSettings.site_description,
          siteName: initialSettings.site_name,
          tagline: initialSettings.tagline,
          theme,
          themeId,
          timezone: initialSettings.timezone,
          updatedAt,
        }),
      });
      const result = await response.json().catch(() => ({})) as SaveResult;
      if (!response.ok) {
        setThemeError(result.issues?.properties?.theme?.errors?.join(' ') ?? '');
        throw new Error(result.error ?? copy.settings.saveFailed);
      }
      if (typeof result.settings?.updated_at !== 'string') throw new Error(copy.settings.incompleteResponse);
      setUpdatedAt(result.settings.updated_at);
      setSavedSnapshot(currentSnapshot);
      setStatus(copy.settings.saved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.settings.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="admin-settings-form" noValidate onSubmit={save}>
      <fieldset disabled={saving}>
        <div className="admin-card-stack">

          <section className="admin-card" aria-labelledby="themes-appearance-heading">
            <header className="admin-card__head">
              <h2 id="themes-appearance-heading">{copy.settings.appearance}</h2>
              <p>{copy.settings.appearanceHint}</p>
            </header>
            <div className="admin-field">
              <label htmlFor="themeId">{copy.settings.theme}</label>
              <UiSelect ariaDescribedBy="themeId-hint" className="admin-control" id="themeId" name="themeId" options={THEME_CHOICES} value={themeId} onValueChange={(next) => { setThemeId(next as typeof themeId); setStatus(''); }} />
              <small id="themeId-hint">{copy.settings.themeHint}</small>
            </div>
            <div className="admin-field admin-field--short">
              <label htmlFor="theme">{copy.theme.siteLabel}</label>
              <UiSelect ariaDescribedBy="theme-error" className="admin-control" id="theme" invalid={Boolean(themeError)} name="theme" options={[{ label: copy.theme.system, value: 'system' }, { label: copy.theme.light, value: 'light' }, { label: copy.theme.dark, value: 'dark' }]} value={theme} onValueChange={(next) => { setTheme(next as SiteSettings['theme']); setStatus(''); setThemeError(''); }} />
              <p className="admin-field-error" id="theme-error" aria-live="polite">{themeError}</p>
            </div>
            <div className="admin-check">
              <label>
                <input
                  aria-describedby="allowVisitorTheme-help"
                  checked={allowVisitorTheme}
                  name="allowVisitorTheme"
                  onChange={(event) => { setAllowVisitorTheme(event.target.checked); setStatus(''); }}
                  type="checkbox"
                />
                <span>{copy.theme.visitorLabel}</span>
              </label>
              <small id="allowVisitorTheme-help">{copy.theme.visitorHint}</small>
            </div>
          </section>

        </div>
      </fieldset>
      <p className="admin-form-error" role="alert">{error}</p>
      <div className="admin-save-bar">
        <button aria-busy={saving} className="admin-button admin-button--primary" type="submit" disabled={saving || !dirty}>{copy.settings.save}</button>
        <p role="status">{saving ? copy.settings.saving : dirty ? copy.settings.unsaved : status}</p>
      </div>
    </form>
  );
}
