import assert from 'node:assert/strict';
import test from 'node:test';

import { migrationInventoryArgs } from '../../src/updater/inventory.js';

const image = `ghcr.io/dhanabhon/tome-cms@sha256:${'b'.repeat(64)}`;

test('the migration inventory runs offline and read-only, with only /tmp writable', () => {
  const args = migrationInventoryArgs(image);
  const beforeImage = args.slice(0, args.indexOf(image));
  for (const flag of ['--read-only', '--pull', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges']) {
    assert.ok(beforeImage.includes(flag), `${flag} is a docker option`);
  }
  // tsx compiles into /tmp. Without it the check failed on every server in 1.0.0.
  const tmpfs = beforeImage[beforeImage.indexOf('--tmpfs') + 1];
  assert.match(tmpfs ?? '', /^\/tmp:rw,noexec,nosuid,size=\d+m$/);
  assert.deepEqual(args.slice(args.indexOf(image) + 1, -1), ['--import', 'tsx', '--input-type=module', '-e']);
});
