import { z } from 'zod';

import type { UpdateMode } from './current.js';

const stableVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);

export const updateActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check') }).strict(),
  z.object({ action: z.literal('apply'), version: stableVersion }).strict(),
]);

export type UpdateAction = z.infer<typeof updateActionSchema>;

// What the admin says about installing, as a code it words in the owner's language. `reason`
// stays for API readers, in English.
export type InstallabilityCode = 'check-only' | 'manual-recovery' | 'in-progress' | 'no-update' | 'manual-upgrade' | 'installable';

export interface UpdateInstallability {
  mode: UpdateMode;
  installable: false;
  reason: string;
  code: InstallabilityCode;
}

export function getUpdateInstallability(mode: UpdateMode): UpdateInstallability {
  return {
    mode,
    installable: false,
    reason: mode === 'check-only'
      ? 'This installation is configured for update checks only.'
      : 'Managed update installation is not available in this release.',
    code: mode === 'check-only' ? 'check-only' : 'no-update',
  };
}
