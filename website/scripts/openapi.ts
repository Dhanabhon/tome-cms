/**
 * Writes the app's OpenAPI document where the documentation's reference pages are built from.
 * The reference is generated rather than written, so it cannot say anything the API does not do.
 * Run from the repository root, where the app's dependencies are: `npm run docs:openapi`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { openApiDocument } from '../../src/server/http/openapi';

const target = new URL('../src/generated/openapi.json', import.meta.url);
mkdirSync(new URL('.', target), { recursive: true });
writeFileSync(target, `${JSON.stringify(openApiDocument, null, 2)}\n`);
console.log(`Wrote ${Object.keys(openApiDocument.paths).length} paths to website/src/generated/openapi.json.`);
