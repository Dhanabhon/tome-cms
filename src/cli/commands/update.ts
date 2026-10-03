import { NoOfficialReleaseError, ReleaseUnreachableError } from '../../server/update/releases.js';
import { compareStableVersions, type UpdateManifest } from '../../update/contracts.js';
import type { PublicUpdateJob } from '../../updater/state.js';
import type { CliContext } from '../main.js';
import { explainError, updateStep } from '../output.js';
import { isBackupRootLow } from '../ownership.js';
import { errorCodeOf, follow, isUpdateRunning, postJob, readStatus, refusal, type UpdaterStatus } from '../socket.js';

type Release = Pick<UpdateManifest, 'version' | 'compatibility' | 'releaseNotesUrl'>;

/**
 * Installs the newest stable release, or the one named, through the updater's own `/v1/apply`, the
 * request System sends. No passkey here: running sudo on the server is already full control of it.
 */
export async function update(context: CliContext, options: { version: string | null; yes: boolean }): Promise<number> {
  const status = await readStatus(context.socket);
  const installed = status.installed.version;
  context.print(`Installed: ${installed}`);
  if (options.version !== null && compareStableVersions(options.version, installed) <= 0) {
    if (options.version === installed) context.print(`TomeCMS ${installed} is up to date.`);
    else context.warn(`${options.version} is older than the installed ${installed}. TomeCMS does not install an older version.`);
    return options.version === installed ? 0 : 1;
  }

  let release: Release;
  try {
    release = (await context.release(options.version)).manifest;
  } catch (error) {
    if (error instanceof NoOfficialReleaseError) {
      if (options.version === null) context.print('No TomeCMS release has been published yet.');
      else context.warn(`There is no TomeCMS release ${options.version}.`);
      return options.version === null ? 0 : 1;
    }
    context.warn(error instanceof ReleaseUnreachableError
      ? 'Could not reach GitHub to check the release. Check the server\'s network, or try again later.'
      : 'The official release could not be verified, so nothing was installed. Try again later, and report it if it repeats.');
    return 1;
  }
  const target = release.version;
  if (options.version === null) context.print(`Newest: ${target} (${release.releaseNotesUrl})`);
  if (compareStableVersions(target, installed) <= 0) {
    context.print(`TomeCMS ${installed} is up to date.`);
    return 0;
  }
  const incompatible = incompatibility(release, status);
  if (incompatible) {
    context.warn(incompatible);
    return 1;
  }

  if (!options.yes && !await context.confirm(`Install ${target}? The updater checks the release, backs up the database (or everything, ` +
    'when the release has a migration) and puts the site in maintenance for a few minutes. [y/N] ')) {
    context.print('Nothing was done.');
    return 1;
  }

  const answer = await postJob(context.socket, context.sleep, '/v1/apply', { version: target, requestId: context.requestId() });
  if (answer.status === 200) {
    context.print(`TomeCMS ${target} is already installed.`);
    return 0;
  }
  if (answer.status !== 202) {
    context.warn(await refusal(context.socket, answer) ?? `The updater refused the update (${errorCodeOf(answer) ?? answer.status}).`);
    return 1;
  }
  const { id } = answer.body as PublicUpdateJob;
  const job = await follow(context, async () => {
    const current = (await readStatus(context.socket)).job;
    if (current?.id !== id) throw new Error('The updater is following another update');
    return current;
  }, (current) => updateStep(current.phase, current.completedSteps, current.totalSteps), (current) => !isUpdateRunning(current));

  if (job.phase === 'succeeded') {
    context.print(`TomeCMS ${target} is installed.`);
    return 0;
  }
  context.warn(job.phase === 'rolled_back'
    ? `The update did not complete. TomeCMS ${installed} is running again.`
    : 'The update stopped and needs manual recovery.');
  context.warn(explainError(job.errorCode, 'update', context.config));
  // An app before 1.10.0 is told of a full disk as `release_unavailable`, a code it knows.
  if (job.errorCode === 'release_unavailable' && await isBackupRootLow(context)) {
    context.warn(explainError('insufficient_disk_space', 'update', context.config));
  }
  return 1;
}

/** Why this server cannot take the release as it is, with System's own checks; null when it can. */
function incompatibility(release: Release, status: UpdaterStatus): string | null {
  const { version, compatibility, releaseNotesUrl } = release;
  const installed = status.installed.version;
  if (compareStableVersions(status.updaterVersion, compatibility.minimumUpdaterVersion) < 0) {
    return `TomeCMS ${version} needs updater ${compatibility.minimumUpdaterVersion} or newer; this server has ${status.updaterVersion}. ` +
      `Upgrade it first: from a checkout of v${version}, run: sudo npm run updater:upgrade`;
  }
  if (compatibility.updaterProtocol !== 1 || compatibility.composeContract !== 1 || compatibility.environmentContract !== 1) {
    return `TomeCMS ${version} needs a manual upgrade of this server first. Its release notes say how: ${releaseNotesUrl}`;
  }
  if (compareStableVersions(installed, compatibility.minimumDirectUpgradeFrom) < 0 || compareStableVersions(installed, compatibility.rollbackSafeFrom) < 0) {
    return `TomeCMS ${version} cannot be installed directly from ${installed}. Its release notes say how: ${releaseNotesUrl}`;
  }
  return null;
}
