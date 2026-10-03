// `tome`: short commands for looking after a managed TomeCMS server. Installed as /usr/local/bin/tome,
// it runs as root, reads every path from the updater's configuration, and changes the server only
// through the updater's socket. Exit codes: 0 success, 1 failure or refusal, 2 wrong usage.
// Its builder commands (theme, plugin, check) are the other group: they work in a TomeCMS source
// checkout, through `npm run tome`, need no root, and never read the updater's configuration.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { fetchLatestRelease, fetchTaggedRelease } from '../server/update/releases.js';
import type { UpdateManifest } from '../update/contracts.js';
import { parseUpdaterConfig, type UpdaterConfig } from '../updater/config.js';
import { runCommand } from '../updater/process.js';
import { isBuildCommand, parseBuildCommand, parseCommand, UsageError } from './args.js';
import { findCheckout } from './build/checkout.js';
import { backup } from './commands/backup.js';
import { check } from './commands/check.js';
import { logs } from './commands/logs.js';
import { pluginNew } from './commands/plugin-new.js';
import { prune } from './commands/prune.js';
import { restore } from './commands/restore.js';
import { status } from './commands/status.js';
import { themeNew } from './commands/theme-new.js';
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
  /** Where to look for a source checkout, for the builder commands; the working directory by default. */
  cwd?: string;
  /** The real path of the running tome's own entry file. The builder commands run only from the checkout's src/cli/main.ts. */
  self?: string;
}): Promise<number> {
  if (isBuildCommand(argv[0])) return build(argv, { ...input, cwd: input.cwd ?? process.cwd() });
  // The overview names both groups, so reading it needs no root.
  const isOverview = argv[0] === '--help' || argv[0] === '-h';
  if (input.uid !== 0 && !isOverview) {
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
      case 'restore': return await restore(context, command);
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

/**
 * The builder commands. Outside a checkout, or run by any tome but that checkout's own source, they
 * refuse before writing anything. The server's installed tome is compiled JavaScript under the
 * updater's directory, so it refuses even in the release clone at /opt/tome-cms-src.
 */
async function build(argv: readonly string[], input: { cwd: string; self?: string; print: (line: string) => void; warn: (line: string) => void }): Promise<number> {
  let command;
  try {
    command = parseBuildCommand(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    input.warn(`${error.message}\n\n${error.usage}`);
    return 2;
  }
  if (command.name === 'help') {
    input.print(command.text);
    return 0;
  }
  const root = findCheckout(input.cwd);
  if (root === null || input.self !== join(realpathSync(root), 'src', 'cli', 'main.ts')) {
    input.warn('Run this in a TomeCMS source checkout.');
    return 1;
  }
  try {
    switch (command.name) {
      case 'theme new': return themeNew(root, command, input);
      case 'plugin new': return pluginNew(root, command, input);
      case 'check': return await check(root, input);
    }
  } catch (error) {
    input.warn(`tome stopped: ${error instanceof Error ? error.message : String(error)}`);
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

const streams = new Set<ChildProcess>();

export function streamCommand(executable: string, args: readonly string[], onLine: (line: string, stream: 'stdout' | 'stderr') => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    streams.add(child);
    createInterface({ input: child.stdout }).on('line', (line) => onLine(line, 'stdout'));
    createInterface({ input: child.stderr }).on('line', (line) => onLine(line, 'stderr'));
    child.once('error', (error) => { streams.delete(child); reject(error); });
    child.once('close', (code) => { streams.delete(child); resolve(code ?? 1); });
  });
}

/** Stops every command still streaming: `logs -f` would otherwise outlive a tome whose reader has gone. */
export function stopStreams(): void {
  for (const child of streams) child.kill();
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
  for (const stream of [process.stdout, process.stderr]) exitQuietlyOnClosedPipe(stream, (code) => {
    stopStreams();
    process.exit(code);
  });
  process.exitCode = await tome(process.argv.slice(2), {
    uid: process.getuid?.() ?? -1,
    load: loadContext,
    print: (line) => { process.stdout.write(`${line}\n`); },
    warn: (line) => { process.stderr.write(`${line}\n`); },
    // Under `npm run tome` this is the checkout's src/cli/main.ts, run through tsx.
    self: realpathSync(process.argv[1]),
  });
}
