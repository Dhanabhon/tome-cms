import { useCallback, useEffect, useState } from 'react';

type UpdateCheck = {
  checkedAt: string;
  currentVersion: string;
  availability: 'current' | 'available' | 'manual-transition' | 'unavailable';
  latest: { manifest: { version: string; releaseNotesUrl: string } } | null;
  message: string;
};

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

  return (
    <section className="update-card" aria-labelledby="update-status-heading">
      <div>
        <h2 id="update-status-heading">Update status</h2>
        <p className="update-version">Installed version: {check?.currentVersion ?? 'Checking…'}</p>
        {check?.latest && <p className="update-version">Latest stable version: {check.latest.manifest.version}</p>}
      </div>
      <p className="update-status" data-status={availability} role="status" aria-live="polite">{message}</p>
      <p>Updates can be checked here, but installation is unavailable on this installation.</p>
      {check?.latest && <a href={check.latest.manifest.releaseNotesUrl} target="_blank" rel="noopener noreferrer">Read release notes <span aria-hidden="true">↗</span></a>}
      <button className="admin-button admin-button--primary" disabled={busy} onClick={() => void load(true)} type="button">{busy ? 'Checking…' : 'Check again'}</button>
    </section>
  );
}
