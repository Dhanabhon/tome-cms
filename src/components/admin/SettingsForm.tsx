import { useState, type FormEvent } from 'react';

import { adminCopy } from '../../lib/admin-i18n';
import type { PostLocale, SiteSettings } from '../../types/cms';
import UiSelect from './UiSelect';

interface SettingsFormProps {
  ownerLocale?: PostLocale | null;
  initialSettings: Pick<SiteSettings, 'site_name' | 'tagline' | 'site_description' | 'default_locale' | 'theme' | 'allow_visitor_theme' | 'show_powered_by' | 'timezone' | 'updated_at'>;
}

interface IssueNode {
  errors?: string[];
  properties?: Record<string, IssueNode>;
}

interface SaveResult {
  error?: string;
  issues?: IssueNode;
  settings?: { updated_at?: string };
}

export default function SettingsForm({ initialSettings, ownerLocale }: SettingsFormProps) {
  const copy = adminCopy(ownerLocale);
  const [siteName, setSiteName] = useState(initialSettings.site_name);
  const [tagline, setTagline] = useState(initialSettings.tagline);
  const [siteDescription, setSiteDescription] = useState(initialSettings.site_description);
  const [defaultLocale, setDefaultLocale] = useState(initialSettings.default_locale);
  const [theme, setTheme] = useState(initialSettings.theme);
  const [allowVisitorTheme, setAllowVisitorTheme] = useState(initialSettings.allow_visitor_theme);
  const [showPoweredBy, setShowPoweredBy] = useState(initialSettings.show_powered_by);
  const [timezone, setTimezone] = useState(initialSettings.timezone);
  const [updatedAt, setUpdatedAt] = useState(initialSettings.updated_at);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');

  /** Serialised, so a value edited and edited back counts as clean. */
  const snapshot = (values: readonly unknown[]) => JSON.stringify(values);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot([
    initialSettings.site_name, initialSettings.tagline, initialSettings.site_description,
    initialSettings.default_locale, initialSettings.timezone, initialSettings.theme,
    initialSettings.allow_visitor_theme,
    initialSettings.show_powered_by,
  ]));
  const currentSnapshot = snapshot([siteName, tagline, siteDescription, defaultLocale, timezone, theme, allowVisitorTheme, showPoweredBy]);
  const dirty = currentSnapshot !== savedSnapshot;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setFieldErrors({});
    setStatus('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowVisitorTheme, defaultLocale, showPoweredBy, siteDescription, siteName, tagline, theme, timezone, updatedAt }),
      });
      const result = await response.json().catch(() => ({})) as SaveResult;
      if (!response.ok) {
        const fields: Record<string, string> = {};
        for (const name of ['siteName', 'tagline', 'siteDescription', 'defaultLocale', 'theme', 'timezone']) {
          fields[name] = result.issues?.properties?.[name]?.errors?.join(' ') ?? '';
        }
        setFieldErrors(fields);
        throw new Error(result.error ?? copy.settings.saveFailed);
      }
      if (typeof result.settings?.updated_at !== 'string') throw new Error(copy.settings.incompleteResponse);
      setUpdatedAt(result.settings.updated_at);
      setSavedSnapshot(currentSnapshot);
      // The admin's language, its date format and the site name in the sidebar are all
      // read from the database when the server renders the page -- adminCopy(), the
      // lang attribute and AdminShell each take them as props. No amount of state in
      // this island reaches them, so when one of the three changes the page has to be
      // asked for again. Saving is the moment to do that, rather than leaving the owner
      // to work out that a reload is what applies the change they just made.
      if (
        defaultLocale !== initialSettings.default_locale
        || timezone !== initialSettings.timezone
        || siteName !== initialSettings.site_name
      ) {
        window.location.reload();
        return;
      }
      setStatus(copy.settings.saved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.settings.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="admin-settings-form" noValidate onSubmit={save} onChange={(event) => {
      setStatus('');
      const name = (event.target as HTMLInputElement).name;
      setFieldErrors((current) => ({ ...current, [name]: '' }));
    }}>
      <fieldset disabled={saving}>
        <div className="admin-card-stack">

          <section className="admin-card" aria-labelledby="settings-identity-heading">
            <header className="admin-card__head">
              <h2 id="settings-identity-heading">{copy.settings.identity}</h2>
              <p>{copy.settings.identityHint}</p>
            </header>
            <div className="admin-field admin-field--name">
              <label htmlFor="siteName">{copy.settings.siteName}</label>
              <input className="admin-control" id="siteName" name="siteName" aria-invalid={Boolean(fieldErrors.siteName)} aria-describedby="siteName-error" required maxLength={120} value={siteName} onChange={(event) => setSiteName(event.target.value)} />
              <p className="admin-field-error" id="siteName-error" aria-live="polite">{fieldErrors.siteName}</p>
            </div>
            <div className="admin-field">
              <label htmlFor="tagline">{copy.settings.tagline}</label>
              <input className="admin-control" id="tagline" name="tagline" aria-invalid={Boolean(fieldErrors.tagline)} aria-describedby="tagline-error" maxLength={120} placeholder={copy.settings.taglinePlaceholder} value={tagline} onChange={(event) => setTagline(event.target.value)} />
              <p className="admin-field-error" id="tagline-error" aria-live="polite">{fieldErrors.tagline}</p>
            </div>
            <div className="admin-field">
              <label htmlFor="siteDescription">{copy.settings.siteDescription}</label>
              <textarea className="admin-control admin-control--textarea" id="siteDescription" name="siteDescription" aria-invalid={Boolean(fieldErrors.siteDescription)} aria-describedby="siteDescription-error" maxLength={160} value={siteDescription} onChange={(event) => setSiteDescription(event.target.value)} />
              <p className="admin-field-error" id="siteDescription-error" aria-live="polite">{fieldErrors.siteDescription}</p>
            </div>
            <div className="admin-check">
              <label>
                <input
                  aria-describedby="showPoweredBy-help"
                  checked={showPoweredBy}
                  name="showPoweredBy"
                  onChange={(event) => { setShowPoweredBy(event.target.checked); setStatus(''); }}
                  type="checkbox"
                />
                <span>{copy.settings.poweredByLabel}</span>
              </label>
              <small id="showPoweredBy-help">{copy.settings.poweredByHint}</small>
            </div>
          </section>

          <section className="admin-card" aria-labelledby="settings-regional-heading">
            <header className="admin-card__head">
              <h2 id="settings-regional-heading">{copy.settings.regional}</h2>
              <p>{copy.settings.regionalHint}</p>
            </header>
            <div className="settings-pair">
              <div className="admin-field">
                <label htmlFor="defaultLocale">{copy.settings.defaultLanguage}</label>
                <UiSelect ariaDescribedBy="defaultLocale-error" className="admin-control" id="defaultLocale" invalid={Boolean(fieldErrors.defaultLocale)} name="defaultLocale" options={[{ label: copy.filters.thai, value: 'th' }, { label: copy.filters.english, value: 'en' }]} value={defaultLocale} onValueChange={(next) => { setDefaultLocale(next as SiteSettings['default_locale']); setStatus(''); setFieldErrors((current) => ({ ...current, defaultLocale: '' })); }} />
                <p className="admin-field-error" id="defaultLocale-error" aria-live="polite">{fieldErrors.defaultLocale}</p>
              </div>
              <div className="admin-field">
                <label htmlFor="timezone">{copy.settings.timezone}</label>
                <UiSelect ariaDescribedBy="timezone-error" className="admin-control" id="timezone" invalid={Boolean(fieldErrors.timezone)} name="timezone" options={[{ label: 'Asia/Bangkok', value: 'Asia/Bangkok' }, { label: 'UTC', value: 'UTC' }]} value={timezone} onValueChange={(next) => { setTimezone(next as SiteSettings['timezone']); setStatus(''); setFieldErrors((current) => ({ ...current, timezone: '' })); }} />
                <p className="admin-field-error" id="timezone-error" aria-live="polite">{fieldErrors.timezone}</p>
              </div>
            </div>
          </section>

          <section className="admin-card" aria-labelledby="settings-theme-heading">
            <header className="admin-card__head">
              <h2 id="settings-theme-heading">{copy.theme.group}</h2>
              <p id="theme-hint">{copy.theme.siteHint}</p>
            </header>
            <div className="admin-field admin-field--short">
              <label htmlFor="theme">{copy.theme.siteLabel}</label>
              <UiSelect ariaDescribedBy="theme-hint theme-error" className="admin-control" id="theme" invalid={Boolean(fieldErrors.theme)} name="theme" options={[{ label: copy.theme.system, value: 'system' }, { label: copy.theme.light, value: 'light' }, { label: copy.theme.dark, value: 'dark' }]} value={theme} onValueChange={(next) => { setTheme(next as SiteSettings['theme']); setStatus(''); setFieldErrors((current) => ({ ...current, theme: '' })); }} />
              <p className="admin-field-error" id="theme-error" aria-live="polite">{fieldErrors.theme}</p>
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
