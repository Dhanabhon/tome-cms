import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

test('production image compiles public Supabase config and keeps privileged keys runtime-only', { timeout: 600_000 }, async () => {
  const suffix = randomBytes(12).toString('hex');
  const image = `tomecms-foundation-image-test:${suffix}`;
  const privateValue = randomBytes(32).toString('hex');
  const env = {
    ...process.env,
    PUBLIC_SUPABASE_URL: `https://${suffix}.supabase.co`,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${suffix}`,
    PUBLIC_SUPABASE_ANON_KEY: `public_legacy_${suffix}`,
    SUPABASE_SECRET_KEY: privateValue,
    SUPABASE_SERVICE_ROLE_KEY: privateValue,
  };
  const run = (args, label) => {
    const result = spawnSync('docker', args, { env, encoding: 'utf8', timeout: 480_000, maxBuffer: 16 * 1024 * 1024 });
    assert.ok(!`${result.stdout}${result.stderr}`.includes(privateValue), `${label}: no private value in command output`);
    const failure = ['compiled public configuration is recognized', 'runtime private configuration is recognized', 'private configuration was not baked into the image', 'public values reach the compiled CMS'].find(message => result.stderr?.includes(message));
    assert.equal(result.status, 0, `${label}${failure ? `: ${failure}` : ''}`);
    return result.stdout;
  };
  try {
    const config = spawnSync('docker', ['compose', '-f', 'compose.yaml', '--profile', 'production', 'config', '--format', 'json', '--no-env-resolution'], {
      env: { ...env, POSTGRES_PASSWORD: privateValue, S3_ACCESS_KEY_ID: 'image-test-only', S3_SECRET_ACCESS_KEY: privateValue, S3_BUCKET: 'image-test-media', MINIO_LICENSE_FILE: '/dev/null' },
      encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(config.status, 0, 'production Compose configuration parses without starting storage');
    const app = JSON.parse(config.stdout).services.app;
    const publicNames = ['PUBLIC_SUPABASE_ANON_KEY', 'PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'PUBLIC_SUPABASE_URL'];
    assert.deepEqual(Object.keys(app.build.args).sort(), publicNames, 'Compose permits only public build arguments');
    assert.ok(publicNames.every(key => app.build.args[key] === env[key]), 'Compose forwards supplied public values');
    run(['build', '--build-arg', 'PUBLIC_SUPABASE_URL', '--build-arg', 'PUBLIC_SUPABASE_PUBLISHABLE_KEY', '--build-arg', 'PUBLIC_SUPABASE_ANON_KEY', '-t', image, '.'], 'Docker build');
    run(['run', '--rm', '--network', 'none', '--entrypoint', 'node', '-e', 'PUBLIC_SUPABASE_URL', '-e', 'PUBLIC_SUPABASE_PUBLISHABLE_KEY', '-e', 'PUBLIC_SUPABASE_ANON_KEY', '-e', 'SUPABASE_SECRET_KEY', image, '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { readdir, readFile } from 'node:fs/promises';
      const paths = await readdir('/app/dist', { recursive: true });
      const privateValue = process.env.SUPABASE_SECRET_KEY;
      let publicUrl = false, publicKey = false, checked = false;
      for (const path of paths.filter(path => /\\.(mjs|js|html)$/.test(path))) {
        const source = await readFile('/app/dist/' + path, 'utf8');
        assert.ok(!source.includes(privateValue), 'private key absent from built files');
        publicUrl ||= source.includes(process.env.PUBLIC_SUPABASE_URL);
        publicKey ||= source.includes(process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
        if (source.includes('function hasSupabasePublicConfig(')) {
          const exports = Object.values(await import('/app/dist/' + path));
          const publicConfigured = exports.find(value => typeof value === 'function' && value.name === 'hasSupabasePublicConfig');
          const privateConfigured = exports.find(value => typeof value === 'function' && value.name === 'hasSupabaseAdminKey');
          assert.equal(publicConfigured(), true, 'compiled public configuration is recognized');
          assert.equal(privateConfigured(), true, 'runtime private configuration is recognized');
          delete process.env.SUPABASE_SECRET_KEY;
          assert.equal(privateConfigured(), false, 'private configuration was not baked into the image');
          checked = true;
        }
      }
      assert.ok(publicUrl && publicKey && checked, 'public values reach the compiled CMS');
    `], 'Built image public configuration and runtime-only private key');

    const archive = spawn('docker', ['image', 'save', image], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let leaked = false;
    let tail = Buffer.alloc(0);
    archive.stderr.on('data', () => {});
    const closed = new Promise((resolve, reject) => {
      archive.once('error', reject);
      archive.once('close', resolve);
    });
    for await (const chunk of archive.stdout) {
      const bytes = Buffer.concat([tail, chunk]);
      leaked ||= bytes.includes(Buffer.from(privateValue));
      tail = bytes.subarray(Math.max(0, bytes.length - privateValue.length));
    }
    assert.equal(await closed, 0, 'final image layers and metadata exported for inspection');
    assert.equal(leaked, false, 'private value absent from image layers and metadata');
  } finally {
    run(['image', 'rm', image], 'Remove disposable image');
  }
});
