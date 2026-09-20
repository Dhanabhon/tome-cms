import { useState } from 'react';

import { adminCopy, fill } from '../../lib/admin-i18n';
import { adminHref } from '../../lib/admin';
import { THEME_MANIFESTS } from '../../themes/manifests';
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

export default function ThemeForm({ adminPath, initialSettings, ownerLocale }: ThemeFormProps) {
  const copy = adminCopy(ownerLocale);
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
        {THEME_MANIFESTS.map(({ description, id, name }) => {
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
