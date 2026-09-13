import { useCallback, useEffect, useRef, useState } from 'react';

import { authClient } from '../../lib/auth-client';
import { confirmUi } from '../../lib/ui-dialog';
import type { UpdaterStatus } from '../../server/update/updater-client';
import type { PublicUpdateJob } from '../../updater/state';

type UpdateCheck = {
  checkedAt: string;
  currentVersion: string;
  availability: 'current' | 'available' | 'manual-transition' | 'unavailable';
  latest: { publishedAt: string; manifest: { version: string; releaseNotesUrl: string } } | null;
  message: string;
  updateMode: 'check-only' | 'managed';
  installability: { mode: 'check-only' | 'managed'; installable: boolean; reason: string };
  updater: UpdaterStatus;
};

const terminalPhases = ['succeeded', 'rolled_back', 'failed_manual_recovery'];

export function getApplyResponseAction(observedJob: Pick<PublicUpdateJob, 'phase'> | null, definiteRefusal: boolean) {
  if (observedJob) return terminalPhases.includes(observedJob.phase) ? 'ignore' : 'preserve';
  return definiteRefusal ? 'stop' : 'continue';
}
const steps = [
  ['preflight', 'Check prerequisites'], ['verifying', 'Verify the official update'],
  ['downloading', 'Download update'], ['quiescing', 'Prepare maintenance'],
  ['backing_up', 'Create recovery backup'], ['migrating', 'Apply database migrations'],
  ['restarting', 'Restart TomeCMS'], ['health_check', 'Check application health'],
];

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
  const [installing, setInstalling] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [watch, setWatch] = useState<{ targetVersion: string; previousJobId?: string } | null>(null);
  const mounted = useRef(true);
  const observedJob = useRef<PublicUpdateJob | null>(null);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/system/updates', refresh ? {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'check' }), signal: AbortSignal.timeout(10_000),
      } : { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      const result = await response.json().catch(() => ({})) as UpdateCheck & { error?: string };
      if (!response.ok || !result.availability) throw new Error(result.error ?? 'Update check unavailable.');
      if (!mounted.current) return;
      setCheck(result);
      if (result.updater?.managed && result.updater.job && !terminalPhases.includes(result.updater.job.phase)) {
        setWatch({ targetVersion: result.updater.job.targetVersion });
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Update check unavailable.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  useEffect(() => {
    if (!watch) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      let delay = 1000;
      try {
        const response = await fetch('/api/admin/system/updates', {
          cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        const result = await response.json() as UpdateCheck;
        if (!response.ok || !result.availability || !result.updater?.managed) throw new Error('Reconnecting');
        if (controller.signal.aborted) return;
        setCheck(result);
        setReconnecting(false);
        failures = 0;
        const job = result.updater.job;
        if (job && job.id !== watch.previousJobId) {
          observedJob.current = job;
          if (terminalPhases.includes(job.phase)) {
            setError('');
            setWatch(null);
            return;
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        setReconnecting(true);
        delay = [1000, 2000, 4000, 8000, 10000][Math.min(failures++, 4)];
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), delay);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [watch]);

  async function install() {
    const version = check?.latest?.manifest.version;
    if (!version || !check?.installability.installable || installing || watch) return;
    setInstalling(true);
    setError('');
    try {
      const confirmed = await confirmUi({
        title: `Install TomeCMS ${version}?`, confirmLabel: `Install ${version}`,
        message: 'TomeCMS will create a complete recovery backup, apply the update, and briefly restart. Keep this page open to follow progress.',
      });
      if (!confirmed || !mounted.current) return;
      const assertion = await authClient.signIn.passkey();
      if (assertion.error || !assertion.data) throw new Error('No Passkey was accepted. Verify a Passkey and try again.');
      if (!mounted.current) return;
      const previousJobId = check.updater?.managed ? check.updater.job?.id : undefined;
      observedJob.current = null;
      setWatch({ targetVersion: version, previousJobId });
      let response: Response | null = null;
      try {
        response = await fetch('/api/admin/system/updates', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'apply', version }), signal: AbortSignal.timeout(10_000),
        });
      } catch { /* Polling determines whether an ambiguous request was accepted. */ }
      const result = await response?.json().catch(() => null);
      if (!mounted.current) return;
      const definiteRefusal = !!response && !response.ok && response.status < 500 && typeof result?.error === 'string';
      const action = getApplyResponseAction(observedJob.current, definiteRefusal);
      if (action === 'ignore') return;
      if (definiteRefusal) {
        if (action === 'stop') setWatch(null);
        setError(result.error);
        return;
      }
      if (action === 'preserve') return;
      // A lost/invalid response can follow an accepted job; keep reading durable status.
      if (response?.status !== 202 || !result?.job) { setReconnecting(true); return; }
      setCheck((current) => current && current.updater.managed
        && (!current.updater.job || current.updater.job.id === previousJobId)
        ? { ...current, updater: { ...current.updater, job: result.job } } : current);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Update request unavailable.');
    } finally {
      if (mounted.current) setInstalling(false);
    }
  }

  const availability = busy ? 'checking' : error ? 'unavailable' : check?.availability ?? 'unavailable';
  const message = busy ? 'Checking for updates…' : error || check?.message || 'Update check unavailable.';
  const availabilityLabel = busy ? 'Checking for updates…' : availabilityLabels[availability === 'checking' ? 'unavailable' : availability];
  const installability = check?.installability ?? {
    mode: 'check-only' as const,
    installable: false as const,
    reason: 'This installation is configured for update checks only.',
  };
  const currentJob = check?.updater?.managed ? check.updater.job : null;
  const job = currentJob && currentJob.id !== watch?.previousJobId ? currentJob : null;
  const releaseNotes = check?.latest && check.latest.manifest.releaseNotesUrl
    === `https://github.com/Dhanabhon/tome-cms/releases/tag/v${check.latest.manifest.version}`
    ? check.latest.manifest.releaseNotesUrl : null;

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
        <h3>{installability.mode === 'managed' ? 'Managed updates' : 'Managed updates unavailable'}</h3>
        <p className="update-version">Update mode: {check?.updateMode ?? installability.mode}</p>
        <p>{installability.reason}</p>
      </div>
      {check?.latest && <>
        <p className="update-version">Published: {formatPublishedAt(check.latest.publishedAt)}</p>
        {releaseNotes && <a href={releaseNotes} target="_blank" rel="noopener noreferrer">Read release notes <span aria-hidden="true">↗</span></a>}
      </>}
      <button className="admin-button admin-button--primary" disabled={busy || installing || !!watch} onClick={() => void load(true)} type="button">{busy ? 'Checking…' : 'Check again'}</button>
      {installability.installable && check?.latest && <button className="admin-button admin-button--primary" disabled={busy || installing || !!watch} onClick={() => void install()} type="button">
        {installing ? 'Verifying…' : `Install ${check.latest.manifest.version}`}
      </button>}
      {(watch || job) && <div aria-labelledby="update-progress-heading">
        <h3 id="update-progress-heading">Installation progress</h3>
        <p role="status" aria-live="polite">{reconnecting ? 'Reconnecting…' : job?.message ?? 'Waiting for the updater…'}</p>
        <progress max={8} value={job?.completedSteps ?? 0} aria-label="Update steps completed" />
        <ol>{steps.map(([phase, label], index) => <li key={phase} aria-current={job?.phase === phase ? 'step' : undefined}>
          {index < (job?.completedSteps ?? 0) && <span aria-label="Completed">✓ </span>}{label}
        </li>)}</ol>
        {job?.phase === 'succeeded' && <p>TomeCMS {job.targetVersion} is installed.</p>}
        {job?.backupCreatedAt && <p>Recovery backup created: <time dateTime={job.backupCreatedAt}>{new Date(job.backupCreatedAt).toLocaleString()}</time>.</p>}
        {job?.phase === 'rolled_back' && <p>Your previous application is running. Review the release notes before trying again.</p>}
        {job?.phase === 'failed_manual_recovery' && <p>Contact your server operator to follow the managed update recovery guide.</p>}
      </div>}
    </section>
  );
}
