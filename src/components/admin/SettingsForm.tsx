import { useState, type FormEvent } from 'react';

import type { SiteSettings } from '../../types/cms';

interface SettingsFormProps {
  initialSettings: Pick<SiteSettings, 'site_name' | 'site_description' | 'default_locale' | 'timezone'>;
}

export default function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [siteName, setSiteName] = useState(initialSettings.site_name);
  const [siteDescription, setSiteDescription] = useState(initialSettings.site_description);
  const [defaultLocale, setDefaultLocale] = useState(initialSettings.default_locale);
  const [timezone, setTimezone] = useState(initialSettings.timezone);
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
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaultLocale, siteDescription, siteName, timezone }),
      });
      const result = await response.json();
      if (!response.ok) {
        const fields: Record<string, string> = {};
        for (const name of ['siteName', 'siteDescription', 'defaultLocale', 'timezone']) {
          fields[name] = result.issues?.properties?.[name]?.errors?.join(' ') ?? '';
        }
        setFieldErrors(fields);
        throw new Error(result.error ?? 'The settings could not be saved.');
      }
      setStatus('Saved.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="admin-settings-form" onSubmit={save} onChange={(event) => {
      setStatus('');
      const name = (event.target as HTMLInputElement).name;
      setFieldErrors((current) => ({ ...current, [name]: '' }));
    }}>
      <fieldset disabled={saving}>
        <div className="admin-field">
          <label htmlFor="siteName">Site name</label>
          <input className="admin-control" id="siteName" name="siteName" aria-invalid={Boolean(fieldErrors.siteName)} aria-describedby="siteName-error" required maxLength={120} value={siteName} onChange={(event) => setSiteName(event.target.value)} />
          <p className="admin-field-error" id="siteName-error" aria-live="polite">{fieldErrors.siteName}</p>
        </div>
        <div className="admin-field">
          <label htmlFor="siteDescription">Site description</label>
          <textarea className="admin-control admin-control--textarea" id="siteDescription" name="siteDescription" aria-invalid={Boolean(fieldErrors.siteDescription)} aria-describedby="siteDescription-error" maxLength={160} value={siteDescription} onChange={(event) => setSiteDescription(event.target.value)} />
          <p className="admin-field-error" id="siteDescription-error" aria-live="polite">{fieldErrors.siteDescription}</p>
        </div>
        <div className="admin-field">
          <label htmlFor="defaultLocale">Default language</label>
          <select className="admin-control" id="defaultLocale" name="defaultLocale" aria-invalid={Boolean(fieldErrors.defaultLocale)} aria-describedby="defaultLocale-error" value={defaultLocale} onChange={(event) => setDefaultLocale(event.target.value as SiteSettings['default_locale'])}><option value="th">Thai</option><option value="en">English</option></select>
          <p className="admin-field-error" id="defaultLocale-error" aria-live="polite">{fieldErrors.defaultLocale}</p>
        </div>
        <div className="admin-field">
          <label htmlFor="timezone">Timezone</label>
          <select className="admin-control" id="timezone" name="timezone" aria-invalid={Boolean(fieldErrors.timezone)} aria-describedby="timezone-error" value={timezone} onChange={(event) => setTimezone(event.target.value as SiteSettings['timezone'])}><option value="Asia/Bangkok">Asia/Bangkok</option><option value="UTC">UTC</option></select>
          <p className="admin-field-error" id="timezone-error" aria-live="polite">{fieldErrors.timezone}</p>
        </div>
      </fieldset>
      <p className="admin-form-error" role="alert">{error}</p>
      <div className="admin-form-actions">
        <button className="admin-button admin-button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <p role="status">{status}</p>
      </div>
    </form>
  );
}
