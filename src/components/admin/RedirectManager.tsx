import { useState, type FormEvent } from 'react';

import Icon from '../Icon';
import { adminCopy, fill } from '../../lib/admin-i18n';
import type { PostLocale } from '../../types/cms';
import type { RedirectEntry } from '../../server/content/redirects';
import { atLeast } from '../../lib/busy';

export interface RedirectTarget {
  id: string;
  kind: 'page' | 'post';
  locale: PostLocale;
  slug: string;
  title: string;
}

interface RedirectManagerProps {
  initialRedirects: RedirectEntry[];
  ownerLocale: PostLocale | null;
  targets: RedirectTarget[];
}

/** Where an old address will live, shown beside the field so the owner types only the slug. */
const prefix = (target: RedirectTarget | undefined) => !target
  ? '/'
  : target.kind === 'post' ? `/${target.locale}/blog/` : `/${target.locale}/`;

export default function RedirectManager({ initialRedirects, ownerLocale, targets }: RedirectManagerProps) {
  const copy = adminCopy(ownerLocale);
  const [redirects, setRedirects] = useState(initialRedirects);
  const [targetKey, setTargetKey] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const target = targets.find(({ id, kind }) => `${kind}:${id}` === targetKey);
  const since = new Intl.DateTimeFormat(ownerLocale ?? 'en', { dateStyle: 'medium' });

  /** Every change answers with the whole list, so the screen shows what the table says. */
  async function send(method: 'DELETE' | 'POST', body: object, done: string) {
    setError('');
    const response = await atLeast(fetch('/api/admin/redirects', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    const payload = await response.json().catch(() => null) as { error?: string; redirects?: RedirectEntry[] } | null;
    if (!response.ok || !payload?.redirects) throw new Error(payload?.error || copy.redirects.failed);
    setRedirects(payload.redirects);
    setStatus(done);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || busy) return;
    setBusy('add');
    try {
      await send('POST', { kind: target.kind, slug, targetId: target.id },
        fill(copy.redirects.created, { from: `${prefix(target)}${slug.trim()}` }));
      setSlug('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.redirects.failed);
    } finally {
      setBusy('');
    }
  }

  async function remove(entry: RedirectEntry) {
    const key = `${entry.kind}:${entry.locale}:${entry.slug}`;
    if (busy) return;
    setBusy(key);
    try {
      await send('DELETE', { kind: entry.kind, locale: entry.locale, slug: entry.slug },
        fill(copy.redirects.deleted, { from: entry.from }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.redirects.failed);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="redirect-manager" aria-busy={Boolean(busy)}>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {error && <p className="admin-alert" role="alert">{error}</p>}

      <form className="admin-card redirect-add" onSubmit={add}>
        <h2>{copy.redirects.addHeading}</h2>
        <p>{copy.redirects.addHint}</p>
        <label className="admin-field">
          <span>{copy.redirects.article}</span>
          <select className="admin-control" onChange={(event) => setTargetKey(event.target.value)} required value={targetKey}>
            <option value="">{copy.redirects.chooseArticle}</option>
            {targets.map((option) => (
              <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>
                {option.locale.toUpperCase()} · {option.title}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>{copy.redirects.oldAddress}</span>
          <div className="admin-control admin-control--prefixed">
            <span>{prefix(target)}</span>
            <input onChange={(event) => setSlug(event.target.value)} required type="text" value={slug} />
          </div>
        </label>
        <button aria-busy={busy === 'add'} className="admin-button admin-button--primary" disabled={!target || busy === 'add'} type="submit">
          {copy.redirects.save}
        </button>
      </form>

      {redirects.length === 0 ? (
        <p className="redirect-empty">{copy.redirects.empty}</p>
      ) : (
        <ul className="redirect-list" aria-label={copy.redirects.listLabel}>
          {redirects.map((entry) => {
            const key = `${entry.kind}:${entry.locale}:${entry.slug}`;
            return (
              <li className="redirect-row" key={key}>
                <div className="redirect-row__route">
                  <code>{entry.from}</code>
                  <Icon name="arrowRight" />
                  <span>
                    <a href={entry.to}>{entry.targetTitle}</a>
                    <small>{entry.live ? entry.to : copy.redirects.notLive}</small>
                  </span>
                </div>
                <div className="redirect-row__meta">
                  <small>{fill(copy.redirects.since, { date: since.format(new Date(entry.createdAt)) })}</small>
                  <button
                    aria-busy={busy === key}
                    aria-label={fill(copy.redirects.deleteLabelFor, { from: entry.from })}
                    className="admin-button admin-button--ghost admin-button--icon"
                    disabled={busy === key}
                    onClick={() => void remove(entry)}
                    title={fill(copy.redirects.deleteLabelFor, { from: entry.from })}
                    type="button"
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
