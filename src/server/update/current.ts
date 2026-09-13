import packageJson from '../../../package.json' with { type: 'json' };
import { parseStableVersion } from '../../update/contracts.js';

export type UpdateMode = 'check-only' | 'managed';

export interface BuildInfo {
  version: string;
  commitSha: string | null;
}

export function getBuildInfo(
  input: Pick<NodeJS.ProcessEnv, 'TOME_CMS_VERSION' | 'TOME_CMS_COMMIT_SHA'> = process.env as Pick<NodeJS.ProcessEnv, 'TOME_CMS_VERSION' | 'TOME_CMS_COMMIT_SHA'>,
): BuildInfo {
  const version = parseStableVersion(input.TOME_CMS_VERSION?.trim() || packageJson.version).raw;
  const commitSha = input.TOME_CMS_COMMIT_SHA?.trim() || null;
  if (commitSha !== null && !/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('Invalid build commit SHA');
  return { version, commitSha };
}
