import { useState, type FormEvent } from 'react';

import { adminCopy } from '../../lib/admin-i18n';
import { PLUGIN_MANIFESTS } from '../../plugins/manifests';
import type { PluginState } from '../../server/plugins/store';
import type { PostLocale } from '../../types/cms';

interface PluginManagerProps {
  initialPlugins: PluginState[];
  ownerLocale?: PostLocale | null;
}

/**
 * One card per plugin, with the fields the plugin asked for.
 *
 * The form is generated from the manifest rather than written per plugin, which is what
 * keeps a plugin from needing a screen of its own -- and what stops it from drawing one.
 */
export default function PluginManager({ initialPlugins, ownerLocale }: PluginManagerProps) {
  const copy = adminCopy(ownerLocale);
  const locale = ownerLocale === 'th' ? 'th' : 'en';
  const [plugins, setPlugins] = useState(initialPlugins);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (busyId) return;
    const form = new FormData(event.currentTarget);
    setBusyId(id);
    setStatus('');
    setError('');
    try {
      const response = await fetch('/api/admin/plugins', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: form.get('enabled') === 'on',
          id,
          values: Object.fromEntries(
            [...form.entries()].filter(([key]) => key !== 'enabled').map(([key, value]) => [key, String(value)]),
          ),
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; plugins?: PluginState[] } | null;
      if (!response.ok || !payload?.plugins) throw new Error(payload?.error || copy.plugins.saveFailed);
      setPlugins(payload.plugins);
      setStatus(copy.plugins.saved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.plugins.saveFailed);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-card-stack">
      {PLUGIN_MANIFESTS.map((manifest) => {
        const state = plugins.find((plugin) => plugin.id === manifest.id);
        const busy = busyId === manifest.id;
        return (
          <form className="admin-card" key={manifest.id} onSubmit={(event) => void save(event, manifest.id)}>
            <fieldset disabled={busy}>
              <header className="admin-card__head">
                <h2>{manifest.name}</h2>
                <p>{manifest.description[locale]}</p>
              </header>
              <p className="admin-status" data-state={state?.enabled ? 'ok' : undefined}>
                {state?.enabled ? copy.plugins.on : copy.plugins.off}
                {' · '}
                {state?.configured ? copy.plugins.configured : copy.plugins.notConfigured}
              </p>
              {manifest.settings.map((setting) => (
                <div className="admin-field" key={setting.key}>
                  <label htmlFor={`${manifest.id}-${setting.key}`}>{setting.label[locale]}</label>
                  <input
                    autoComplete="off"
                    className="admin-control"
                    defaultValue={setting.kind === 'secret' ? '' : state?.values[setting.key] ?? ''}
                    id={`${manifest.id}-${setting.key}`}
                    maxLength={2_048}
                    name={setting.key}
                    // A stored secret was never sent here, so the field starts empty and
                    // says so; saving the rest of the form must not erase it.
                    placeholder={setting.kind === 'secret' && state?.secrets[setting.key] ? copy.plugins.secretStored : undefined}
                    type={setting.kind === 'secret' ? 'password' : 'text'}
                  />
                  {setting.hint && <small>{setting.hint[locale]}</small>}
                </div>
              ))}
              <div className="admin-check">
                <label>
                  <input defaultChecked={state?.enabled ?? false} name="enabled" type="checkbox" />
                  <span>{copy.plugins.on}</span>
                </label>
                <small>{copy.plugins.incomplete}</small>
              </div>
              <div className="admin-form-actions">
                <button aria-busy={busy} className="admin-button admin-button--primary" type="submit">
                  {busy ? copy.plugins.saving : copy.plugins.save}
                </button>
                <p aria-live="polite" className="admin-form-status">{busyId === null ? status : ''}</p>
              </div>
              <p className="admin-form-error" role="alert">{error}</p>
            </fieldset>
          </form>
        );
      })}
    </div>
  );
}
