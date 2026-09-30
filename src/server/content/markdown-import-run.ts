import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

import { ValidationError } from './editor';
import { MarkdownTooComplexError, parseMarkdownPost, type ParsedMarkdownPost, type ParseReply } from './markdown-import';

/**
 * Reading a Markdown file, with a limit on the time it may take. The limits in markdown-import.ts
 * bound the shapes of file known to be slow, but the lexer is slower than linear in ways that
 * keep turning up, and the server is one process: a file that takes minutes stops the public site
 * as well. So the file is read in a worker thread that is ended at the limit, whatever the file
 * is, and one file is read at a time.
 */
export const PARSE_TIME_LIMIT_MS = 5_000;
/** The worker's heap, well under the server's memory; a file that needs more is too much. */
const PARSE_HEAP_MB = 256;

/** A second file arrived while one was being read. Not queued: the server is small. */
export class MarkdownBusyError extends Error {
  override name = 'MarkdownBusyError';

  constructor() {
    super('Another Markdown file is being read. Try again in a moment.');
  }
}

let reading = false;

// Test hooks, read only under test: the built server is tried with a time limit short enough for a
// file that is only slow on this machine, and with a heap small enough to run out. A value outside
// its range is ignored.
function testHook(name: string, min: number, max: number, fallback: number): number {
  const hook = process.env.NODE_ENV === 'test' ? Number(process.env[name]) : Number.NaN;
  return Number.isInteger(hook) && hook >= min && hook <= max ? hook : fallback;
}

/**
 * The worker's file. In the build it is bundled beside the server (`dist/server`, where the chunks
 * are one folder down); from source (tests run under tsx) it is the source, which the worker
 * loads the way this thread did. `null` is source under the dev server, which loads nothing in a
 * thread: there the file is read here, without a limit.
 */
function workerEntry(): URL | null {
  const here = import.meta.url;
  if (here.endsWith('.ts')) return process.execArgv.some((arg) => arg.includes('tsx')) ? new URL('./markdown-parse-worker.ts', here) : null;
  const built = ['./markdown-parse-worker.mjs', '../markdown-parse-worker.mjs'].map((path) => new URL(path, here)).find((url) => existsSync(url));
  // A build without its worker is a mistake to hear about, not a reason to read without a limit.
  if (!built) throw new Error('The Markdown worker is missing from this build.');
  return built;
}

function parseInWorker(entry: URL, text: string, fileName: string): Promise<ParsedMarkdownPost> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry, {
      workerData: { text, fileName },
      resourceLimits: { maxOldGenerationSizeMb: testHook('TOME_CMS_MARKDOWN_PARSE_HEAP_MB', 1, PARSE_HEAP_MB, PARSE_HEAP_MB) },
    });
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };
    const limit = testHook('TOME_CMS_MARKDOWN_PARSE_LIMIT_MS', 10, 60_000, PARSE_TIME_LIMIT_MS);
    const timer = setTimeout(() => finish(() => reject(new MarkdownTooComplexError('time'))), limit);
    worker.once('message', (reply: ParseReply) => finish(() => {
      if (reply.kind === 'parsed') resolve(reply.post);
      else reject(reply.kind === 'too-complex' ? new MarkdownTooComplexError(reply.limit) : new ValidationError(reply.message));
    }));
    worker.once('error', (error: Error & { code?: string }) => finish(() => {
      reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new MarkdownTooComplexError('size') : error);
    }));
    worker.once('exit', (code) => finish(() => reject(new Error(`The Markdown worker stopped (${code}) without an answer.`))));
  });
}

/**
 * `parseMarkdownPost` in a worker, stopped after `PARSE_TIME_LIMIT_MS` (`MarkdownTooComplexError`,
 * limit `time`; out of memory, limit `size`), and one at a time (`MarkdownBusyError`). Everything
 * else is as that function.
 */
export async function readMarkdownPost(text: string, fileName: string): Promise<ParsedMarkdownPost> {
  if (reading) throw new MarkdownBusyError();
  reading = true;
  try {
    const entry = workerEntry();
    return entry ? await parseInWorker(entry, text, fileName) : parseMarkdownPost(text, fileName);
  } finally {
    reading = false;
  }
}
