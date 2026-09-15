import { useCallback, useEffect, useRef, useState } from 'react';

import { adminCopy, fill, type AdminCopy } from '../../lib/admin-i18n';
import type { PostLocale } from '../../types/cms';

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
type ApplyResponseKind = 'refused' | 'ambiguous' | 'already_installed';

export function getApplyResponseAction(observedJob: Pick<PublicUpdateJob, 'phase'> | null, response: ApplyResponseKind) {
  if (observedJob) return terminalPhases.includes(observedJob.phase) ? 'ignore' : 'preserve';
  if (response === 'already_installed') return 'refresh';
  return response === 'refused' ? 'stop' : 'continue';
}
const buildSteps = (copy: AdminCopy) => [
  ['preflight', copy.updates.checkPrerequisites], ['verifying', copy.updates.verify],
  ['downloading', copy.updates.download], ['quiescing', copy.updates.prepareMaintenance],
  ['backing_up', copy.updates.createBackup], ['migrating', copy.updates.applyMigrations],
  ['restarting', copy.updates.restart], ['health_check', copy.updates.checkHealth],
];

const availabilityLabels = (copy: AdminCopy) => ({
  current: copy.updates.current,
  available: copy.updates.available,
  'manual-transition': copy.updates.manualTransition,
  unavailable: copy.updates.checkUnavailable,
});

export function formatPublishedAt(value: string, copy: AdminCopy, locale?: PostLocale | null): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return copy.updates.publishedUnavailable;
  try {
    return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en', { dateStyle: 'medium' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

interface UpdateManagerProps {
  ownerLocale?: PostLocale | null;
}

export default function UpdateManager({ ownerLocale }: UpdateManagerProps = {}) {
  const copy = adminCopy(ownerLocale);
  const steps = buildSteps(copy);
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
      if (!response.ok || !result.availability) throw new Error(result.error ?? copy.updates.updateCheckUnavailable);
      if (!mounted.current) return;
      setCheck(result);
      setReconnecting(false);
      if (result.updater?.managed && result.updater.job && !terminalPhases.includes(result.updater.job.phase)) {
        setWatch({ targetVersion: result.updater.job.targetVersion });
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : copy.updates.updateCheckUnavailable);
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
        if (!response.ok || !result.availability || !result.updater?.managed) throw new Error(copy.updates.reconnecting);
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
      if (assertion.error || !assertion.data) throw new Error(copy.updates.noPasskey);
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
      const result = await response?.json().catch(() => null) as {
        outcome?: unknown;
        job?: NonNullable<Extract<UpdaterStatus, { managed: true }>['job']>;
        error?: unknown;
      } | null | undefined;
      if (!mounted.current) return;
      const definiteRefusal = !!response && !response.ok && response.status < 500 && typeof result?.error === 'string';
      const kind = response?.status === 200 && result?.outcome === 'already_installed'
        ? 'already_installed' : definiteRefusal ? 'refused' : 'ambiguous';
      const action = getApplyResponseAction(observedJob.current, kind);
      if (action === 'ignore') return;
      if (action === 'refresh') {
        setWatch(null);
        await load();
        return;
      }
      if (definiteRefusal) {
        if (action === 'stop') setWatch(null);
        setError(typeof result?.error === 'string' ? result.error : copy.updates.updateRequestUnavailable);
        return;
      }
      if (action === 'preserve') return;
      // A lost/invalid response can follow an accepted job; keep reading durable status.
      if (response?.status !== 202 || result?.outcome !== 'accepted' || !result.job) { setReconnecting(true); return; }
      const acceptedJob = result.job;
      setCheck((current) => current && current.updater.managed
        && (!current.updater.job || current.updater.job.id === previousJobId)
        ? { ...current, updater: { ...current.updater, job: acceptedJob } } : current);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : copy.updates.updateRequestUnavailable);
    } finally {
      if (mounted.current) setInstalling(false);
    }
  }

  const availability = busy ? 'checking' : error ? 'unavailable' : check?.availability ?? 'unavailable';
  const message = busy ? copy.updates.checkingForUpdates : error || check?.message || copy.updates.updateCheckUnavailable;
  const availabilityLabel = busy ? copy.updates.checkingForUpdates : availabilityLabels(copy)[availability === 'checking' ? 'unavailable' : availability];
  const installability = check?.installability ?? {
    mode: 'check-only' as const,
    installable: false as const,
    reason: copy.updates.checkOnly,
  };
  const currentJob = check?.updater?.managed ? check.updater.job : null;
  const job = currentJob && currentJob.id !== watch?.previousJobId ? currentJob : null;
  const releaseNotes = check?.latest && check.latest.manifest.releaseNotesUrl
    === `https://github.com/Dhanabhon/tome-cms/releases/tag/v${check.latest.manifest.version}`
    ? check.latest.manifest.releaseNotesUrl : null;

  return (
    <div className="admin-card-stack">

      <section className="admin-card update-card" aria-labelledby="update-status-heading">
        <header className="admin-card__head">
          <h2 id="update-status-heading">{copy.updates.status}</h2>
        </header>
        <div className="update-summary">
          <p className="update-status" data-status={availability} role="status" aria-live="polite">{copy.updates.releaseAvailability} {availabilityLabel}</p>
          <dl className="admin-facts">
            <div><dt>{copy.updates.installedVersion}</dt><dd>{check?.currentVersion ?? copy.updates.checking}</dd></div>
            {check?.latest && <div><dt>{copy.updates.latestVersion}</dt><dd>{check.latest.manifest.version}</dd></div>}
            {check?.latest && <div><dt>{copy.updates.published}</dt><dd>{formatPublishedAt(check.latest.publishedAt, copy, ownerLocale)}</dd></div>}
          </dl>
          {!busy && <p>{message}</p>}
          {releaseNotes && <a href={releaseNotes} target="_blank" rel="noopener noreferrer">{copy.updates.readReleaseNotes} <span aria-hidden="true">↗</span></a>}
        </div>
        <div className="update-actions">
          <button className="admin-button admin-button--secondary" disabled={busy || installing || !!watch} onClick={() => void load(true)} type="button">{busy ? copy.updates.checking : copy.updates.checkAgain}</button>
          {installability.installable && check?.latest && <button className="admin-button admin-button--primary" disabled={busy || installing || !!watch} onClick={() => void install()} type="button">
            {installing ? copy.updates.verifying : fill(copy.updates.install, { version: check.latest.manifest.version })}
          </button>}
        </div>
      </section>

      <section className="admin-card" aria-labelledby="update-mode-heading">
        <header className="admin-card__head">
          <h2 id="update-mode-heading">{installability.mode === 'managed' ? copy.updates.managed : copy.updates.managedUnavailable}</h2>
          <p>{installability.reason}</p>
        </header>
        <dl className="admin-facts">
          <div><dt>{copy.updates.updateMode}</dt><dd>{check?.updateMode ?? installability.mode}</dd></div>
        </dl>
      </section>

      {(watch || job) && <section className="admin-card" aria-labelledby="update-progress-heading">
        <header className="admin-card__head">
          <h2 id="update-progress-heading">{copy.updates.progress}</h2>
          <p role="status" aria-live="polite">{reconnecting ? copy.updates.reconnecting : job?.message ?? copy.updates.waitingForUpdater}</p>
        </header>
        <progress className="update-progress" max={8} value={job?.completedSteps ?? 0} aria-label={copy.updates.stepsCompleted} />
        <ol className="update-steps">{steps.map(([phase, label], index) => <li key={phase} aria-current={job?.phase === phase ? 'step' : undefined}>
          {index < (job?.completedSteps ?? 0) && <span aria-label={copy.updates.completed}>✓ </span>}{label}
        </li>)}</ol>
        {job?.phase === 'succeeded' && <p>{fill(copy.updates.installed, { version: job.targetVersion })}</p>}
        {job?.backupCreatedAt && <p>{copy.updates.backupCreated} <time dateTime={job.backupCreatedAt}>{new Date(job.backupCreatedAt).toLocaleString()}</time>.</p>}
        {job?.phase === 'rolled_back' && <p>{copy.updates.rolledBack}</p>}
        {job?.phase === 'failed_manual_recovery' && <p>{copy.updates.contactOperator}</p>}
      </section>}

    </div>
  );
}
