import assert from 'node:assert/strict';
import test from 'node:test';

import { installationInputSchema, installationTokenMatches } from '../../src/server/auth/installation';

const valid = {
  siteName: 'Tome Notes',
  tagline: 'Ideas worth keeping',
  siteDescription: 'Notes about building software.',
  defaultLocale: 'en',
  timezone: 'Asia/Bangkok',
  adminPath: '/studio',
  email: 'owner@example.com',
} as const;

test('installer input and token boundaries reject unsafe values', () => {
  assert.equal(installationInputSchema.safeParse(valid).success, true);
  for (const input of [
    { ...valid, adminPath: '/api' },
    { ...valid, adminPath: '/recovery' },
    { ...valid, adminPath: '/Admin' },
    { ...valid, adminPath: '/a' },
    { ...valid, email: 'owner@invalid' },
    { ...valid, unexpected: true },
  ]) assert.equal(installationInputSchema.safeParse(input).success, false);

  assert.equal(installationTokenMatches('same-token', 'same-token'), true);
  assert.equal(installationTokenMatches('same-token', 'other-token'), false);
  assert.equal(installationTokenMatches('short', 'a-much-longer-token'), false);
});
