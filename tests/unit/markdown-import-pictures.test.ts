import assert from 'node:assert/strict';
import test from 'node:test';

import { describePicture, matchFiles, needsFile, pictureLabel } from '../../src/lib/markdown-import';

test('a picture is local, from another site, or refused, by how the file writes its address', () => {
  assert.equal(describePicture('./images/Cover.PNG', 'body').kind, 'local');
  assert.equal(describePicture('diagram.png', 'body').kind, 'local');
  assert.equal(describePicture('/uploads/a.jpg', 'body').kind, 'local');
  assert.equal(describePicture('https://i.imgur.com/abc.jpg', 'body').kind, 'remote');
  assert.equal(describePicture('HTTP://x.com/a.png', 'body').kind, 'remote');
  assert.equal(describePicture('data:image/png;base64,iVBORw0KGgo=', 'body').kind, 'refused');
  assert.equal(describePicture('//cdn.example.com/a.png', 'body').kind, 'refused');
  assert.equal(describePicture('javascript:alert(1)', 'body').kind, 'refused');
  assert.equal(describePicture('   ', 'body').kind, 'refused');
});

test('a picture is matched by its file name, without its folder, query or case', () => {
  assert.equal(describePicture('./images/Cover.PNG', 'body').name, 'Cover.PNG');
  assert.equal(describePicture('https://x.com/a/b%20c.jpg?w=10#top', 'body').name, 'b c.jpg');
  assert.equal(describePicture('data:image/png;base64,AAAA', 'body').name, '');
  assert.equal(pictureLabel(describePicture('./images/Cover.PNG', 'body')), 'Cover.PNG');
  assert.equal(pictureLabel(describePicture('data:image/png;base64,AAAA', 'body')), 'data:image/png;base64,AAAA');
});

test('a cover from another site needs a file, because a cover lives in the library', () => {
  assert.equal(needsFile(describePicture('https://x.com/a.png', 'body')), false);
  assert.equal(needsFile(describePicture('https://x.com/a.png', 'cover')), true);
  assert.equal(needsFile(describePicture('a.png', 'body')), true);
  assert.equal(needsFile(describePicture('data:image/png;base64,AA', 'body')), false);
});

test('one dropped file fills every picture with its name, and a file with no picture is ignored', () => {
  const pictures = [
    describePicture('./a/one.png', 'body'),
    describePicture('../b/ONE.png', 'body'),
    describePicture('https://x.com/two.jpg', 'body'),
    describePicture('data:image/png;base64,AA', 'body'),
  ];
  const one = { name: 'one.png' };
  const two = { name: 'Two.JPG' };
  const matched = matchFiles(pictures, [one, two, { name: 'unused.gif' }]);
  assert.equal(matched.get('./a/one.png'), one);
  assert.equal(matched.get('../b/ONE.png'), one);
  assert.equal(matched.get('https://x.com/two.jpg'), two);
  assert.equal(matched.size, 3);
  // A second drop keeps the first matches and replaces only what it names again.
  const again = { name: 'one.png' };
  const next = matchFiles(pictures, [again], matched);
  assert.equal(next.get('./a/one.png'), again);
  assert.equal(next.get('https://x.com/two.jpg'), two);
});
