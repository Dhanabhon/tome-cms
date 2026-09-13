import { useCallback, useEffect, useState } from 'react';

type UpdateCheck = {
  checkedAt: string;
  currentVersion: string;
  availability: 'current' | 'available' | 'manual-transition' | 'unavailable';
  latest: { publishedAt: string; manifest: { version: string; releaseNotesUrl: string } } | null;
  message: string;
  updateMode: 'check-only' | 'managed';
  installability: { mode: 'check-only' | 'managed'; installable: false; reason: string };
};

const availabilityLabels = {
  current: 'Up to date',
  available: 'Update available',
  'manual-transition': 'Manual updater upgrade required',
  unavailable: 'Check unavailable',
} as const;

export function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Publication date unavailable';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export default function UpdateManager() {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/system/updates', refresh ? {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'check' }),
      } : undefined);
      const result = await response.json().catch(() => ({})) as UpdateCheck & { error?: string };
      if (!response.ok || !result.availability) throw new Error(result.error ?? 'Update check unavailable.');
      setCheck(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Update check unavailable.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const availability = busy ? 'checking' : error ? 'unavailable' : check?.availability ?? 'unavailable';
  const message = busy ? 'Checking for updates…' : error || check?.message || 'Update check unavailable.';
  const availabilityLabel = busy ? 'Checking for updates…' : availabilityLabels[availability === 'checking' ? 'unavailable' : availability];
  const installability = check?.installability ?? {
    mode: 'check-only' as const,
    installable: false as const,
    reason: 'This installation is configured for update checks only.',
  };

  return (
    <section className="update-card" aria-labelledby="update-status-heading">
      <div>
        <h2 id="update-status-heading">Update status</h2>
        <p className="update-version">Installed version: {check?.currentVersion ?? 'Checking…'}</p>
        {check?.latest && <p className="update-version">Latest stable version: {check.latest.manifest.version}</p>}
      </div>
      <p className="update-status" data-status={availability} role="status" aria-live="polite">Release availability: {availabilityLabel}</p>
      {!busy && <p>{message}</p>}
      <div>
        <h3>Managed updates unavailable</h3>
        <p className="update-version">Update mode: {check?.updateMode ?? installability.mode}</p>
        <p>{installability.reason}</p>
      </div>
      {check?.latest && <>
        <p className="update-version">Published: {formatPublishedAt(check.latest.publishedAt)}</p>
        <a href={check.latest.manifest.releaseNotesUrl} target="_blank" rel="noopener noreferrer">Read release notes <span aria-hidden="true">↗</span></a>
      </>}
      <button className="admin-button admin-button--primary" disabled={busy} onClick={() => void load(true)} type="button">{busy ? 'Checking…' : 'Check again'}</button>
    </section>
  );
}
