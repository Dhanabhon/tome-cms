import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';

import { pool } from '../db/client';
import { getServerEnv } from '../env';
import { consumeDeviceEnrollmentReference } from './device-link';
import {
  assertEnrollmentReference,
  assertInstalledOwner,
  assertInstalledOwnerCredential,
  enrollmentStoragePlugin,
  recordPasskeyUse,
  resolveEnrollmentUserByReference,
} from './enrollment';
import { FRESH_SESSION_SECONDS } from './fresh-session';
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
  disabledPaths: ['/passkey/delete-passkey', '/passkey/update-passkey'],
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
          // A device link adds a passkey and lands the new device signed in. It is spent here,
          // in the registration transaction, so the same link cannot register a second device.
          if (purpose === 'device') {
            if (ctx.body.createSession !== true) throw new Error('Device registration must create a session.');
            await consumeDeviceEnrollmentReference({
              reference: context,
              ownerId: user.id,
              fallbackAdapter: ctx.context.adapter,
            });
          }
          return;
        }
        const current = ctx.context.session;
        if (current?.user.id !== user.id) throw new Error('Installed owner session required.');
        // A spare is a lasting credential that can come with a new session, so it asks for the same
        // fresh verification as the recovery codes, updates and MCP consent it would reach. The
        // session was just read from the database; this may run inside the createSession
        // transaction, so it is checked here rather than with a second connection.
        const sessionAge = Date.now() - new Date(current.session.createdAt).getTime();
        if (!(sessionAge <= FRESH_SESSION_SECONDS * 1000)) throw new Error('Fresh owner verification required.');
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
