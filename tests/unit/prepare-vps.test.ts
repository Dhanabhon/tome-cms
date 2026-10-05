import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = 'scripts/prepare-vps.sh';
const cms = 'https://cms.example.com';
const media = 'https://media.example.com';

// Only PATH, so the addresses in the developer's own environment cannot leak in.
function prepare(args: string[], env: Record<string, string> = {}) {
  return spawnSync('/bin/bash', [script, ...args], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 10_000 });
}

function refused(args: string[], message: RegExp, env: Record<string, string> = {}) {
  const result = prepare(args, env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, message);
}

const expected = `# Managed by TomeCMS prepare-vps.sh
# scripts/prepare-vps.sh wrote this file and rewrites it each time it runs.
# To keep changes of your own, run the script with --no-proxy.

cms.example.com {
\treverse_proxy 127.0.0.1:4321
}

media.example.com {
\trequest_body {
\t\tmax_size 25MB
\t}
\t# Storage honours these on any request, so a link could hand a file over inline or as a
\t# web page. TomeCMS never sends them; its uploads are signed without them.
\turi query {
\t\t-response-content-type
\t\t-response-content-disposition
\t\t-response-content-encoding
\t\t-response-content-language
\t\t-response-cache-control
\t\t-response-expires
\t}
\theader X-Content-Type-Options nosniff
\t# A logo or icon opened at its own address is a document, and nothing in it may run.
\t@svg path *.svg
\theader @svg Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'; sandbox"
\treverse_proxy 127.0.0.1:9000
}
`;

test('--help lists every option', () => {
  const result = prepare(['--help']);
  assert.equal(result.status, 0);
  for (const option of ['--cms-url', '--media-url', '--user', '--create-user', '--no-firewall', '--no-proxy', '--swap-size', '--dry-run', '--print-caddyfile']) {
    assert.match(result.stdout, new RegExp(option));
  }
});

test('the Caddyfile forwards each origin to its port', () => {
  const result = prepare(['--print-caddyfile', '--cms-url', cms, '--media-url', media]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

test('an address may end in a slash and use capitals', () => {
  const result = prepare(['--print-caddyfile', '--cms-url', 'https://CMS.Example.com/', '--media-url', `${media}/`]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

test('the addresses fall back to the deploy helper variables', () => {
  const result = prepare(['--print-caddyfile'], { TOME_CMS_PUBLIC_URL: cms, S3_ENDPOINT: media });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

test('an address that is not a public HTTPS origin is refused', () => {
  refused(['--print-caddyfile', '--media-url', media], /Give the CMS address with --cms-url/);
  refused(['--print-caddyfile', '--cms-url', 'http://cms.example.com', '--media-url', media], /must start with https:\/\//);
  refused(['--print-caddyfile', '--cms-url', `${cms}/blog`, '--media-url', media], /no path/);
  refused(['--print-caddyfile', '--cms-url', 'https://cms.example.com:8443', '--media-url', media], /must not name a port/);
  refused(['--print-caddyfile', '--cms-url', 'https://me:secret@cms.example.com', '--media-url', media], /user name or password/);
  refused(['--print-caddyfile', '--cms-url', 'https://203.0.113.7', '--media-url', media], /not an IP address/);
  refused(['--print-caddyfile', '--cms-url', 'https://localhost', '--media-url', media], /public host name/);
  refused(['--print-caddyfile', '--cms-url', 'https://cms.localhost', '--media-url', media], /public host name/);
  refused(['--print-caddyfile', '--cms-url', cms, '--media-url', 'https://media example.com'], /public host name/);
});

test('the CMS and the media need two host names', () => {
  refused(['--print-caddyfile', '--cms-url', cms, '--media-url', `${cms}/`], /two different host names/);
});

test('options are checked before anything else', () => {
  refused(['--frobnicate'], /Unknown option '--frobnicate'/);
  refused(['--cms-url'], /--cms-url needs a value/);
  refused(['--user', '--dry-run'], /--user needs a value/);
  refused(['--swap-size', 'lots', '--print-caddyfile', '--cms-url', cms, '--media-url', media], /--swap-size takes a size such as 2G/);
});

test('run by root with no account named, nothing about an account stops it', () => {
  // The managed install runs as root, so an account for the docker group is optional. The
  // server checks fail on a Mac, but every problem is listed, so an account one would show.
  const result = prepare(['--dry-run', '--cms-url', cms, '--media-url', media]);
  assert.doesNotMatch(result.stderr, /account|--user/);
});

test('--user root is still refused, with the options that fix it', () => {
  refused(['--dry-run', '--cms-url', cms, '--media-url', media], /--create-user --user tomecms/, { SUDO_USER: 'root' });
});

test('without the proxy, no address is needed', () => {
  // --no-proxy skips the address checks, so this fails later, at the server checks, and
  // never with a message about an address. On a Mac those checks refuse the system.
  const result = prepare(['--no-proxy', '--dry-run', '--user', 'nobody']);
  assert.doesNotMatch(result.stderr, /address/);
});
