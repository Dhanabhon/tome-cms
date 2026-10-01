import assert from 'node:assert/strict';
import test from 'node:test';

import { beat, itemKey, lastTouch, ownerIsEditing, recordTouch, resetPresenceForTest } from '../../src/server/mcp/presence';

const key = itemKey('post', '11111111-1111-4111-8111-111111111111');
const touch = { connectionId: 'c1', clientName: 'Claude', brand: 'claude' as const, action: 'read' as const };

test('an AI touch is shown for three minutes, then forgotten', () => {
  resetPresenceForTest();
  recordTouch(key, touch, 1_000_000);
  assert.equal(lastTouch(key, 1_000_000 + 180_000)?.clientName, 'Claude');
  assert.equal(lastTouch(key, 1_000_000 + 180_001), null);
});

test('the owner holds a draft for 45 seconds after the last beat, from any tab', () => {
  resetPresenceForTest();
  beat(key, 0);
  assert.equal(ownerIsEditing(key, 44_999), true);
  beat(key, 30_000); // a second tab
  assert.equal(ownerIsEditing(key, 74_999), true);
  assert.equal(ownerIsEditing(key, 75_000), false);
  assert.equal(ownerIsEditing(itemKey('page', 'x'), 0), false);
});

test('each store keeps at most 500 items, dropping the oldest', () => {
  resetPresenceForTest();
  for (let i = 0; i < 501; i += 1) beat(itemKey('post', String(i)), 0);
  assert.equal(ownerIsEditing(itemKey('post', '0'), 1), false);
  assert.equal(ownerIsEditing(itemKey('post', '500'), 1), true);
});

test('an item key is the same whatever the case of its id', () => {
  resetPresenceForTest();
  assert.equal(itemKey('post', 'ABCDEF01-1111-4111-8111-111111111111'), itemKey('post', 'abcdef01-1111-4111-8111-111111111111'));
  beat(itemKey('post', 'abcdef01-1111-4111-8111-111111111111'), 0);
  assert.equal(ownerIsEditing(itemKey('post', 'ABCDEF01-1111-4111-8111-111111111111'), 1), true);
});

test('the touch store keeps at most 500 items, dropping the oldest', () => {
  resetPresenceForTest();
  for (let i = 0; i < 501; i += 1) recordTouch(itemKey('post', String(i)), touch, 0);
  assert.equal(lastTouch(itemKey('post', '0'), 1), null);
  assert.equal(lastTouch(itemKey('post', '500'), 1)?.clientName, 'Claude');
});
