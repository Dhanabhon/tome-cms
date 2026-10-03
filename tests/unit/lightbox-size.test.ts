import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { cssRules } from '../helpers/css';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

// An image with an empty alt -- a cover is decoration under its own title -- draws nothing at all
// while it loads or when it cannot: the dialog that holds only it was open but 0px tall. The picture
// keeps its shape from the first frame, from the image it was opened from.
test('the lightbox picture takes the shape of the image it opens, so it has a size before it loads', () => {
  const client = read('src/plugins/lightbox/client.ts');
  assert.match(client, /image\.naturalWidth \|\| Number\(image\.getAttribute\('width'\)\)/);
  assert.match(client, /image\.naturalHeight \|\| Number\(image\.getAttribute\('height'\)\)/);
  assert.match(client, /shown\.width = width;\s*shown\.height = height;/);
  const picture = cssRules(read('src/styles/global.css')).find(({ selector }) => selector === '.lightbox__image')?.body ?? '';
  assert.match(picture, /height: auto/, 'the height follows the width, by the ratio the attributes give');
});
