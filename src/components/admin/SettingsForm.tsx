import { useState, type FormEvent } from 'react';

import type { SiteSettings } from '../../types/cms';
import UiSelect from './UiSelect';

interface SettingsFormProps {
  initialSettings: Pick<SiteSettings, 'site_name' | 'tagline' | 'site_description' | 'default_locale' | 'timezone' | 'updated_at'>;
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

export default function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [siteName, setSiteName] = useState(initialSettings.site_name);
  const [tagline, setTagline] = useState(initialSettings.tagline);
  const [siteDescription, setSiteDescription] = useState(initialSettings.site_description);
  const [defaultLocale, setDefaultLocale] = useState(initialSettings.default_locale);
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
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaultLocale, siteDescription, siteName, tagline, timezone, updatedAt }),
      });
      const result = await response.json().catch(() => ({})) as SaveResult;
      if (!response.ok) {
        const fields: Record<string, string> = {};
        for (const name of ['siteName', 'tagline', 'siteDescription', 'defaultLocale', 'timezone']) {
          fields[name] = result.issues?.properties?.[name]?.errors?.join(' ') ?? '';
        }
        setFieldErrors(fields);
        throw new Error(result.error ?? 'The settings could not be saved.');
      }
      if (typeof result.settings?.updated_at !== 'string') throw new Error('The server returned an incomplete response.');
      setUpdatedAt(result.settings.updated_at);
      setStatus('Saved.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The settings could not be saved.');
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
          <label htmlFor="siteName">Site name</label>
          <input className="admin-control" id="siteName" name="siteName" aria-invalid={Boolean(fieldErrors.siteName)} aria-describedby="siteName-error" required maxLength={120} value={siteName} onChange={(event) => setSiteName(event.target.value)} />
          <p className="admin-field-error" id="siteName-error" aria-live="polite">{fieldErrors.siteName}</p>
        </div>
        <div className="admin-field">
          <label htmlFor="tagline">Tagline</label>
          <input className="admin-control" id="tagline" name="tagline" aria-invalid={Boolean(fieldErrors.tagline)} aria-describedby="tagline-error" maxLength={120} placeholder="A short line about your publication" value={tagline} onChange={(event) => setTagline(event.target.value)} />
          <p className="admin-field-error" id="tagline-error" aria-live="polite">{fieldErrors.tagline}</p>
        </div>
        <div className="admin-field">
          <label htmlFor="siteDescription">Site description</label>
          <textarea className="admin-control admin-control--textarea" id="siteDescription" name="siteDescription" aria-invalid={Boolean(fieldErrors.siteDescription)} aria-describedby="siteDescription-error" maxLength={160} value={siteDescription} onChange={(event) => setSiteDescription(event.target.value)} />
          <p className="admin-field-error" id="siteDescription-error" aria-live="polite">{fieldErrors.siteDescription}</p>
        </div>
        <div className="admin-field">
          <label htmlFor="defaultLocale">Default language</label>
          <UiSelect ariaDescribedBy="defaultLocale-error" className="admin-control" id="defaultLocale" invalid={Boolean(fieldErrors.defaultLocale)} name="defaultLocale" options={[{ label: 'Thai', value: 'th' }, { label: 'English', value: 'en' }]} value={defaultLocale} onValueChange={(next) => { setDefaultLocale(next as SiteSettings['default_locale']); setStatus(''); setFieldErrors((current) => ({ ...current, defaultLocale: '' })); }} />
          <p className="admin-field-error" id="defaultLocale-error" aria-live="polite">{fieldErrors.defaultLocale}</p>
        </div>
        <div className="admin-field">
          <label htmlFor="timezone">Timezone</label>
          <UiSelect ariaDescribedBy="timezone-error" className="admin-control" id="timezone" invalid={Boolean(fieldErrors.timezone)} name="timezone" options={[{ label: 'Asia/Bangkok', value: 'Asia/Bangkok' }, { label: 'UTC', value: 'UTC' }]} value={timezone} onValueChange={(next) => { setTimezone(next as SiteSettings['timezone']); setStatus(''); setFieldErrors((current) => ({ ...current, timezone: '' })); }} />
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
