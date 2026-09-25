import assert from 'node:assert/strict';
import test from 'node:test';

import { lookUpVideo } from '../../src/server/video/lookup';

const clip = { provider: 'youtube' as const, start: null, videoId: 'dQw4w9WgXcQ' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const POSTER = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';

type Call = { url: string; redirect?: RequestRedirect };

function fake(answers: Record<string, () => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ redirect: init?.redirect, url });
    const answer = Object.entries(answers).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!answer) throw new TypeError('fetch failed');
    return answer();
  }) as typeof fetch;
  return { calls, fetcher };
}

test('a public clip gives its title and its poster, from the two hosts and no others', async () => {
  const { calls, fetcher } = fake({
    'https://www.youtube.com/oembed': () => Response.json({ thumbnail_url: POSTER, title: '  A clip worth watching  ' }),
    [POSTER]: () => new Response(JPEG),
  });
  const found = await lookUpVideo(clip, fetcher);
  assert.deepEqual({ ...found, poster: found.poster?.length }, { poster: JPEG.length, reason: null, title: 'A clip worth watching' });
  assert.deepEqual(calls.map(({ url }) => new URL(url).hostname), ['www.youtube.com', 'i.ytimg.com']);
  assert.ok(calls.every(({ redirect }) => redirect === 'error'), 'no request follows a redirect');
});

test('a poster on any other host is never fetched', async () => {
  const { calls, fetcher } = fake({
    'https://www.youtube.com/oembed': () => Response.json({ thumbnail_url: 'https://evil.example/x.jpg', title: 'A clip' }),
  });
  assert.deepEqual(await lookUpVideo(clip, fetcher), { poster: null, reason: 'unavailable', title: 'A clip' });
  assert.equal(calls.length, 1);
});

test('a private clip is unavailable, and a provider that does not answer is unreachable', async () => {
  const refused = fake({ 'https://www.youtube.com/oembed': () => new Response('Unauthorized', { status: 401 }) });
  assert.deepEqual(await lookUpVideo(clip, refused.fetcher), { poster: null, reason: 'unavailable', title: '' });
  const silent = fake({});
  assert.deepEqual(await lookUpVideo(clip, silent.fetcher), { poster: null, reason: 'unreachable', title: '' });
});

test('a lookup that runs past its deadline is unreachable', async () => {
  const { fetcher } = fake({
    'https://www.youtube.com/oembed': () => new Promise<Response>(() => undefined),
  });
  const slow = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const hanging = fetcher(input, init);
    return Promise.race([hanging, new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError'))))]);
  }) as typeof fetch;
  assert.deepEqual(await lookUpVideo(clip, slow, 50), { poster: null, reason: 'unreachable', title: '' });
});

test('an answer over 2 MB, said or streamed, is not read to its end', async () => {
  const big = Buffer.alloc(2 * 1024 * 1024 + 1);
  const said = fake({
    'https://www.youtube.com/oembed': () => Response.json({ thumbnail_url: POSTER, title: 'A clip' }),
    [POSTER]: () => new Response(big, { headers: { 'content-length': String(big.length) } }),
  });
  assert.deepEqual(await lookUpVideo(clip, said.fetcher), { poster: null, reason: 'unavailable', title: 'A clip' });
  const streamed = fake({
    'https://www.youtube.com/oembed': () => Response.json({ thumbnail_url: POSTER, title: 'A clip' }),
    [POSTER]: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(big); controller.close(); } })),
  });
  assert.deepEqual(await lookUpVideo(clip, streamed.fetcher), { poster: null, reason: 'unavailable', title: 'A clip' });
});

test('a poster that is not a picture is not kept', async () => {
  const { fetcher } = fake({
    'https://www.youtube.com/oembed': () => Response.json({ thumbnail_url: POSTER, title: 'A clip' }),
    [POSTER]: () => new Response('<html>not a picture</html>'),
  });
  assert.deepEqual(await lookUpVideo(clip, fetcher), { poster: null, reason: 'unavailable', title: 'A clip' });
});

test('Vimeo is asked at its own oEmbed address, and its posters come from its own host', async () => {
  const vimeoPoster = 'https://i.vimeocdn.com/video/452001751-640.jpg';
  const { calls, fetcher } = fake({
    'https://vimeo.com/api/oembed.json': () => Response.json({ thumbnail_url: vimeoPoster, title: 'Vimeo clip' }),
    [vimeoPoster]: () => new Response(JPEG),
  });
  const found = await lookUpVideo({ provider: 'vimeo', start: null, videoId: '76979871' }, fetcher);
  assert.equal(found.title, 'Vimeo clip');
  assert.equal(found.reason, null);
  assert.deepEqual(calls.map(({ url }) => new URL(url).hostname), ['vimeo.com', 'i.vimeocdn.com']);
});
