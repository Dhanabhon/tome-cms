import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { OFFICIAL_REPOSITORY } from '../../src/update/contracts';

interface WrittenFile {
  path: string;
  permissions: string;
  content: string;
}

interface CloudConfig {
  write_files: WrittenFile[];
  packages: string[];
  runcmd: string[][];
}

const text = await readFile('deploy/cloud-init.yaml', 'utf8');
const config = parse(text) as CloudConfig;

function written(path: string): WrittenFile {
  const found = config.write_files.find((file) => file.path === path);
  assert.ok(found, `${path} is written`);
  return found;
}

function settings(): Map<string, string> {
  const lines = written('/etc/tomecms-install.env').content.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
  return new Map(lines.map((line) => line.split('=', 2) as [string, string]));
}

test('the file is user data cloud-init reads', () => {
  assert.equal(text.split('\n')[0], '#cloud-config');
  assert.deepEqual(config.packages, ['git']);
  assert.deepEqual(config.runcmd, [['/usr/local/sbin/tomecms-first-boot']]);
});

test('the owner fills in two addresses, and nothing else', () => {
  assert.deepEqual([...settings().keys()], ['TOME_CMS_PUBLIC_URL', 'S3_ENDPOINT', 'TOMECMS_VERSION']);
  assert.equal(settings().get('TOME_CMS_PUBLIC_URL'), 'https://cms.example.com');
  assert.equal(settings().get('S3_ENDPOINT'), 'https://media.example.com');
});

test('it installs the release in package.json', async () => {
  const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
  assert.equal(settings().get('TOMECMS_VERSION'), `v${version}`, 'A release updates TOMECMS_VERSION in deploy/cloud-init.yaml to its own tag.');
});

test('only root can read the settings or run the first-boot script', () => {
  assert.equal(written('/etc/tomecms-install.env').permissions, '0600');
  assert.equal(written('/usr/local/sbin/tomecms-first-boot').permissions, '0700');
});

test('the first-boot script is valid bash', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-init-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, 'tomecms-first-boot');
  await writeFile(script, written('/usr/local/sbin/tomecms-first-boot').content);
  const result = spawnSync('/bin/bash', ['-n', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('the first-boot script prepares the server, then installs', () => {
  const script = written('/usr/local/sbin/tomecms-first-boot').content;
  assert.match(script, /prepare-vps\.sh" --create-user --user tomecms --cms-url "\$TOME_CMS_PUBLIC_URL" --media-url "\$S3_ENDPOINT"/);
  assert.match(script, /runuser -u tomecms -- env -C "\$app"/);
  assert.match(script, /\[\[ -e "\$log" \]\] \|\| install -m 0600 \/dev\/null "\$log"/);
  assert.match(script, /\*example\.com\*\)/);
});

test('a non-0.x release installs dependencies before handing over to the managed installer', () => {
  const script = written('/usr/local/sbin/tomecms-first-boot').content;
  assert.match(script, /\(cd "\$src" && npm ci && \.\/scripts\/deploy-vps\.sh\)/);
});

test('the server tools clone the official repository', async () => {
  const clone = `https://github.com/${OFFICIAL_REPOSITORY}.git`;
  assert.match(written('/usr/local/sbin/tomecms-first-boot').content, new RegExp(`^repo=${clone.replaceAll('.', '\\.')}$`, 'm'));
  assert.ok((await readFile('scripts/prepare-vps.sh', 'utf8')).includes(`git clone ${clone} `), 'prepare-vps.sh prints the same address');
});
