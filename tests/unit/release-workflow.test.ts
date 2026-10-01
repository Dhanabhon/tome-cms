import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

test('publishes both attestation bundles with the immutable release', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8');

  assert.match(workflow, /id: image-attestation\n\s+uses: actions\/attest@/);
  assert.match(workflow, /BUNDLE_PATH: \$\{\{ steps\.image-attestation\.outputs\.bundle-path \}\}/);
  assert.match(workflow, /cp "\$BUNDLE_PATH" tomecms-image\.attestation\.json/);
  assert.match(workflow, /id: manifest-attestation\n\s+uses: actions\/attest@/);
  assert.match(workflow, /BUNDLE_PATH: \$\{\{ steps\.manifest-attestation\.outputs\.bundle-path \}\}/);
  assert.match(workflow, /cp "\$BUNDLE_PATH" update-manifest\.attestation\.json/);
  assert.match(
    workflow,
    /gh release create "\$TAG" update-manifest\.json tomecms-image\.attestation\.json update-manifest\.attestation\.json/,
  );
});

interface Workflow {
  on: { push?: { branches?: string[] }; pull_request?: unknown };
  jobs: Record<string, {
    'runs-on'?: string;
    needs?: string | string[];
    strategy?: { matrix?: { include?: Record<string, string>[] } };
    steps: { name?: string; run?: string; uses?: string }[];
  }>;
}

test('each architecture of the image is built on its own machine, not emulated', async () => {
  // QEMU's arm64 emulation died with "Illegal instruction" on 1.1.2, 1.7.0, 1.8.0 and twice on 1.8.1.
  const release = await workflow('release.yml');
  const steps = Object.values(release.jobs).flatMap((job) => job.steps);
  assert.ok(!steps.some((step) => step.uses?.startsWith('docker/setup-qemu-action')), 'no emulation');

  const [name, image] = Object.entries(release.jobs).find(([, job]) => job.strategy?.matrix?.include) ?? [];
  assert.ok(name && image, 'a job per architecture');
  assert.equal(image['runs-on'], '${{ matrix.runner }}');
  assert.deepEqual(image.strategy?.matrix?.include, [
    { platform: 'linux/amd64', runner: 'ubuntu-24.04' },
    { platform: 'linux/arm64', runner: 'ubuntu-24.04-arm' },
  ]);

  // One index over both, made and attested only once both are built.
  const publish = Object.values(release.jobs).find((job) => job.steps.some((step) => step.run?.includes('gh release create')));
  assert.ok(publish && [publish.needs].flat().includes(name), 'the release waits for every architecture');
  assert.ok(publish.steps.some((step) => step.run?.includes('docker buildx imagetools create')), 'both joined in one index');
});

async function workflow(name: string): Promise<Workflow> {
  return parse(await readFile(`.github/workflows/${name}`, 'utf8')) as Workflow;
}

test('CI runs on develop and pull requests, not on main', async () => {
  const ci = await workflow('ci.yml');
  assert.deepEqual(ci.on.push?.branches, ['develop']);
  assert.ok('pull_request' in ci.on);
});

test('a push to main is tagged only after CI passed on that same commit', async () => {
  const tagRelease = await workflow('tag-release.yml');
  assert.deepEqual(tagRelease.on.push?.branches, ['main']);
  const steps = tagRelease.jobs.tag.steps;
  const wait = steps.findIndex((step) => step.name === 'Wait for CI to pass on this commit');
  const tag = steps.findIndex((step) => step.run?.includes('gh workflow run release.yml'));
  assert.ok(wait >= 0 && tag > wait, 'the wait for CI comes before the tag');
  assert.match(steps[wait].run ?? '', /actions\/workflows\/ci\.yml\/runs\?head_sha=\$SHA&event=push/);
  assert.match(steps[wait].run ?? '', /"completed success"/);
});
