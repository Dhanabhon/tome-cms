import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('a choice is one of its options and a picture is a ready image of this owner’s', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { readPluginStates, writePluginSettings } = await import('../../src/server/plugins/store');
  context.after(closeDatabase);

  await migrateToLatest();
  const owner = async (email: string) => {
    const id = randomUUID();
    await db.insertInto('user').values({ id, name: 'Owner', email, emailVerified: true, image: null, role: 'owner' }).execute();
    return id;
  };
  const ownerId = await owner('popup@example.invalid');
  const strangerId = await owner('popup-stranger@example.invalid');
  const media = async (who: string, values: Record<string, unknown>) => (await db.insertInto('media_items').values({
    owner_id: who, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, state: 'ready', delete_error_code: null,
    object_key: `owners/${who}/2026/09/${randomUUID()}`, original_name: 'file', mime_type: 'image/jpeg',
    size_bytes: 400_000, width: 1600, height: 900, alt_text: null, ...values,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  const picture = await media(ownerId, {});
  const guide = await media(ownerId, { mime_type: 'application/pdf', width: null, height: null });
  const theirs = await media(strangerId, {});

  const state = async () => (await readPluginStates(ownerId)).find((plugin) => plugin.id === 'popup')!;
  assert.deepEqual(
    [(await state()).values.trigger, (await state()).values.delay, (await state()).values.pages],
    ['delay', '10', 'all'],
    'an untouched popup reads its fallbacks',
  );

  const refused = async (why: string, values: Record<string, string>) => {
    await assert.rejects(
      writePluginSettings(ownerId, { enabled: false, id: 'popup', values }),
      (error: unknown) => error instanceof HttpError && error.status === 400,
      why,
    );
  };
  await refused('a trigger it does not offer', { trigger: 'sometimes' });
  await refused('a delay it does not offer', { delay: '7' });
  await refused('an id that is not an id', { image: 'lake.jpg' });
  await refused('a document for a picture', { image: guide });
  await refused('another owner’s picture', { image: theirs });
  await refused('a picture that is not there', { image: randomUUID() });

  await writePluginSettings(ownerId, { enabled: false, id: 'popup', values: { delay: '20', image: picture.toUpperCase(), trigger: 'exit' } });
  assert.equal((await state()).values.image, picture, 'the picture is kept, in lower case');
  assert.equal((await state()).values.trigger, 'exit');
  assert.equal((await state()).values.delay, '20');

  await writePluginSettings(ownerId, { enabled: false, id: 'popup', values: { image: '' } });
  assert.equal((await state()).values.image, '', 'an emptied picture is none');
});
