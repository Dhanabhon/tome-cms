import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { listArchive, packDirectory } from '../../src/cli/archive.js';
import type { CliContext } from '../../src/cli/main.js';
import { streamCommand, tome } from '../../src/cli/main.js';
import type { SocketAnswer } from '../../src/cli/socket.js';
import { runCommand, type CommandResult } from '../../src/updater/process.js';
import { fakeContext, requestId, statusAnswer, updateJob } from '../helpers/cli-context.js';

type Fake = ReturnType<typeof transferContext>;
const run = (f: Fake, argv: string[]) => tome(argv, { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn });

const thai = 'ขนมปัง-ยามค่ำ.md';
const secret = 'correct-horse-battery-staple';
const work = (root: string) => join(root, `.work-${requestId}`);

/** A backup root, and the site's env file beside it. Removed after the test. */
async function server(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'tome-transfer-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'backups');
  await mkdir(root, { mode: 0o700 });
  const environmentFile = join(base, 'tome-cms.env');
  await writeFile(environmentFile, `TOME_CMS_PUBLIC_URL='https://example.com'\nPOSTGRES_PASSWORD='${secret}'\n`);
  const { uid, gid } = await stat(root);
  return { base, root, environmentFile, owner: `${uid}:${gid}` };
}

type Server = Awaited<ReturnType<typeof server>>;

/** An export's archive in the backup root, packed with the system tar from these files. */
async function archive(site: Server, files: Record<string, string>, name = 'markdown-20261001T100000000Z.tar.gz'): Promise<string> {
  const source = await mkdtemp(join(site.base, 'source-'));
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(source, path, '..'), { recursive: true });
    await writeFile(join(source, path), body);
  }
  const path = join(site.root, name);
  await packDirectory({ runCommand, streamCommand }, source, path);
  return path;
}

const receipt = (value: unknown, code = 0): CommandResult => ({ code, stdout: `${JSON.stringify(value)}\n`, stderr: '' });

const plan = {
  create: [
    { kind: 'post', locale: 'en', slug: 'bread', path: 'posts/en/bread.md', source: 'tome.json' },
    { kind: 'post', locale: 'en', slug: 'rye', path: 'posts/en/rye.md', source: 'tome.json' },
    { kind: 'post', locale: 'th', slug: 'ขนมปัง', path: 'posts/th/ขนมปัง.md', source: 'md' },
    { kind: 'page', locale: 'en', slug: 'about', path: 'pages/en/about.md', source: 'tome.json' },
  ],
  skip: [{ path: 'posts/en/hello.md', reason: 'slug_taken' }],
  media: { upload: 2, reuse: 1 },
  categoriesToCreate: ['Baking', 'ขนม'],
  groupsSplit: [{ translation: '7', skipped: ['posts/en/hello.md'] }],
};

/**
 * A context on `site` whose docker answers through `docker`, and whose tar and chmod are the
 * system's own. Every command is recorded, with whether the work directory existed then.
 */
function transferContext(site: Server, input: {
  docker?: (args: readonly string[]) => CommandResult | Promise<CommandResult>;
  version?: string;
  busy?: boolean | null;
  routes?: Record<string, SocketAnswer[]>;
  overrides?: Partial<CliContext>;
} = {}) {
  const commands: Array<{ executable: string; args: readonly string[]; timeoutMs: number; workExists: boolean }> = [];
  const f = fakeContext({
    config: { backupDirectory: site.root, environmentFile: site.environmentFile },
    routes: {
      'GET /v1/status': [statusAnswer(null, input.version ?? '1.13.0')],
      'GET /v1/busy': [input.busy === null ? { status: 404, body: { error: 'not_found' } } : { status: 200, body: { busy: input.busy ?? false } }],
      'GET /v1/restore': [{ status: 404, body: { error: 'not_found' } }],
      ...input.routes,
    },
    overrides: {
      runCommand: async (executable, args, options) => {
        commands.push({ executable, args, timeoutMs: options.timeoutMs, workExists: existsSync(work(site.root)) });
        if (executable === 'docker') return { code: 0, stdout: '', stderr: '' }; // docker rm --force
        if (executable === 'chown') return { code: 0, stdout: '', stderr: '' };
        return runCommand(executable, args, options);
      },
      // The one-shots are streamed, so their output is never cut at 32 KiB; tar's listing is real.
      streamCommand: async (executable, args, onLine, options) => {
        if (executable !== 'docker') return streamCommand(executable, args, onLine, options);
        commands.push({ executable, args, timeoutMs: options?.timeoutMs ?? 0, workExists: existsSync(work(site.root)) });
        const result = await (input.docker ?? (() => receipt({ ok: true, plan })))(args);
        for (const line of result.stdout.split('\n')) if (line) onLine(line, 'stdout');
        for (const line of result.stderr.split('\n')) if (line) onLine(line, 'stderr');
        return result.code;
      },
      ...input.overrides,
    },
  });
  return { ...f, commands, docker: () => commands.filter((call) => call.executable === 'docker' && call.args[0] === 'compose') };
}

function oneShot(site: Server, label: string, step: string[]): string[] {
  return [
    'compose', '-p', 'tomecms', '-f', '/opt/tome-cms/compose.managed.yaml', '--env-file', site.environmentFile,
    '--env-file', '/var/lib/tome-cms/updater/image.env', 'run', '--rm', '--name', `tomecms-tome-${requestId}-${label}`,
    '--no-deps', '--user', site.owner, '--env', 'DATABASE_QUERY_TIMEOUT_MS=3600000', '--volume', `${site.root}:/work`,
    'app', 'npm', 'run', '--silent', 'content', '--', ...step,
  ];
}

// --- export -------------------------------------------------------------------------------------

test('export runs the step as the backup root\'s owner, packs its directory to a 0600 archive, and removes the directory', async (t) => {
  const site = await server(t);
  const f = transferContext(site, {
    // The step makes its own directory, as the updater's user, and writes the export into it.
    docker: async () => {
      assert.equal(existsSync(work(site.root)), false, 'the step makes the directory itself');
      await mkdir(join(work(site.root), 'posts', 'th'), { recursive: true, mode: 0o700 });
      await writeFile(join(work(site.root), 'manifest.json'), '{}');
      await writeFile(join(work(site.root), 'posts', 'th', thai), 'อร่อย');
      return receipt({ ok: true, counts: { posts: 12, pages: 1, media: 40 }, formattingNotShown: 3 });
    },
  });
  assert.equal(await run(f, ['export']), 0, f.err());
  const out = join(site.root, 'markdown-20261002T120000000Z.tar.gz');
  assert.deepEqual(f.docker().map(({ args, timeoutMs }) => ({ args, timeoutMs })), [
    { args: oneShot(site, 'export', ['export', '--out', `/work/.work-${requestId}`]), timeoutMs: 3_600_000 },
  ]);
  const order = f.commands.map(({ executable, args }) => `${executable} ${args.includes(out) ? 'archive' : args[0]}`);
  assert.deepEqual(order, ['docker compose', 'tar archive', 'tar archive', 'chown archive']);
  assert.deepEqual(f.commands.at(-1)!.args, ['-R', '--no-dereference', site.owner, out]);
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  const entries = await listArchive({ runCommand, streamCommand }, out);
  assert.ok(entries.some((entry) => entry.name === `./posts/th/${thai}`), JSON.stringify(entries));
  assert.equal(existsSync(work(site.root)), false, 'the work directory is gone');
  assert.match(f.out(), new RegExp(`^Exported to ${out.replaceAll('.', '\\.')} \\(\\d+(\\.\\d)? (B|KiB)\\)\\.$`, 'm'));
  assert.match(f.out(), /^12 posts, 1 page and 40 media files\.$/m);
  assert.match(f.out(), /^3 items carry formatting the \.md files cannot show \(colour, underline or alignment\); their \.tome\.json files keep it\.$/m);
});

test('a failed export leaves no work directory and no archive, and says why', async (t) => {
  const site = await server(t);
  const f = transferContext(site, {
    docker: async () => {
      await mkdir(work(site.root), { mode: 0o700 }); // half-written, no manifest
      await writeFile(join(work(site.root), 'posts.md'), 'x');
      return receipt({ ok: false, code: 'media_missing', mediaId: '33333333-3333-4333-8333-333333333333\u001b[2J' }, 1);
    },
  });
  assert.equal(await run(f, ['export']), 1);
  assert.equal(f.warned[0], 'A media file the content uses (33333333-3333-4333-8333-333333333333[2J) is missing from storage, so nothing was exported.');
  assert.deepEqual(await readdir(site.root), []);
});

test('export and import refuse an app older than 1.13.0, and a site in maintenance or a busy updater, before anything runs', async (t) => {
  const site = await server(t);
  const path = await archive(site, { 'manifest.json': '{}' });
  const busy = 'The site is in maintenance, or the updater is busy. Try again when it is done.';
  const cases: Array<[Parameters<typeof transferContext>[1], string]> = [
    [{ version: '1.12.4' }, 'This site runs TomeCMS 1.12.4. Export and import need 1.13.0 or newer: sudo tome update'],
    [{ busy: true }, busy],
    // An updater before 1.5.0 cannot say; its running update can.
    [{ busy: null, routes: { 'GET /v1/status': [statusAnswer(updateJob('migrating'), '1.13.0')] } }, busy],
    [{ routes: { 'GET /v1/restore': [{ status: 200, body: { id: requestId, phase: 'failed', maintenanceKept: true } }] } }, busy],
  ];
  for (const [options, sentence] of cases) {
    for (const argv of [['export'], ['import', path, '--yes']]) {
      const f = transferContext(site, options);
      assert.equal(await run(f, argv), 1, argv[0]);
      assert.equal(f.err(), sentence, argv[0]);
      assert.deepEqual(f.commands, [], argv[0]);
    }
  }
  assert.deepEqual((await readdir(site.root)).sort(), ['markdown-20261001T100000000Z.tar.gz']);
});

test('export and import refuse when the disk where backups go is short, before anything runs', async (t) => {
  const site = await server(t);
  const path = await archive(site, { 'manifest.json': '{}' });
  const size = (await stat(path)).size;
  const free = (bytes: number) => ({ statfs: async () => ({ bsize: 1, bavail: bytes }) });
  const short = (step: string, needs: string) =>
    `Not enough free disk space where backups go (${site.root}) for the ${step}: it needs ${needs}, so nothing was ${step}ed; sudo tome prune shows old images that can go.`;

  const exporting = transferContext(site, { overrides: free(5 * 1024 ** 3 - 1) });
  assert.equal(await run(exporting, ['export']), 1);
  assert.equal(exporting.err(), short('export', '5.0 GiB'));
  assert.deepEqual(exporting.commands, []);

  // An archive is unpacked next to itself, so an import needs twice its size when that is more.
  const config = { minimumFreeBytes: 10 };
  const importing = (bytes: number) => {
    const f = transferContext(site, { overrides: free(bytes) });
    f.context.config = { ...f.context.config, ...config };
    return f;
  };
  const tight = importing(2 * size - 1);
  assert.equal(await run(tight, ['import', path, '--dry-run']), 1);
  assert.equal(tight.err(), short('import', `${2 * size} B`));
  assert.deepEqual(tight.commands, []);
  const enough = importing(2 * size);
  assert.equal(await run(enough, ['import', path, '--dry-run']), 0, enough.err());

  const directory = join(site.root, 'hand-written');
  await mkdir(directory);
  const low = transferContext(site, { overrides: free(1024) });
  assert.equal(await run(low, ['import', directory, '--dry-run']), 1);
  assert.equal(low.err(), short('import', '5.0 GiB'));
});

// --- import -------------------------------------------------------------------------------------

test('import unpacks the archive into a work directory, hands it over, prints the plan and asks', async (t) => {
  const site = await server(t);
  const path = await archive(site, { 'manifest.json': '{}', [`posts/th/${thai}`]: 'อร่อย' });
  let seen: string[] = [];
  const f = transferContext(site, {
    docker: async () => {
      seen = (await readdir(work(site.root), { recursive: true })).sort();
      return receipt({ ok: true, plan });
    },
    overrides: { confirm: async (question) => { f.prompts.push(question); return false; } },
  });
  assert.equal(await run(f, ['import', path]), 1);
  assert.deepEqual(seen, ['manifest.json', 'posts', 'posts/th', `posts/th/${thai}`]);
  assert.deepEqual(f.docker().map(({ args }) => args), [oneShot(site, 'import-plan', ['import', '--dir', `/work/.work-${requestId}`, '--plan'])]);
  const chown = f.commands.findIndex((call) => call.executable === 'chown');
  assert.deepEqual(f.commands[chown]!.args, ['-R', '--no-dereference', site.owner, work(site.root)]);
  assert.ok(chown < f.commands.findIndex((call) => call.executable === 'docker'), 'handed over before the step runs');
  assert.deepEqual(f.printed, [
    `Archive: ${path}`,
    'To create: 2 posts in English, 1 post in Thai and 1 page in English.',
    'Skipped, because the address is already taken (nothing is overwritten):',
    '  posts/en/hello.md',
    'Media: 2 files to upload, 1 already on the site.',
    'Categories to create: Baking, ขนม.',
    'These translations had an edition skipped, so the rest form a group without it:',
    '  7: posts/en/hello.md',
    'Nothing was done.',
  ]);
  assert.deepEqual(f.prompts, ['Import these? [y/N] ']);
  assert.equal(existsSync(work(site.root)), false);
});

test('--dry-run stops after the plan, and --yes imports without asking', async (t) => {
  const site = await server(t);
  const path = await archive(site, { 'manifest.json': '{}' });
  const dry = transferContext(site);
  assert.equal(await run(dry, ['import', path, '--dry-run']), 0);
  assert.equal(dry.docker().length, 1);
  assert.deepEqual(dry.prompts, []);
  assert.equal(existsSync(work(site.root)), false);

  const result = { ...plan, missingMedia: 1 };
  const answers = [receipt({ ok: true, plan }), receipt({ ok: true, result })];
  const yes = transferContext(site, { docker: () => answers.shift()! });
  assert.equal(await run(yes, ['import', path, '--yes']), 0, yes.err());
  assert.deepEqual(yes.prompts, []);
  assert.deepEqual(yes.docker().map(({ args }) => args.slice(-4)), [
    ['import', '--dir', `/work/.work-${requestId}`, '--plan'],
    ['import', '--dir', `/work/.work-${requestId}`, '--apply'],
  ]);
  assert.equal(yes.docker()[1]!.args[12], `tomecms-tome-${requestId}-import-apply`);
  assert.deepEqual(yes.printed.slice(-5), [
    'Created 2 posts in English, 1 post in Thai and 1 page in English.',
    'Skipped 1, whose address was already taken.',
    'Media: 2 uploaded, 1 reused.',
    'Categories created: Baking, ขนม.',
    '1 file the content named was not in the archive; it shows as a line saying it is missing.',
  ]);
  assert.equal(existsSync(work(site.root)), false);
});

test('an import with nothing new says so and asks nothing', async (t) => {
  const site = await server(t);
  const path = await archive(site, { 'manifest.json': '{}' });
  const f = transferContext(site, { docker: () => receipt({ ok: true, plan: { ...plan, create: [], groupsSplit: [] } }) });
  assert.equal(await run(f, ['import', path]), 0);
  assert.equal(f.printed.at(-1), 'Nothing to import: everything in it is already on the site.');
  assert.deepEqual(f.prompts, []);
});

test('each refusal of the import step gives its sentence, and the work directory goes', async (t) => {
  const site = await server(t);
  const path = await archive(site, { 'manifest.json': '{}' });
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ code: 'media_too_large', file: 'media/big.png' }, 'media/big.png is larger than the File Manager accepts for its kind.'],
    [{ code: 'front_matter_invalid', file: 'posts/en/a.md', field: 'published' }, 'posts/en/a.md has front matter TomeCMS cannot read: published.'],
    [{ code: 'front_matter_invalid', file: 'posts/en/a.md' }, 'posts/en/a.md has front matter TomeCMS cannot read: the block between the --- lines.'],
    [{ code: 'media_type_unsupported', file: 'media/x.exe' }, 'media/x.exe is not a picture or a document the File Manager accepts.'],
    [{ code: 'content_invalid', file: 'posts/en/c.md' }, 'posts/en/c.md holds content TomeCMS cannot accept, such as a slug that is too long or a document that does not read.'],
    [{ code: 'layout_invalid', file: 'notes.txt' }, 'notes.txt does not fit the archive\'s layout: manifest.json, media/, and posts/ or pages/ in th/ or en/.'],
    [{ code: 'manifest_invalid', file: 'manifest.json' }, 'manifest.json does not read as a TomeCMS Markdown archive\'s.'],
    [{ code: 'site_busy' }, 'The site is in maintenance, or the updater is busy. Try again when it is done.'],
    [{ code: 'site_not_installed' }, 'This site is not set up yet. Finish setting it up in the browser first.'],
    [{ code: 'media_too_large', file: 'media/\u001b[31mred.png' }, 'media/[31mred.png is larger than the File Manager accepts for its kind.'],
  ];
  for (const [answer, sentence] of cases) {
    for (const step of ['plan', 'apply']) {
      const answers = step === 'plan' ? [receipt({ ok: false, ...answer }, 1)] : [receipt({ ok: true, plan }), receipt({ ok: false, ...answer }, 1)];
      const f = transferContext(site, { docker: () => answers.shift()! });
      assert.equal(await run(f, ['import', path, '--yes']), 1, sentence);
      assert.deepEqual(f.warned, [sentence, 'Nothing was imported.'], `${step}: ${sentence}`);
      assert.equal(existsSync(work(site.root)), false);
    }
  }
});

test('a step that fails without a refusal shows its own diagnostics, with secrets hidden', async (t) => {
  const site = await server(t);
  const path = await archive(site, { 'manifest.json': '{}' });
  const f = transferContext(site, { docker: () => ({ code: 1, stdout: '', stderr: ` Container tomecms-run Creating\nError: connect to postgres://tomecms:${secret}@postgres failed\n` }) });
  assert.equal(await run(f, ['import', path, '--yes']), 1);
  assert.deepEqual(f.warned, [
    'The import step failed, and tome could not read its answer (it gave none). What it said:',
    '   Container tomecms-run Creating',
    '  Error: connect to postgres://tomecms:[redacted]@postgres failed',
  ]);
  assert.deepEqual(f.commands.at(-1)!.args, ['rm', '--force', `tomecms-tome-${requestId}-import-plan`], 'a container left behind is removed');
  assert.equal(existsSync(work(site.root)), false);
});

test('a plan far over 32 KiB is read whole: 8,000 Thai items in a receipt of more than 1 MiB', async (t) => {
  const site = await server(t);
  const path = await archive(site, { 'manifest.json': '{}' });
  const create = Array.from({ length: 8_000 }, (_, index) => ({ kind: 'post', locale: 'th', slug: `ขนมปัง-ยามค่ำ-${index}`, path: `posts/th/ขนมปัง-ยามค่ำ-${index}.md`, source: 'md' }));
  const answer = receipt({ ok: true, plan: { ...plan, create, skip: [], groupsSplit: [] } });
  assert.ok(Buffer.byteLength(answer.stdout) > 1024 ** 2, String(Buffer.byteLength(answer.stdout)));
  const f = transferContext(site, { docker: () => answer });
  assert.equal(await run(f, ['import', path, '--dry-run']), 0, f.err());
  assert.equal(f.printed[1], 'To create: 8000 posts in Thai.');
});

test('an answer tome cannot read says so, and after the apply step never claims nothing was imported', async (t) => {
  const site = await server(t);
  const path = await archive(site, { 'manifest.json': '{}' });
  const two = { code: 0, stdout: `${JSON.stringify({ ok: true, plan })}\n{"ok":true}\n`, stderr: '' };
  const cut = { code: 0, stdout: JSON.stringify({ ok: true, plan }).slice(0, 500), stderr: '' };
  const huge = { code: 0, stdout: `{"ok":true,"pad":"${'x'.repeat(16 * 1024 ** 2)}"}`, stderr: '' };
  const cases: Array<[CommandResult, string]> = [[two, 'it gave more than one line'], [cut, 'it was cut off, or is not JSON'], [huge, 'it was longer than 16 MiB']];
  for (const [answer, why] of cases) {
    const planning = transferContext(site, { docker: () => answer });
    assert.equal(await run(planning, ['import', path, '--yes']), 1, why);
    assert.deepEqual(planning.warned, [`The import step failed, and tome could not read its answer (${why}).`], why);
    const answers = [receipt({ ok: true, plan }), answer];
    const applying = transferContext(site, { docker: () => answers.shift()! });
    assert.equal(await run(applying, ['import', path, '--yes']), 1, why);
    assert.deepEqual(applying.warned, [`The import ran, but tome could not read its answer (${why}), so it may have finished. ` +
      'Check the posts and pages in the admin, or run the same import with --dry-run to see what is still to import.'], why);
    assert.doesNotMatch(applying.err(), /nothing was imported/i);
    assert.equal(existsSync(work(site.root)), false);
  }
  // It said ok, but its summary does not read: the import finished all the same.
  const answers = [receipt({ ok: true, plan }), receipt({ ok: true, result: { created: 'lots' } })];
  const odd = transferContext(site, { docker: () => answers.shift()! });
  assert.equal(await run(odd, ['import', path, '--yes']), 0);
  assert.deepEqual(odd.warned, ['The import finished, but tome could not read its summary. See what it added in the admin.']);
});

test('an archive outside the backup root, or with an unsafe entry, is refused before anything is unpacked or run', async (t) => {
  const site = await server(t);
  const path = await archive(site, { 'manifest.json': '{}' });
  const outside = join(site.base, 'elsewhere.tar.gz');
  await writeFile(outside, '');
  await symlink(outside, join(site.root, 'link.tar.gz'));
  await mkdir(join(site.root, 'nested'));
  await writeFile(join(site.root, 'nested', 'x.tar.gz'), '');
  for (const where of [outside, join(site.root, 'link.tar.gz'), join(site.root, 'nested', 'x.tar.gz'), join(site.root, 'missing.tar.gz'), site.root]) {
    const f = transferContext(site);
    assert.equal(await run(f, ['import', where, '--yes']), 1, where);
    assert.equal(f.err(), 'That archive is not under /var/backups/tome-cms.', where);
    assert.deepEqual(f.commands, []);
  }
  // A link inside the archive: listed, refused, never unpacked.
  const source = await mkdtemp(join(site.base, 'linked-'));
  await symlink('/etc/shadow', join(source, 'manifest.json'));
  const linked = join(site.root, 'linked.tar.gz');
  await packDirectory({ runCommand, streamCommand }, source, linked);
  const f = transferContext(site);
  assert.equal(await run(f, ['import', linked, '--yes']), 1);
  assert.equal(f.err(), 'That archive holds a link or a special file (./manifest.json), so nothing was imported.');
  assert.deepEqual(f.commands, []);
  assert.deepEqual((await readdir(site.root)).sort(), ['link.tar.gz', 'linked.tar.gz', path.slice(site.root.length + 1), 'nested'].sort());
});

test('a directory laid out like an archive imports in place, after its own check', async (t) => {
  const site = await server(t);
  const directory = join(site.root, 'hand-written');
  await mkdir(join(directory, 'posts', 'en'), { recursive: true });
  await writeFile(join(directory, 'posts', 'en', 'a.md'), '---\ntitle: A\n---\nHi\n');
  const f = transferContext(site);
  assert.equal(await run(f, ['import', directory, '--dry-run']), 0, f.err());
  assert.deepEqual(f.commands.map(({ executable, args }) => [executable, args.at(-1)]), [['chown', directory], ['docker', '--plan']]);
  assert.deepEqual(f.docker()[0]!.args.slice(-4), ['import', '--dir', '/work/hand-written', '--plan']);
  assert.equal(existsSync(join(directory, 'posts', 'en', 'a.md')), true, 'a directory given is left where it is');

  await symlink('/etc/shadow', join(directory, 'posts', 'en', 'b.md'));
  const linked = transferContext(site);
  assert.equal(await run(linked, ['import', directory, '--dry-run']), 1);
  assert.equal(linked.err(), 'That archive holds a link or a special file (posts/en/b.md), so nothing was imported.');
  assert.deepEqual(linked.commands, []);
});
