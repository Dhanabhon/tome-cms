import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parse } from 'yaml';

test('the managed app runs under an init, so it stops on SIGTERM', async () => {
  // Node as PID 1 ignores SIGTERM: `compose stop` then waited out its whole grace and killed the
  // app, and the 1.0.1 to 1.0.2 update timed out there on a real server.
  const compose = parse(await readFile('compose.managed.yaml', 'utf8')) as { services: Record<string, { init?: boolean }> };
  assert.equal(compose.services.app?.init, true);
});
