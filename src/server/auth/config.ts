import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';

import { pool } from '../db/client';
import { getServerEnv } from '../env';
import {
  assertEnrollmentReference,
  enrollmentStoragePlugin,
  resolveEnrollmentUserByReference,
} from './enrollment';

const env = getServerEnv();
const publicUrl = new URL(env.TOME_CMS_PUBLIC_URL);
if (publicUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)) {
  throw new Error('Passkeys require HTTPS outside loopback.');
}

export const auth = betterAuth({
  baseURL: publicUrl.origin,
  database: pool,
  emailAndPassword: { enabled: false },
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [publicUrl.origin],
  user: { additionalFields: { role: { type: 'string', required: true, defaultValue: 'owner', input: false } } },
  plugins: [enrollmentStoragePlugin, passkey({
    origin: publicUrl.origin,
    rpID: publicUrl.hostname,
    rpName: 'TomeCMS',
    registration: {
      requireSession: false,
      resolveUser: ({ context }) => resolveEnrollmentUserByReference({ reference: context }),
      afterVerification: async ({ context, ctx, user }) => {
        if (!context) return;
        await assertEnrollmentReference({
          reference: context,
          pendingUserId: user.id,
          fallbackAdapter: ctx.context.adapter,
        });
      },
    },
  })],
});
