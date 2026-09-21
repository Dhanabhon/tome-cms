import { useRef, useState, type FormEvent } from 'react';

import { useDrawer } from './useDrawer';

import { adminCopy, fill, type AdminCopy } from '../../lib/admin-i18n';
import { PLUGIN_MANIFESTS } from '../../plugins/manifests';
import type { PluginHookId, PluginManifest } from '../../plugins/contract';
import type { PluginState } from '../../server/plugins/store';
import type { PostLocale } from '../../types/cms';
import BrandMark from '../BrandMark';
import Icon from '../Icon';
import { atLeast } from '../../lib/busy';

interface PluginManagerProps {
  initialPlugins: PluginState[];
  ownerLocale?: PostLocale | null;
}

/** Which card a report belongs to, so one plugin's failure is not reported on all of them. */
interface Report {
  error?: string;
  id: string;
  status?: string;
}

/** The core's own words for its own hooks. A plugin names one; it does not describe it. */
function hookLabel(copy: AdminCopy, hook: PluginHookId): string {
  return { editorSuggestions: copy.plugins.hookEditorSuggestions, publicPage: copy.plugins.hookPublicPage, signIn: copy.plugins.hookSignIn }[hook];
}

/**
 * A card per plugin: what it is, where it acts, and whether it is on.
 *
 * Its fields are not on the card. There is no honest way to fill the space under a plugin
 * the way a directory does -- no ratings, no install counts, no compatibility to report,
 * because plugins ship with the release and there is nothing to compare them against. What
 * there is instead is the thing a directory cannot tell you: which of the core's hooks this
 * one fills, and whether it is ready to be switched on.
 */
export default function PluginManager({ initialPlugins, ownerLocale }: PluginManagerProps) {
  const copy = adminCopy(ownerLocale);
  const locale = ownerLocale === 'th' ? 'th' : 'en';
  const [plugins, setPlugins] = useState(initialPlugins);
  const [busyId, setBusyId] = useState('');
  const [report, setReport] = useState<Report>({ id: '' });
  const [setUpId, setSetUpId] = useState('');

  /** `said` is empty for the switch: it reports itself, and a word repeating it is noise. */
  async function write(id: string, body: { enabled: boolean; values: Record<string, string> }, said: string) {
    if (busyId) return false;
    setBusyId(id);
    setReport({ id: '' });
    try {
      const response = await atLeast(fetch('/api/admin/plugins', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, id }),
      }));
      const payload = await response.json().catch(() => null) as { error?: string; plugins?: PluginState[] } | null;
      if (!response.ok || !payload?.plugins) throw new Error(payload?.error || copy.plugins.saveFailed);
      setPlugins(payload.plugins);
      setReport({ id, status: said });
      return true;
    } catch (failure) {
      setReport({ id, error: failure instanceof Error ? failure.message : copy.plugins.saveFailed });
      return false;
    } finally {
      setBusyId('');
    }
  }

  const setUpManifest = PLUGIN_MANIFESTS.find((manifest) => manifest.id === setUpId) ?? null;

  return (
    <div className="admin-card-stack">
      <ul className="plugin-grid">
        {PLUGIN_MANIFESTS.map((manifest) => {
          const state = plugins.find((plugin) => plugin.id === manifest.id);
          const enabled = state?.enabled ?? false;
          const configured = state?.configured ?? false;
          const busy = busyId === manifest.id;
          const mine = report.id === manifest.id;
          return (
            <li className="plugin-card" key={manifest.id} data-on={enabled ? '' : undefined}>
              <div className="plugin-card__body">
                <span className="plugin-card__mark" aria-hidden="true" data-brand={manifest.brand ?? undefined}>
                  {manifest.brand ? <BrandMark name={manifest.brand} /> : <Icon name={manifest.icon} />}
                </span>
                <div className="plugin-card__name">
                  <strong>{manifest.name}</strong>
                  <p>{manifest.description[locale]}</p>
                </div>
              </div>
              {/* Where a directory puts stars and install counts. This has neither, and has
                  something a directory could not know: which hook the plugin is filling. */}
              <p className="plugin-card__meta">
                {manifest.hooks.map((hook) => (
                  <span className="plugin-card__hook" key={hook}>{hookLabel(copy, hook)}</span>
                ))}
              </p>
              <footer className="plugin-card__foot">
                {/* The switch applies on the spot and the word beside it carries the state.
                    A tint could not -- no two surfaces in this palette are far enough apart
                    for a background to mean anything. */}
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
                <button
                  className="admin-button admin-button--secondary"
                  onClick={() => setSetUpId(manifest.id)}
                  type="button"
                >
                  {copy.plugins.setUp}
                </button>
              </footer>
              {mine && report.error && <p className="admin-form-error" role="alert">{report.error}</p>}
              {mine && report.status && <p className="plugin-card__said" role="status">{report.status}</p>}
            </li>
          );
        })}
        {/* Not a button. Nothing here installs a plugin, and an Upload Plugin next to these
            would say otherwise; this says where the next one actually comes from. */}
        <li className="plugin-card plugin-card--source">
          <strong>{copy.plugins.sourceTitle}</strong>
          <p>{copy.plugins.sourceBody}</p>
        </li>
      </ul>

      {setUpManifest && (
        <PluginSetUp
          busy={busyId === setUpManifest.id}
          copy={copy}
          locale={locale}
          manifest={setUpManifest}
          onClose={() => setSetUpId('')}
          configured={plugins.find((plugin) => plugin.id === setUpManifest.id)?.configured ?? false}
          onSave={async (values) => {
            const state = plugins.find((plugin) => plugin.id === setUpManifest.id);
            // Switching stays with the switch: a save carries fields and leaves the plugin
            // on whichever side of on or off it already was.
            if (await write(setUpManifest.id, { enabled: state?.enabled ?? false, values }, copy.plugins.saved)) {
              setSetUpId('');
            }
          }}
          state={plugins.find((plugin) => plugin.id === setUpManifest.id)}
        />
      )}

      {/* The thing an owner is right to worry about, answered where they are deciding. */}
      <section className="admin-card admin-card--note" aria-labelledby="plugins-safe-heading">
        <h2 id="plugins-safe-heading">{copy.plugins.safeTitle}</h2>
        <p>{copy.plugins.safeBody}</p>
      </section>
    </div>
  );
}

interface PluginSetUpProps {
  busy: boolean;
  configured: boolean;
  copy: AdminCopy;
  locale: 'en' | 'th';
  manifest: PluginManifest;
  onClose: () => void;
  onSave: (values: Record<string, string>) => void;
  state: PluginState | undefined;
}

/**
 * A plugin's fields, in the panel this admin already uses for a panel of fields.
 *
 * The fields are generated from the manifest rather than written per plugin, which is what
 * keeps a plugin from needing a screen of its own -- and what stops it from drawing one.
 */
function PluginSetUp({ busy, configured, copy, locale, manifest, onClose, onSave, state }: PluginSetUpProps) {
  const closeButton = useRef<HTMLButtonElement>(null);

  const { close, dialog } = useDrawer({ focus: closeButton, onClose });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
    // An unticked box sends nothing, and the store reads nothing as "leave it" -- so a
    // switch that is off has to say so, or it can be turned on and never off again.
    for (const setting of manifest.settings) {
      if (setting.kind === 'switch') values[setting.key] = form.get(setting.key) === 'on' ? 'on' : 'off';
    }
    onSave(values);
  }

  return (
    <dialog
      aria-label={fill(copy.plugins.setUpTitle, { name: manifest.name })}
      className="admin-editor-settings"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      ref={dialog}
    >
      <header className="admin-editor-settings__head">
        <div>
          <h2>{fill(copy.plugins.setUpTitle, { name: manifest.name })}</h2>
          {/* Why the switch on the card is dead, said where the fix is rather than beside a
              control that is already saying "not set up yet". */}
          <p>{configured ? manifest.description[locale] : copy.plugins.incomplete}</p>
        </div>
        <button
          aria-label={copy.plugins.close}
          className="admin-button admin-button--ghost admin-button--icon"
          onClick={() => close()}
          ref={closeButton}
          type="button"
        >
          <Icon name="close" />
        </button>
      </header>
      <form className="plugin-setup" onSubmit={submit}>
        <fieldset disabled={busy}>
          {manifest.settings.map((setting) => setting.kind === 'switch' ? (
            <div className="admin-check" key={setting.key}>
              <label>
                <input
                  defaultChecked={(state?.values[setting.key] || setting.fallback) === 'on'}
                  name={setting.key}
                  type="checkbox"
                />
                <span>{setting.label[locale]}</span>
              </label>
              {setting.hint && <small>{setting.hint[locale]}</small>}
            </div>
          ) : setting.kind === 'color' ? (
            <div className="admin-field admin-field--color" key={setting.key}>
              <label htmlFor={`${manifest.id}-${setting.key}`}>{setting.label[locale]}</label>
              <input
                className="admin-control admin-control--color"
                defaultValue={state?.values[setting.key] || setting.fallback || '#000000'}
                id={`${manifest.id}-${setting.key}`}
                name={setting.key}
                type="color"
              />
              {setting.hint && <small>{setting.hint[locale]}</small>}
            </div>
          ) : (
            <div className="admin-field" key={setting.key}>
              <label htmlFor={`${manifest.id}-${setting.key}`}>{setting.label[locale]}</label>
              <input
                autoComplete="off"
                className="admin-control"
                defaultValue={setting.kind === 'secret' ? '' : state?.values[setting.key] ?? ''}
                id={`${manifest.id}-${setting.key}`}
                maxLength={2_048}
                name={setting.key}
                // A stored secret was never sent here, so the field starts empty and says
                // so; saving the rest of the form must not erase it.
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
    </dialog>
  );
}
