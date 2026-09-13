import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  compareStableVersions,
  OFFICIAL_IMAGE_REPOSITORY,
  OFFICIAL_REPOSITORY,
  parseStableVersion,
  parseUpdateManifest,
  type UpdateManifest,
} from '../src/update/contracts.js';

export interface ReleaseManifestInput {
  packageVersion: string;
  tag: string;
  commit: string;
  digest: string;
  releasedAt: string;
  minimumDirectUpgradeFrom: string;
  minimumUpdaterVersion: string;
  targetMigration: string;
  rollbackSafeFrom: string;
}

const argumentNames = new Set([
  '--package-version', '--tag', '--commit', '--digest', '--released-at',
  '--minimum-direct-upgrade-from', '--minimum-updater-version', '--target-migration',
  '--rollback-safe-from', '--output',
]);

export function buildReleaseManifest(input: ReleaseManifestInput): UpdateManifest {
  const version = stableVersion(input.packageVersion, 'package version');
  if (input.tag !== `v${version}`) throw new Error('Release tag does not match package version');
  if (!/^[0-9a-f]{40}$/.test(input.commit)) throw new Error('Invalid release commit');
  if (!/^sha256:[0-9a-f]{64}$/.test(input.digest)) throw new Error('Invalid image digest');

  const minimumDirectUpgradeFrom = stableVersion(input.minimumDirectUpgradeFrom, 'minimum direct upgrade version');
  const minimumUpdaterVersion = stableVersion(input.minimumUpdaterVersion, 'minimum updater version');
  const rollbackSafeFrom = stableVersion(input.rollbackSafeFrom, 'rollback-safe version');
  if (compareStableVersions(rollbackSafeFrom, minimumDirectUpgradeFrom) > 0) {
    throw new Error('Rollback-safe version cannot exceed minimum direct upgrade version');
  }

  return parseUpdateManifest({
    format: 'tomecms-update',
    manifestVersion: 1,
    product: 'tomecms',
    channel: 'stable',
    version,
    releasedAt: input.releasedAt,
    source: { repository: OFFICIAL_REPOSITORY, commit: input.commit },
    image: {
      repository: OFFICIAL_IMAGE_REPOSITORY,
      digest: input.digest,
      platforms: ['linux/amd64', 'linux/arm64'],
    },
    compatibility: {
      minimumDirectUpgradeFrom,
      minimumUpdaterVersion,
      targetMigration: input.targetMigration,
      rollbackSafeFrom,
      composeContract: 1,
      environmentContract: 1,
      updaterProtocol: 1,
    },
    releaseNotesUrl: `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/v${version}`,
  });
}

async function main(argv: string[]): Promise<void> {
  const args = namedArguments(argv);
  const output = required(args, '--output');
  const manifest = buildReleaseManifest({
    packageVersion: required(args, '--package-version'),
    tag: required(args, '--tag'),
    commit: required(args, '--commit'),
    digest: required(args, '--digest'),
    releasedAt: required(args, '--released-at'),
    minimumDirectUpgradeFrom: required(args, '--minimum-direct-upgrade-from'),
    minimumUpdaterVersion: required(args, '--minimum-updater-version'),
    targetMigration: required(args, '--target-migration'),
    rollbackSafeFrom: required(args, '--rollback-safe-from'),
  });
  const payload = `${JSON.stringify(parseUpdateManifest(manifest), null, 2)}\n`;

  try {
    await writeFile(output, payload, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Refusing to overwrite existing output: ${output}`);
    }
    throw error;
  }
}

function stableVersion(value: unknown, label: string): string {
  try {
    return parseStableVersion(value).raw;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function namedArguments(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!argumentNames.has(name) || value === undefined || values.has(name)) {
      if (name.startsWith('--') && !argumentNames.has(name)) throw new Error(`Unknown argument: ${name}`);
      throw new Error('Arguments must be unique named values');
    }
    values.set(name, value);
  }
  return values;
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
