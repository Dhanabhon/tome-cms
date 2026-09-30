import assert from 'node:assert/strict';
import test from 'node:test';

import { absoluteMediaUrl } from '../../src/lib/media';

const id = '267b4859-6447-4847-874a-b160037992d2';

test('a file address is the one that works pasted anywhere: the site origin in front of /media/<id>', () => {
  assert.equal(absoluteMediaUrl(`/media/${id}`, 'https://cms.example'), `https://cms.example/media/${id}`);
  assert.equal(absoluteMediaUrl(`/media/${id}`, 'http://localhost:4321'), `http://localhost:4321/media/${id}`);
});

test('an address that already names its site is left as it is', () => {
  assert.equal(absoluteMediaUrl(`https://other.example/media/${id}`, 'https://cms.example'), `https://other.example/media/${id}`);
});
