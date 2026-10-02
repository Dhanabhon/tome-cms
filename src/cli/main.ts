// `tome`: short commands for looking after a managed TomeCMS server. Installed as /usr/local/bin/tome,
// it runs as root, reads every path from the updater's configuration, and changes the server only
// through the updater's socket. Exit codes: 0 success, 1 failure or refusal, 2 wrong usage.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile, statfs } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { fetchLatestRelease, fetchTaggedRelease } from '../server/update/releases.js';
import type { UpdateManifest } from '../update/contracts.js';
import { parseUpdaterConfig, type UpdaterConfig } from '../updater/config.js';
import { runCommand } from '../updater/process.js';
import { parseCommand, UsageError } from './args.js';
import { backup } from './commands/backup.js';
import { logs } from './commands/logs.js';
import { prune } from './commands/prune.js';
import { status } from './commands/status.js';
import { update } from './commands/update.js';
import { exitQuietlyOnClosedPipe, unixSocketClient, UpdaterUnreachableError, type SocketClient } from './socket.js';

const CONFIG_PATH = '/etc/tome-cms/updater.json';

/** Everything a command touches, so tests can put their own in its place. */
export interface CliContext {
  config: UpdaterConfig;
  socket: SocketClient;
  /** Runs a command to its end and keeps its output (`docker compose ps`). Argv only, never a shell. */
  runCommand: typeof runCommand;
  /** Runs a command and hands over each line of output as it comes (the logs). Its exit code. */
  streamCommand: (executable: string, args: readonly string[], onLine: (line: string, stream: 'stdout' | 'stderr') => void) => Promise<number>;
  fetch: typeof fetch;
  /** The newest stable release (null), or the one named, checked as System checks it. */
  release: (version: string | null) => Promise<{ manifest: Pick<UpdateManifest, 'version' | 'compatibility' | 'releaseNotesUrl'> }>;
  statfs: (path: string) => Promise<{ bsize: number; bavail: number }>;
  /** Asks a y/N question; anything but yes is no. */
  confirm: (question: string) => Promise<boolean>;
  print: (line: string) => void;
  warn: (line: string) => void;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  requestId: () => string;
}

export async function tome(argv: readonly string[], input: {
  uid: number;
  load: () => Promise<CliContext>;
  print: (line: string) => void;
  warn: (line: string) => void;
}): Promise<number> {
  if (input.uid !== 0) {
    input.warn(`tome looks after the server, so it runs as root. Run it with sudo, for example: sudo tome ${argv[0] ?? 'status'}`);
    return 1;
  }
  let command;
  try {
    command = parseCommand(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    input.warn(`${error.message}\n\n${error.usage}`);
    return 2;
  }
  if (command.name === 'help') {
    input.print(command.text);
    return 0;
  }
  let context: CliContext;
  try {
    context = await input.load();
  } catch {
    input.warn(`Could not read the updater's configuration at ${CONFIG_PATH}. tome works on a server set up by the managed installer.`);
    return 1;
  }
  try {
    switch (command.name) {
      case 'status': return await status(context, command);
      case 'logs': return await logs(context, command);
      case 'backup': return await backup(context, command);
      case 'update': return await update(context, command);
      case 'prune': return await prune(context, command);
    }
  } catch (error) {
    if (error instanceof UpdaterUnreachableError) {
      context.warn(`The updater did not answer at ${context.config.socketPath}. Check it with: sudo systemctl status tomecms-updater`);
    } else {
      context.warn(`tome stopped: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }
}

async function loadContext(): Promise<CliContext> {
  const config = parseUpdaterConfig(JSON.parse(await readFile(CONFIG_PATH, 'utf8')));
  return {
    config,
    socket: unixSocketClient(config.socketPath),
    runCommand,
    streamCommand,
    fetch,
    release: (version) => version === null ? fetchLatestRelease() : fetchTaggedRelease(version),
    statfs,
    confirm,
    print: (line) => { process.stdout.write(`${line}\n`); },
    warn: (line) => { process.stderr.write(`${line}\n`); },
    now: () => new Date(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    requestId: randomUUID,
  };
}

function streamCommand(executable: string, args: readonly string[], onLine: (line: string, stream: 'stdout' | 'stderr') => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    createInterface({ input: child.stdout }).on('line', (line) => onLine(line, 'stdout'));
    createInterface({ input: child.stderr }).on('line', (line) => onLine(line, 'stderr'));
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(question);
  const lines = createInterface({ input: process.stdin });
  try {
    const answer = await new Promise<string>((resolve) => {
      lines.once('line', resolve);
      lines.once('close', () => resolve(''));
    });
    return /^\s*y(es)?\s*$/i.test(answer);
  } finally {
    lines.close();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const stream of [process.stdout, process.stderr]) exitQuietlyOnClosedPipe(stream, (code) => process.exit(code));
  process.exitCode = await tome(process.argv.slice(2), {
    uid: process.getuid?.() ?? -1,
    load: loadContext,
    print: (line) => { process.stdout.write(`${line}\n`); },
    warn: (line) => { process.stderr.write(`${line}\n`); },
  });
}
