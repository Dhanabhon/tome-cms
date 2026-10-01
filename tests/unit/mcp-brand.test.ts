import assert from 'node:assert/strict';
import test from 'node:test';

import { clientBrand, isLoopbackHost } from '../../src/server/mcp/brand';

test('a mark comes from where the approval goes or from the client document host, never from a name', () => {
  assert.equal(clientBrand('https://claude.ai/oauth/mcp-oauth-client-metadata', 'claude.ai'), 'claude');
  assert.equal(clientBrand('dcr:1f0c', 'claude.ai'), 'claude');
  assert.equal(clientBrand('dcr:1f0c', 'chatgpt.com'), 'openai');
  // Codex from the ChatGPT desktop app: loopback redirect, CIMD on chatgpt.com.
  assert.equal(clientBrand('https://chatgpt.com/oauth/codex/client.json', '127.0.0.1:49205'), 'openai');
  assert.equal(clientBrand('https://platform.openai.com/x.json', 'localhost:1'), 'openai');
  assert.equal(clientBrand('https://claude.ai/oauth/claude-code-client-metadata', '127.0.0.1:3118'), 'claude');
  // A self-registered client that only calls itself Claude gets nothing, wherever it sends.
  assert.equal(clientBrand('dcr:9a9a', '127.0.0.1:3118'), null);
  assert.equal(clientBrand('https://claude.ai.evil.example/meta.json', '127.0.0.1:1'), null);
  assert.equal(clientBrand('https://evil.example/claude.ai', 'evil.example'), null);
});

test('loopback is this computer by any of its names', () => {
  for (const host of ['127.0.0.1:49205', 'localhost:3118', '[::1]:8080', '127.0.0.1']) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ['claude.ai', 'chatgpt.com', '127.0.0.2:1', 'localhost.evil.example']) assert.equal(isLoopbackHost(host), false, host);
});
