import { useState, type FormEvent } from 'react';

import { adminCopy } from '../../lib/admin-i18n';
import { PLUGIN_MANIFESTS } from '../../plugins/manifests';
import type { PluginState } from '../../server/plugins/store';
import type { PostLocale } from '../../types/cms';
import Icon from '../Icon';

interface PluginManagerProps {
  initialPlugins: PluginState[];
  ownerLocale?: PostLocale | null;
}

/** Which row a report belongs to, so one plugin's failure is not reported on all of them. */
interface Report {
  error?: string;
  id: string;
  status?: string;
}

/**
 * A row per plugin: what it is, whether it is on, and its fields behind a fold.
 *
 * A list rather than the grid the themes get, because the two screens answer different
 * questions. A theme is looked at, so it is shown; a plugin is switched, and what an owner
 * needs from a row is whether it is on and whether it is ready to be.
 *
 * The fields are generated from the manifest rather than written per plugin, which is what
 * keeps a plugin from needing a screen of its own -- and what stops it from drawing one.
 */
export default function PluginManager({ initialPlugins, ownerLocale }: PluginManagerProps) {
  const copy = adminCopy(ownerLocale);
  const locale = ownerLocale === 'th' ? 'th' : 'en';
  const [plugins, setPlugins] = useState(initialPlugins);
  const [busyId, setBusyId] = useState('');
  const [report, setReport] = useState<Report>({ id: '' });

  /** `said` is empty for the switch: it reports itself, and a second word saying the same
   *  thing under a collapsed fold is noise. A failure is always worth saying. */
  async function write(id: string, body: { enabled: boolean; values: Record<string, string> }, said: string) {
    if (busyId) return;
    setBusyId(id);
    setReport({ id: '' });
    try {
      const response = await fetch('/api/admin/plugins', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, id }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; plugins?: PluginState[] } | null;
      if (!response.ok || !payload?.plugins) throw new Error(payload?.error || copy.plugins.saveFailed);
      setPlugins(payload.plugins);
      setReport({ id, status: said });
    } catch (failure) {
      setReport({ id, error: failure instanceof Error ? failure.message : copy.plugins.saveFailed });
    } finally {
      setBusyId('');
    }
  }

  function save(event: FormEvent<HTMLFormElement>, id: string, enabled: boolean) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void write(id, {
      // Switching stays with the switch. This only carries the fields, and the plugin keeps
      // whichever side of on or off it was already on.
      enabled,
      values: Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])),
    }, copy.plugins.saved);
  }

  return (
    <div className="admin-card-stack">
      <ul className="plugin-list">
        {PLUGIN_MANIFESTS.map((manifest) => {
          const state = plugins.find((plugin) => plugin.id === manifest.id);
          const enabled = state?.enabled ?? false;
          const configured = state?.configured ?? false;
          const busy = busyId === manifest.id;
          const mine = report.id === manifest.id;
          return (
            <li className="plugin-row" key={manifest.id} data-on={enabled ? '' : undefined}>
              <div className="plugin-row__head">
                <div className="plugin-row__name">
                  <strong>{manifest.name}</strong>
                  <p>{manifest.description[locale]}</p>
                </div>
                {/* The switch is the whole of switching: it applies on the spot, and the
                    word beside it carries the state. A tint could not -- no two surfaces in
                    this palette are far enough apart for a background to mean anything. */}
                <label className="admin-switch">
                  <input
                    aria-busy={busy}
                    checked={enabled}
                    disabled={Boolean(busyId) || (!enabled && !configured)}
                    onChange={(event) => void write(manifest.id, { enabled: event.target.checked, values: {} }, '')}
                    role="switch"
                    type="checkbox"
                  />
                  <span className="admin-switch__state">
                    {enabled ? copy.plugins.on : configured ? copy.plugins.off : copy.plugins.notConfigured}
                  </span>
                </label>
              </div>
              {!configured && <p className="plugin-row__needs">{copy.plugins.incomplete}</p>}

              {/* Open while there is nothing to switch on, because that is when the fields
                  are the point; it closes itself once they are filled in. */}
              <details className="plugin-row__setup" open={!configured}>
                <summary>{copy.plugins.setUp}<Icon name="down" /></summary>
                <form onSubmit={(event) => save(event, manifest.id, enabled)}>
                  <fieldset disabled={busy}>
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
                    <div className="admin-form-actions">
                      <button aria-busy={busy} className="admin-button admin-button--primary" type="submit">
                        {copy.plugins.save}
                      </button>
                    </div>
                  </fieldset>
                </form>
              </details>

              {mine && report.error && <p className="admin-form-error" role="alert">{report.error}</p>}
              {mine && report.status && <p className="plugin-row__said" role="status">{report.status}</p>}
            </li>
          );
        })}
      </ul>

      {/* The thing an owner is right to worry about, answered where they are deciding. */}
      <section className="admin-card admin-card--note" aria-labelledby="plugins-safe-heading">
        <h2 id="plugins-safe-heading">{copy.plugins.safeTitle}</h2>
        <p>{copy.plugins.safeBody}</p>
      </section>
    </div>
  );
}
