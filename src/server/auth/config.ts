import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';

import { pool } from '../db/client';
import { getServerEnv } from '../env';
import {
  assertEnrollmentReference,
  assertInstalledOwner,
  assertInstalledOwnerCredential,
  enrollmentStoragePlugin,
  resolveEnrollmentUserByReference,
} from './enrollment';
import { isSupportedPasskeyOrigin } from './origin';

const env = getServerEnv();
const publicUrl = new URL(env.TOME_CMS_PUBLIC_URL);
if (!isSupportedPasskeyOrigin(publicUrl, env.NODE_ENV)) {
  throw new Error('Passkeys require HTTPS, or http://localhost during local development. IP-address RP IDs are not supported.');
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
        if (context) {
          await assertEnrollmentReference({
            reference: context,
            pendingUserId: user.id,
            fallbackAdapter: ctx.context.adapter,
          });
          return;
        }
        if (ctx.context.session?.user.id !== user.id) throw new Error('Installed owner session required.');
        await assertInstalledOwner({ userId: user.id, fallbackAdapter: ctx.context.adapter });
      },
    },
    authentication: {
      afterVerification: ({ clientData, ctx }) => assertInstalledOwnerCredential({
        credentialId: clientData.id,
        fallbackAdapter: ctx.context.adapter,
      }),
    },
  })],
});
