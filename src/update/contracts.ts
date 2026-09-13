export const OFFICIAL_REPOSITORY = 'Dhanabhon/tome-cms' as const;
export const OFFICIAL_IMAGE_REPOSITORY = 'ghcr.io/dhanabhon/tome-cms' as const;
export const UPDATE_MANIFEST_ASSET = 'update-manifest.json' as const;

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const shippedMigrations = new Set([
  '001_system',
  '002_auth_installer',
  '003_security_recovery',
  '004_session_credential_recovery',
  '005_content',
  '006_media',
  '007_preview_tokens',
]);
const platformValues = new Set(['linux/amd64', 'linux/arm64'] as const);

export interface StableVersion {
  raw: string;
  parts: readonly [number, number, number];
}

export interface UpdateManifest {
  format: 'tomecms-update';
  manifestVersion: 1;
  product: 'tomecms';
  channel: 'stable';
  version: string;
  releasedAt: string;
  source: { repository: typeof OFFICIAL_REPOSITORY; commit: string };
  image: {
    repository: typeof OFFICIAL_IMAGE_REPOSITORY;
    digest: string;
    platforms: Array<'linux/amd64' | 'linux/arm64'>;
  };
  compatibility: {
    minimumDirectUpgradeFrom: string;
    minimumUpdaterVersion: string;
    targetMigration: string;
    rollbackSafeFrom: string;
    composeContract: number;
    environmentContract: number;
    updaterProtocol: number;
  };
  releaseNotesUrl: string;
}

export function parseStableVersion(value: unknown): StableVersion {
  if (typeof value !== 'string') throw new Error('Invalid stable version');
  const match = stableVersionPattern.exec(value);
  if (!match) throw new Error('Invalid stable version');

  const parts = match.slice(1).map(Number) as [number, number, number];
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid stable version');
  return { raw: value, parts };
}

export function compareStableVersions(left: string, right: string): -1 | 0 | 1 {
  const leftParts = parseStableVersion(left).parts;
  const rightParts = parseStableVersion(right).parts;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function parseUpdateManifest(value: unknown): UpdateManifest {
  const manifest = record(value, [
    'format', 'manifestVersion', 'product', 'channel', 'version', 'releasedAt',
    'source', 'image', 'compatibility', 'releaseNotesUrl',
  ]);
  const version = stableVersion(manifest.version);

  if (
    manifest.format !== 'tomecms-update' || manifest.manifestVersion !== 1 ||
    manifest.product !== 'tomecms' || manifest.channel !== 'stable' ||
    !isIsoDate(manifest.releasedAt)
  ) throw invalidManifest();

  const source = record(manifest.source, ['repository', 'commit']);
  if (source.repository !== OFFICIAL_REPOSITORY || !isString(source.commit, /^[0-9a-f]{40}$/)) {
    throw invalidManifest();
  }

  const image = record(manifest.image, ['repository', 'digest', 'platforms']);
  if (
    image.repository !== OFFICIAL_IMAGE_REPOSITORY ||
    !isString(image.digest, /^sha256:[0-9a-f]{64}$/) ||
    !platforms(image.platforms)
  ) throw invalidManifest();

  const compatibility = record(manifest.compatibility, [
    'minimumDirectUpgradeFrom', 'minimumUpdaterVersion', 'targetMigration', 'rollbackSafeFrom',
    'composeContract', 'environmentContract', 'updaterProtocol',
  ]);
  const minimumDirectUpgradeFrom = stableVersion(compatibility.minimumDirectUpgradeFrom);
  const minimumUpdaterVersion = stableVersion(compatibility.minimumUpdaterVersion);
  const rollbackSafeFrom = stableVersion(compatibility.rollbackSafeFrom);
  if (
    typeof compatibility.targetMigration !== 'string' ||
    !shippedMigrations.has(compatibility.targetMigration) ||
    !positiveInteger(compatibility.composeContract) ||
    !positiveInteger(compatibility.environmentContract) ||
    !positiveInteger(compatibility.updaterProtocol) ||
    !isReleaseNotesUrl(manifest.releaseNotesUrl, version)
  ) throw invalidManifest();

  return {
    format: 'tomecms-update', manifestVersion: 1, product: 'tomecms', channel: 'stable',
    version, releasedAt: manifest.releasedAt,
    source: { repository: OFFICIAL_REPOSITORY, commit: source.commit },
    image: {
      repository: OFFICIAL_IMAGE_REPOSITORY,
      digest: image.digest,
      platforms: image.platforms,
    },
    compatibility: {
      minimumDirectUpgradeFrom,
      minimumUpdaterVersion,
      targetMigration: compatibility.targetMigration,
      rollbackSafeFrom,
      composeContract: compatibility.composeContract,
      environmentContract: compatibility.environmentContract,
      updaterProtocol: compatibility.updaterProtocol,
    },
    releaseNotesUrl: manifest.releaseNotesUrl,
  };
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) throw invalidManifest();
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== keys.length || !actualKeys.every((key) => keys.includes(key))) {
    throw invalidManifest();
  }
  return value as Record<string, unknown>;
}

function stableVersion(value: unknown): string {
  try {
    return parseStableVersion(value).raw;
  } catch {
    throw invalidManifest();
  }
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isString(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

function platforms(value: unknown): value is Array<'linux/amd64' | 'linux/arm64'> {
  return Array.isArray(value) && value.length > 0 &&
    value.every((platform): platform is 'linux/amd64' | 'linux/arm64' => platformValues.has(platform)) &&
    new Set(value).size === value.length;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isReleaseNotesUrl(value: unknown, version: string): value is string {
  if (typeof value !== 'string') return false;
  const expected = `https://github.com/Dhanabhon/tome-cms/releases/tag/v${version}`;
  return value === expected;
}

function invalidManifest(): Error {
  return new Error('Invalid update manifest');
}
