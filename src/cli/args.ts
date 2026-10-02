import { parseArgs, type ParseArgsConfig } from 'node:util';

import { parseStableVersion } from '../update/contracts.js';

export type LogService = 'app' | 'postgres' | 'seaweedfs' | 'updater';

export type Command =
  | { name: 'help'; text: string }
  | { name: 'status'; json: boolean }
  | { name: 'logs'; service: LogService; lines: number; follow: boolean }
  | { name: 'backup'; full: boolean; yes: boolean }
  | { name: 'update'; version: string | null; yes: boolean }
  | { name: 'prune'; yes: boolean };

/** Wrong usage: exit 2, with the usage of the command that was meant. */
export class UsageError extends Error {
  constructor(message: string, readonly usage: string) {
    super(message);
  }
}

const overview = `Usage: sudo tome <command> [options]

Looks after this TomeCMS server. Every command runs as root.

Commands:
  status            The versions, the site, the containers, free disk and the newest backup.
  logs [service]    Recent logs of app (the default), postgres, seaweedfs or updater.
  backup            Back up the database, or everything with --full.
  update [version]  Install the newest release, or the version named.
  prune             List the old application images that can go; --yes removes them.

Run "sudo tome <command> --help" for a command's options.
Exit codes: 0 success, 1 failure or refusal, 2 wrong usage.`;

const usages = {
  status: `Usage: sudo tome status [--json]

The versions, whether the site is ready, the containers, free disk where backups go, the last
update and the newest backup. It changes nothing.

Options:
  --json      Print it as one JSON object, for scripts.`,
  logs: `Usage: sudo tome logs [app|postgres|seaweedfs|updater] [-n N] [-f]

Recent logs of a service; app when none is named. Secrets are hidden.

Options:
  -n, --lines N   How many lines (default 100).
  -f, --follow    Keep showing new lines until Ctrl+C.`,
  backup: `Usage: sudo tome backup [--full] [--yes]

Asks the updater for a backup. The site is in maintenance while it runs, and is always started
again afterwards.

Options:
  --full      Back up the media too, not only the database.
  -y, --yes   Do not ask first.`,
  update: `Usage: sudo tome update [version] [--yes]

Installs the newest stable release, or the version named, the way System does: the updater checks
the release, backs up, and rolls back if the new version does not come up.

Options:
  -y, --yes   Do not ask first.`,
  prune: `Usage: sudo tome prune [--yes]

A dry run by default: it lists the old, untagged application images that can go, with their sizes.
The installed image and the one before it are always kept.

Options:
  -y, --yes   Remove them.`,
} as const;

type Name = keyof typeof usages;
const help = { help: { type: 'boolean', short: 'h' } } as const;
const yes = { yes: { type: 'boolean', short: 'y' } } as const;
const options = {
  status: { ...help, json: { type: 'boolean' } },
  logs: { ...help, lines: { type: 'string', short: 'n' }, follow: { type: 'boolean', short: 'f' } },
  backup: { ...help, ...yes, full: { type: 'boolean' } },
  update: { ...help, ...yes },
  prune: { ...help, ...yes },
} satisfies Record<Name, ParseArgsConfig['options']>;
const services: readonly LogService[] = ['app', 'postgres', 'seaweedfs', 'updater'];

export function parseCommand(argv: readonly string[]): Command {
  const [name, ...rest] = argv;
  if (name === '--help' || name === '-h') return { name: 'help', text: overview };
  if (!name || !Object.hasOwn(usages, name)) {
    throw new UsageError(name ? `Unknown command: ${name}` : 'Name a command.', overview);
  }
  const command = name as Name;
  const usage = usages[command];
  let parsed;
  try {
    parsed = parseArgs({ args: [...rest], options: options[command], allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'Wrong usage.', usage);
  }
  const { values, positionals } = parsed as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  if (values.help) return { name: 'help', text: usage };
  const wrong = (message: string) => new UsageError(message, usage);

  if (command === 'logs') {
    if (positionals.length > 1) throw wrong('Name one service.');
    const service = positionals[0] ?? 'app';
    if (!(services as readonly string[]).includes(service)) throw wrong(`Unknown service: ${service}`);
    const lines = String(values.lines ?? '100');
    if (!/^[1-9]\d{0,5}$/.test(lines)) throw wrong('-n takes a whole number of lines, from 1.');
    return { name: 'logs', service: service as LogService, lines: Number(lines), follow: values.follow === true };
  }
  if (command === 'update') {
    if (positionals.length > 1) throw wrong('Name one version.');
    const version = positionals[0] ?? null;
    if (version !== null) {
      try { parseStableVersion(version); } catch { throw wrong(`Not a release version: ${version}. Name one such as 1.11.0.`); }
    }
    return { name: 'update', version, yes: values.yes === true };
  }
  if (positionals.length) throw wrong(`Unexpected argument: ${positionals[0]}`);
  if (command === 'status') return { name: 'status', json: values.json === true };
  if (command === 'backup') return { name: 'backup', full: values.full === true, yes: values.yes === true };
  return { name: 'prune', yes: values.yes === true };
}
