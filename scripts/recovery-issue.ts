export {};

/**
 * Issues the one-time recovery link the recovery page already offers as an alternative to a
 * saved code -- "or a single-use link generated on the TomeCMS server itself".
 *
 * Until now there was no way to generate one. An owner who lost their Passkey and had not
 * kept the codes was locked out of their own installation for good, with a shell on the
 * machine and full access to the database, which is not a state a self-hosted CMS should be
 * able to reach. The link lasts ten minutes, is spent the moment a replacement Passkey is
 * registered, and leaves any saved recovery codes untouched.
 */
try {
  const { closeDatabase } = await import('../src/server/db/client');
  let link: string;
  let expiresAt: Date;
  try {
    const { getSiteSettings } = await import('../src/server/content/site-settings');
    const settings = await getSiteSettings();
    if (!settings) throw new Error('not installed');
    const { getServerEnv } = await import('../src/server/env');
    const { issueRecoveryEnrollment } = await import('../src/server/auth/recovery');
    const enrollment = await issueRecoveryEnrollment(settings.owner_id);
    const url = new URL('/recovery', getServerEnv().TOME_CMS_PUBLIC_URL);
    url.searchParams.set('context', enrollment.context);
    link = url.href;
    expiresAt = enrollment.expiresAt;
  } finally {
    await closeDatabase();
  }
  // Printed rather than opened: whoever runs this is the one person who should see it.
  console.log(link);
  console.log(`Expires ${expiresAt.toISOString()}. Open it in the browser you want the new Passkey on.`);
} catch (error) {
  console.error(error instanceof Error && error.message === 'not installed'
    ? 'TomeCMS is not installed yet: there is no owner to recover.'
    : 'A recovery link could not be issued.');
  process.exitCode = 1;
}
