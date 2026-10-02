import { NoOfficialReleaseError } from '../../server/update/releases.js';
import { compareStableVersions } from '../../update/contracts.js';
import type { PublicUpdateJob } from '../../updater/state.js';
import type { CliContext } from '../main.js';
import { explainError, updateStep } from '../output.js';
import { errorCodeOf, follow, isUpdateRunning, postJob, readStatus, refusal } from '../socket.js';

/**
 * Installs the newest stable release, or the one named, through the updater's own `/v1/apply`, the
 * request System sends. No passkey here: running sudo on the server is already full control of it.
 */
export async function update(context: CliContext, options: { version: string | null; yes: boolean }): Promise<number> {
  const status = await readStatus(context.socket);
  const installed = status.installed.version;
  context.print(`Installed: ${installed}`);
  let target = options.version;
  if (target === null) {
    let latest;
    try {
      latest = (await context.latestRelease()).manifest;
    } catch (error) {
      if (error instanceof NoOfficialReleaseError) {
        context.print('No TomeCMS release has been published yet.');
        return 0;
      }
      context.warn('Could not check GitHub for the newest release. Check the server\'s network, or name the version: sudo tome update 1.x.y');
      return 1;
    }
    target = latest.version;
    context.print(`Newest: ${target} (${latest.releaseNotesUrl})`);
    if (compareStableVersions(target, installed) <= 0) {
      context.print(`TomeCMS ${installed} is up to date.`);
      return 0;
    }
    // The same checks System makes before it offers a release.
    const { minimumUpdaterVersion, minimumDirectUpgradeFrom, rollbackSafeFrom } = latest.compatibility;
    if (compareStableVersions(status.updaterVersion, minimumUpdaterVersion) < 0) {
      context.warn(`TomeCMS ${target} needs updater ${minimumUpdaterVersion} or newer; this server has ${status.updaterVersion}. ` +
        `Upgrade it first: from a checkout of v${target}, run: sudo npm run updater:upgrade`);
      return 1;
    }
    if (compareStableVersions(installed, minimumDirectUpgradeFrom) < 0 || compareStableVersions(installed, rollbackSafeFrom) < 0) {
      context.warn(`TomeCMS ${target} cannot be installed directly from ${installed}. Its release notes say how: ${latest.releaseNotesUrl}`);
      return 1;
    }
  } else if (compareStableVersions(target, installed) === 0) {
    context.print(`TomeCMS ${installed} is up to date.`);
    return 0;
  } else if (compareStableVersions(target, installed) < 0) {
    context.warn(`${target} is older than the installed ${installed}. TomeCMS does not install an older version.`);
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
  return 1;
}
