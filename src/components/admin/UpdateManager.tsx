import { useCallback, useEffect, useRef, useState } from 'react';

import { adminCopy, fill, type AdminCopy } from '../../lib/admin-i18n';
import type { PostLocale } from '../../types/cms';

import { authClient } from '../../lib/auth-client';
import { updateDurations, type UpdateTimeline } from '../../lib/update-timeline';
import { describePasskeyException, describeReauthFailure } from '../../lib/passkey-failure';
import { confirmUi } from '../../lib/ui-dialog';
import type { UpdaterStatus } from '../../server/update/updater-client';
import type { UpdateUnavailableReason } from '../../server/update/service';
import type { PublicUpdateJob } from '../../updater/state';
import { atLeast, MIN_BUSY_MS } from '../../lib/busy';

type UpdateCheck = {
  checkedAt: string;
  currentVersion: string;
  availability: 'current' | 'available' | 'manual-transition' | 'unavailable';
  latest: { publishedAt: string; manifest: { version: string; releaseNotesUrl: string } } | null;
  message: string;
  reason?: UpdateUnavailableReason;
  updateMode: 'check-only' | 'managed';
  installability: { mode: 'check-only' | 'managed'; installable: boolean; reason: string; code?: string };
  updater: UpdaterStatus;
  /** When each phase of the last finished update began; null from an updater before 1.3.0. */
  timeline?: UpdateTimeline | null;
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

/** What the check found, in the owner's language. The server names the case; the words are the admin's. */
export function updateCheckMessage(copy: AdminCopy, check: Pick<UpdateCheck, 'availability' | 'latest' | 'reason'>): string {
  if (check.availability === 'current') return copy.updates.upToDate;
  if (check.availability === 'available') return fill(copy.updates.versionAvailable, { version: check.latest?.manifest.version ?? '' });
  if (check.availability === 'manual-transition') return copy.updates.manualTransitionRequired;
  if (check.reason === 'no-release') return copy.updates.noRelease;
  if (check.reason === 'unreachable') return copy.updates.releaseUnreachable;
  if (check.reason === 'unusable') return copy.updates.releaseUnusable;
  return copy.updates.updateCheckUnavailable;
}

/**
 * What a failed check says. Never the server's own English detail, a thrown fetch error, or
 * an abort's message -- only what the response's status means, in the admin's language.
 */
export function updateCheckFailureMessage(copy: AdminCopy, response: Response | null): string {
  return response?.status === 429 ? copy.auth.tooManyAttempts : copy.updates.updateCheckUnavailable;
}

/**
 * Why nothing installs here. Check-only is this installation's own setting, so it is said in
 * the owner's words; a managed installation's reasons are the updater's own.
 */
// Said from the code the server sends. Its English `reason` showed as is on the Thai admin.
export function installabilityReason(copy: AdminCopy, check: Pick<UpdateCheck, 'installability' | 'updateMode'> | null): string {
  if (check?.updateMode !== 'managed') return copy.updates.checkOnly;
  switch (check.installability.code) {
    case 'manual-recovery': return copy.updates.contactOperator;
    case 'in-progress': return copy.updates.updateInProgress;
    case 'manual-upgrade': return copy.updates.manualUpgrade;
    case 'installable': return copy.updates.readyToInstall;
    case 'check-only': return copy.updates.checkOnly;
    default: return copy.updates.noCompatibleUpdate;
  }
}

/** The update mode in the owner's words, never the raw `check-only` / `managed` config value. */
export function updateModeLabel(copy: AdminCopy, mode: UpdateCheck['updateMode'] | undefined): string {
  return mode === 'managed' ? copy.updates.modeManaged : copy.updates.modeCheckOnly;
}

// The step-by-step card is for an update in progress, or one the owner is watching finish. The
// updater keeps the last job until the next one, and in 1.0.2 its card stayed up for good.
export function progressVisible(watching: boolean, job: Pick<PublicUpdateJob, 'phase'> | null): boolean {
  return watching || (job !== null && !terminalPhases.includes(job.phase));
}

// The updater's own `message` is English; the owner reads its phase in their language.
export function jobStatusMessage(copy: AdminCopy, job: Pick<PublicUpdateJob, 'phase'>): string {
  const step = buildSteps(copy).find(([phase]) => phase === job.phase);
  if (step) return step[1];
  if (job.phase === 'succeeded') return copy.updates.updateSucceeded;
  if (job.phase === 'rolling_back') return copy.updates.rollingBack;
  if (job.phase === 'rolled_back') return copy.updates.previousRestored;
  return copy.updates.manualRecoveryRequired;
}

export function formatBackupTime(value: string, locale?: PostLocale | null): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

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
  // The release check failing, which is all `availability` and the status line may say.
  const [error, setError] = useState('');
  // The install going wrong: a refused passkey, a refused request. It says so beside the buttons
  // and leaves the status of the release as the check found it, which was fine.
  const [installError, setInstallError] = useState('');
  const [installing, setInstalling] = useState(false);
  // Pressed, as against the check the page makes on its own when it opens.
  const [checking, setChecking] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [watch, setWatch] = useState<{ targetVersion: string; previousJobId?: string } | null>(null);
  const mounted = useRef(true);
  const observedJob = useRef<PublicUpdateJob | null>(null);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setChecking(refresh);
    setError('');
    setInstallError('');
    // Read in the catch below, so a 429 there still gets its own sentence and nothing else
    // ever shows the server's, fetch's or an abort's own English.
    let response: Response | null = null;
    try {
      // Only a pressed check waits out the minimum; the page's own first look does not.
      response = await atLeast(fetch('/api/admin/system/updates', refresh ? {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'check' }), signal: AbortSignal.timeout(10_000),
      } : { cache: 'no-store', signal: AbortSignal.timeout(10_000) }), refresh ? MIN_BUSY_MS : 0);
      const result = await response.json().catch(() => ({})) as UpdateCheck & { error?: string };
      if (!response.ok || !result.availability) throw new Error('update check failed');
      if (!mounted.current) return;
      setCheck(result);
      setReconnecting(false);
      if (result.updater?.managed && result.updater.job && !terminalPhases.includes(result.updater.job.phase)) {
        setWatch({ targetVersion: result.updater.job.targetVersion });
      }
    } catch {
      if (mounted.current) setError(updateCheckFailureMessage(copy, response));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setChecking(false);
      }
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
            setInstallError('');
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
    setInstallError('');
    try {
      const confirmed = await confirmUi({
        title: fill(copy.updates.installTitle, { version }), confirmLabel: fill(copy.updates.install, { version }), cancelLabel: copy.shell.cancel,
        message: copy.updates.installBody,
      });
      if (!confirmed || !mounted.current) return;
      const assertion = await authClient.signIn.passkey();
      if (assertion.error || !assertion.data) {
        // Said as the other passkey screens say it: a challenge, a rate limit, a passkey the site
        // does not know and a server fault are not all "it may have been cancelled".
        if (mounted.current) setInstallError(describeReauthFailure(assertion, copy, copy.updates.noPasskey));
        return;
      }
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
        setInstallError(typeof result?.error === 'string' ? result.error : copy.updates.updateRequestUnavailable);
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
      if (mounted.current) setInstallError(describePasskeyException(failure, copy, copy.updates.updateRequestUnavailable));
    } finally {
      if (mounted.current) setInstalling(false);
    }
  }

  const availability = busy ? 'checking' : error ? 'unavailable' : check?.availability ?? 'unavailable';
  const message = busy ? copy.updates.checkingForUpdates
    : error || (check ? updateCheckMessage(copy, check) : copy.updates.updateCheckUnavailable);
  // No release yet is not a failed check, and the label says so.
  const noReleaseYet = !busy && !error && check?.reason === 'no-release';
  const availabilityLabel = busy ? copy.updates.checkingForUpdates
    : noReleaseYet ? copy.updates.noReleaseLabel
    : availabilityLabels(copy)[availability === 'checking' ? 'unavailable' : availability];
  // Nor is it the error colour: 'none' matches no status rule, so it stays the base ink.
  const statusAttr = noReleaseYet ? 'none' : availability;
  const progress = installing ? copy.updates.verifying : message;
  const installability = check?.installability ?? {
    mode: 'check-only' as const,
    installable: false as const,
    reason: copy.updates.checkOnly,
  };
  const currentJob = check?.updater?.managed ? check.updater.job : null;
  const job = currentJob && currentJob.id !== watch?.previousJobId ? currentJob : null;
  // Measured by the updater since 1.3.0; an older one gives nothing, and the card says nothing.
  const durations = currentJob ? updateDurations(currentJob, check?.timeline ?? null) : null;
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
          <p className="update-status" data-status={statusAttr} role="status" aria-live="polite">{copy.updates.releaseAvailability} {availabilityLabel}</p>
          <dl className="admin-facts">
            <div><dt>{copy.updates.installedVersion}</dt><dd>{check?.currentVersion ?? copy.updates.checking}</dd></div>
            {check?.latest && <div><dt>{copy.updates.latestVersion}</dt><dd>{check.latest.manifest.version}</dd></div>}
            {check?.latest && <div><dt>{copy.updates.published}</dt><dd>{formatPublishedAt(check.latest.publishedAt, copy, ownerLocale)}</dd></div>}
          </dl>
          {/* The words live here, so neither button changes width while it works. */}
          <p>{progress}</p>
          {installError && <p className="update-error" role="alert">{installError}</p>}
          {releaseNotes && <a href={releaseNotes} target="_blank" rel="noopener noreferrer">{copy.updates.readReleaseNotes} <span aria-hidden="true">↗</span></a>}
        </div>
        <div className="update-actions">
          <button aria-busy={checking} className="admin-button admin-button--secondary" disabled={busy || installing || !!watch} onClick={() => void load(true)} type="button">{copy.updates.checkAgain}</button>
          {installability.installable && check?.latest && <button aria-busy={installing} className="admin-button admin-button--primary" disabled={busy || installing || !!watch} onClick={() => void install()} type="button">
            {fill(copy.updates.install, { version: check.latest.manifest.version })}
          </button>}
        </div>
      </section>

      <section className="admin-card" aria-labelledby="update-mode-heading">
        <header className="admin-card__head">
          <h2 id="update-mode-heading">{installability.mode === 'managed' ? copy.updates.managed : copy.updates.managedUnavailable}</h2>
          <p>{installabilityReason(copy, check)}</p>
        </header>
        <dl className="admin-facts">
          <div><dt>{copy.updates.updateMode}</dt><dd>{updateModeLabel(copy, check?.updateMode ?? installability.mode)}</dd></div>
        </dl>
      </section>

      {progressVisible(!!watch, job) && <section className="admin-card" aria-labelledby="update-progress-heading">
        <header className="admin-card__head">
          <h2 id="update-progress-heading">{copy.updates.progress}</h2>
          <p role="status" aria-live="polite">{reconnecting ? copy.updates.reconnecting : job ? jobStatusMessage(copy, job) : copy.updates.waitingForUpdater}</p>
        </header>
        <progress className="update-progress" max={8} value={job?.completedSteps ?? 0} aria-label={copy.updates.stepsCompleted} />
        <ol className="update-steps">{steps.map(([phase, label], index) => <li key={phase} aria-current={job?.phase === phase ? 'step' : undefined}>
          {index < (job?.completedSteps ?? 0) && <span aria-label={copy.updates.completed}>✓ </span>}{label}
        </li>)}</ol>
        {job?.phase === 'succeeded' && <p>{fill(copy.updates.installed, { version: job.targetVersion })}</p>}
        {job?.backupCreatedAt && <p>{copy.updates.backupCreated} <time dateTime={job.backupCreatedAt}>{formatBackupTime(job.backupCreatedAt, ownerLocale)}</time>.</p>}
        {job?.phase === 'rolled_back' && <p>{copy.updates.rolledBack}</p>}
        {job?.phase === 'failed_manual_recovery' && <p>{copy.updates.contactOperator}</p>}
      </section>}

      {!progressVisible(!!watch, job) && currentJob && <section className="admin-card" aria-labelledby="last-update-heading">
        <header className="admin-card__head">
          <h2 id="last-update-heading">{copy.updates.lastUpdate}</h2>
          <p>{jobStatusMessage(copy, currentJob)}</p>
        </header>
        <dl className="admin-facts">
          <div><dt>{copy.updates.lastUpdateVersion}</dt><dd>{currentJob.targetVersion}</dd></div>
          {currentJob.finishedAt && <div><dt>{copy.updates.lastUpdateFinished}</dt><dd><time dateTime={currentJob.finishedAt}>{formatBackupTime(currentJob.finishedAt, ownerLocale)}</time></dd></div>}
          {currentJob.backupCreatedAt && <div><dt>{copy.updates.backupCreated}</dt><dd><time dateTime={currentJob.backupCreatedAt}>{formatBackupTime(currentJob.backupCreatedAt, ownerLocale)}</time></dd></div>}
          {durations && <div><dt>{copy.updates.lastUpdateOffline}</dt><dd>{fill(copy.updates.durationSeconds, { count: String(durations.offlineSeconds) })}</dd></div>}
          {durations?.backupKind && durations.backupSeconds !== null && <div><dt>{copy.updates.lastUpdateBackup}</dt><dd>{fill(
            durations.backupKind === 'database' ? copy.updates.backupKindDatabase : copy.updates.backupKindFull,
            { seconds: fill(copy.updates.durationSeconds, { count: String(durations.backupSeconds) }) },
          )}</dd></div>}
        </dl>
        {currentJob.phase === 'failed_manual_recovery' && <p>{copy.updates.contactOperator}</p>}
      </section>}

    </div>
  );
}
