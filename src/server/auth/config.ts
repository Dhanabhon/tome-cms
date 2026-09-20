import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';

import { pool } from '../db/client';
import { getServerEnv } from '../env';
import {
  assertEnrollmentReference,
  assertInstalledOwner,
  assertInstalledOwnerCredential,
  enrollmentStoragePlugin,
  recordPasskeyUse,
  resolveEnrollmentUserByReference,
} from './enrollment';
import { isSupportedPasskeyOrigin } from './origin';
import { consumeRecoveryEnrollmentReference } from './recovery';

const env = getServerEnv();
const publicUrl = new URL(env.TOME_CMS_PUBLIC_URL);
if (!isSupportedPasskeyOrigin(publicUrl, env.NODE_ENV)) {
  throw new Error('Passkeys require HTTPS, or http://localhost during local development. IP-address RP IDs are not supported.');
}

const SESSION_CREATING_PASSKEY_PATHS = new Set([
  '/passkey/verify-registration',
  '/passkey/verify-authentication',
]);

function sessionCredentialId(path: string | undefined, body: unknown): string {
  const response = body && typeof body === 'object' && 'response' in body
    ? (body as { response?: unknown }).response
    : undefined;
  const credentialId = response && typeof response === 'object' && 'id' in response
    ? (response as { id?: unknown }).id
    : undefined;
  if (
    !path
    || !SESSION_CREATING_PASSKEY_PATHS.has(path)
    || typeof credentialId !== 'string'
    || credentialId.length < 1
    || credentialId.length > 2_048
    || !/^[A-Za-z0-9_-]+$/.test(credentialId)
  ) {
    throw new Error('Passkey session credential is invalid.');
  }
  return credentialId;
}

export const auth = betterAuth({
  baseURL: publicUrl.origin,
  database: pool,
  emailAndPassword: { enabled: false },
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [publicUrl.origin],
  disabledPaths: ['/passkey/delete-passkey'],
  user: { additionalFields: { role: { type: 'string', required: true, defaultValue: 'owner', input: false } } },
  session: {
    additionalFields: {
      credentialId: {
        type: 'string',
        required: true,
        input: false,
        returned: false,
        fieldName: 'credential_id',
        references: { model: 'passkey', field: 'credentialID', onDelete: 'cascade' },
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, context) => ({
          data: {
            ...session,
            credentialId: sessionCredentialId(context?.path, context?.body),
          },
        }),
      },
    },
  },
  plugins: [enrollmentStoragePlugin, passkey({
    origin: publicUrl.origin,
    rpID: publicUrl.hostname,
    rpName: 'TomeCMS',
    registration: {
      requireSession: false,
      resolveUser: ({ context }) => resolveEnrollmentUserByReference({ reference: context }),
      afterVerification: async ({ context, ctx, user, verification }) => {
        if (ctx.body.response.id !== verification.registrationInfo?.credential.id) throw new Error('Passkey credential verification failed.');
        if (context) {
          const purpose = await assertEnrollmentReference({
            reference: context,
            pendingUserId: user.id,
            fallbackAdapter: ctx.context.adapter,
          });
          if (purpose === 'recovery') {
            if (ctx.body.createSession !== true) throw new Error('Recovery registration must create a session.');
            await consumeRecoveryEnrollmentReference({
              reference: context,
              ownerId: user.id,
              fallbackAdapter: ctx.context.adapter,
            });
          }
          return;
        }
        if (ctx.context.session?.user.id !== user.id) throw new Error('Installed owner session required.');
        await assertInstalledOwner({ userId: user.id, fallbackAdapter: ctx.context.adapter });
      },
    },
    authentication: {
      afterVerification: async ({ clientData, ctx }) => {
        await assertInstalledOwnerCredential({
          credentialId: clientData.id,
          fallbackAdapter: ctx.context.adapter,
        });
        await recordPasskeyUse(clientData.id);
      },
    },
  })],
});
