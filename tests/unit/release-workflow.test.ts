import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
