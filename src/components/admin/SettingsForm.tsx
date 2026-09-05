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
  const [status, setStatus] = useState('');

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaultLocale, siteDescription, siteName, timezone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The settings could not be saved.');
      setStatus('Saved.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="admin-settings-form" onSubmit={save} onChange={() => setStatus('')}>
      <fieldset disabled={saving}>
        <label className="admin-field">Site name<input className="admin-control" required maxLength={120} value={siteName} onChange={(event) => setSiteName(event.target.value)} /></label>
        <label className="admin-field">Site description<textarea className="admin-control admin-control--textarea" maxLength={160} value={siteDescription} onChange={(event) => setSiteDescription(event.target.value)} /></label>
        <label className="admin-field">Default language<select className="admin-control" value={defaultLocale} onChange={(event) => setDefaultLocale(event.target.value as SiteSettings['default_locale'])}><option value="th">Thai</option><option value="en">English</option></select></label>
        <label className="admin-field">Timezone<select className="admin-control" value={timezone} onChange={(event) => setTimezone(event.target.value as SiteSettings['timezone'])}><option value="Asia/Bangkok">Asia/Bangkok</option><option value="UTC">UTC</option></select></label>
      </fieldset>
      <p className="admin-form-error" role="alert">{error}</p>
      <div className="admin-form-actions">
        <button className="admin-button admin-button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <p role="status">{status}</p>
      </div>
    </form>
  );
}
