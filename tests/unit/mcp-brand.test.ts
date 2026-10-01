import assert from 'node:assert/strict';
import test from 'node:test';

import { clientBrand } from '../../src/server/mcp/brand';
import { isLoopbackHost } from '../../src/server/mcp/redirects';

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

test('a mark needs the exact host, not one that merely ends or starts like it', () => {
  assert.equal(clientBrand('https://CLAUDE.AI/x', '127.0.0.1:1'), 'claude', 'a host is case-insensitive');
  assert.equal(clientBrand('dcr:1', 'CLAUDE.AI'), 'claude');
  assert.equal(clientBrand('https://openai.com/x.json', '127.0.0.1:1'), 'openai');
  // The userinfo is not the host: this document is fetched from claude.ai, as before.
  assert.equal(clientBrand('https://evil.example@claude.ai/x', '127.0.0.1:1'), 'claude');
  for (const host of ['evilclaude.ai', 'claude.ai.evil.example', 'chatgpt.com.evil.example', 'xn--cude-9na.ai', 'sub.claude.ai', 'api.chatgpt.com']) {
    assert.equal(clientBrand(`https://${host}/meta.json`, '127.0.0.1:1'), null, host);
    assert.equal(clientBrand('dcr:1', host), null, host);
  }
});

test('loopback is this computer by any of its names', () => {
  for (const host of ['127.0.0.1:49205', 'localhost:3118', '[::1]:8080', '127.0.0.1', 'LOCALHOST:1']) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ['claude.ai', 'chatgpt.com', '127.0.0.2:1', 'localhost.evil.example']) assert.equal(isLoopbackHost(host), false, host);
});
