import { useState, type FormEvent } from 'react';

import { adminCopy } from '../../lib/admin-i18n';
import type { PostLocale, SiteSettings } from '../../types/cms';
import UiSelect from './UiSelect';

interface SettingsFormProps {
  ownerLocale?: PostLocale | null;
  initialSettings: Pick<SiteSettings, 'site_name' | 'tagline' | 'site_description' | 'default_locale' | 'theme' | 'timezone' | 'updated_at'>;
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
  const [timezone, setTimezone] = useState(initialSettings.timezone);
  const [updatedAt, setUpdatedAt] = useState(initialSettings.updated_at);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');

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
        body: JSON.stringify({ defaultLocale, siteDescription, siteName, tagline, theme, timezone, updatedAt }),
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
        <div className="admin-field">
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
        <div className="admin-field">
          <label htmlFor="theme">{copy.theme.siteLabel}</label>
          <UiSelect ariaDescribedBy="theme-hint theme-error" className="admin-control" id="theme" invalid={Boolean(fieldErrors.theme)} name="theme" options={[{ label: copy.theme.system, value: 'system' }, { label: copy.theme.light, value: 'light' }, { label: copy.theme.dark, value: 'dark' }]} value={theme} onValueChange={(next) => { setTheme(next as SiteSettings['theme']); setStatus(''); setFieldErrors((current) => ({ ...current, theme: '' })); }} />
          <small id="theme-hint">{copy.theme.siteHint}</small>
          <p className="admin-field-error" id="theme-error" aria-live="polite">{fieldErrors.theme}</p>
        </div>
      </fieldset>
      <p className="admin-form-error" role="alert">{error}</p>
      <div className="admin-form-actions">
        <button className="admin-button admin-button--primary" type="submit" disabled={saving}>{saving ? copy.settings.saving : copy.settings.save}</button>
        <p role="status">{status}</p>
      </div>
    </form>
  );
}
