import { parentPort, workerData } from 'node:worker_threads';

import { ValidationError } from './editor';
import { MarkdownTooComplexError, parseMarkdownPost, type ParseReply } from './markdown-import';

/**
 * The other side of `readMarkdownPost`: reads one file in a thread of its own, so a file that
 * takes too long can be stopped by ending the thread. It is bundled to `dist/server` by
 * `scripts/build-markdown-worker.mjs`, since a worker needs a file of its own that Node can run.
 */
function read(): ParseReply {
  const { text, fileName } = workerData as { text: string; fileName: string };
  try {
    return { kind: 'parsed', post: parseMarkdownPost(text, fileName) };
  } catch (error) {
    if (error instanceof MarkdownTooComplexError) return { kind: 'too-complex', limit: error.limit };
    if (error instanceof ValidationError) return { kind: 'invalid', message: error.message };
    throw error;
  }
}

parentPort?.postMessage(read());
