import { parseArgs, type ParseArgsConfig } from 'node:util';

import { parseStableVersion } from '../update/contracts.js';

export type LogService = 'app' | 'postgres' | 'seaweedfs' | 'updater';

export type Command =
  | { name: 'help'; text: string }
  | { name: 'status'; json: boolean }
  | { name: 'logs'; service: LogService; lines: number; follow: boolean }
  | { name: 'backup'; full: boolean; yes: boolean }
  | { name: 'update'; version: string | null; yes: boolean }
  | { name: 'prune'; yes: boolean }
  | { name: 'restore'; directory: string; yes: boolean };

export type ThemeSource = 'plain' | 'paper' | 'almanac';
/** The hooks a new plugin can fill: every one the core declares but mcp, which only the core serves. */
export type PluginHook = 'publicPage' | 'signIn' | 'editorSuggestions';

/** The commands that build themes and plugins in a source checkout. They need no root. */
export type BuildCommand =
  | { name: 'help'; text: string }
  | { name: 'theme new'; id: string; from: ThemeSource; dryRun: boolean }
  | { name: 'plugin new'; id: string; hook: PluginHook; client: boolean; dryRun: boolean }
  | { name: 'check' };

/** Wrong usage: exit 2, with the usage of the command that was meant. */
export class UsageError extends Error {
  constructor(message: string, readonly usage: string) {
    super(message);
  }
}

const overview = `Usage: sudo tome <command> [options]

Looks after this TomeCMS server. These commands run as root:
  status            The versions, the site, the containers, free disk and the newest backup.
  logs [service]    Recent logs of app (the default), postgres, seaweedfs or updater.
  backup            Back up the database, or everything with --full.
  update [version]  Install the newest release, or the version named.
  prune             List the old application images that can go; --yes removes them.
  restore <backup>  Put a backup back into this site, replacing everything on it.

These build themes and plugins in a TomeCMS source checkout, not on a server, and need no root.
Run them there with "npm run tome -- <command>":
  theme new <id>    Start a new theme from an existing one.
  plugin new <id>   Start a new plugin.
  check             Check every theme and plugin.

Run "sudo tome <command> --help", or "npm run tome -- <command> --help", for a command's options.
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
  restore: `Usage: sudo tome restore <backup> [--yes]

Puts a backup back into this site: its database, and its media unless it holds the database only.
Everything on the site is replaced. The backup is a directory under /var/backups/tome-cms, one that
tome backup made or one copied in from another server, made for this site's address. The updater
takes a safety backup first, and puts it back if the restore fails.

Options:
  -y, --yes   Do not ask first.`,
} as const;

const buildUsages = {
  theme: `Usage: npm run tome -- theme new <id> [--from plain|paper|almanac] [--dry-run]

Starts a new theme: copies src/themes/<from> to src/themes/<id>, renames it, and adds it to the
theme lists. It runs in a TomeCMS source checkout, not on a server. An id is 2 to 31 lowercase
letters and digits, starting with a letter.

Options:
  --from THEME   The theme to start from: plain (the default), paper or almanac.
  --dry-run      Print the files and lines it would add, and write nothing.`,
  plugin: `Usage: npm run tome -- plugin new <id> --hook publicPage|signIn|editorSuggestions [--client] [--dry-run]

Starts a new plugin: writes src/plugins/<id>, which does nothing until its code is written, and
adds it to the plugin lists. It starts switched off. It runs in a TomeCMS source checkout, not on
a server. An id is 2 to 31 lowercase letters and digits, starting with a letter.

Options:
  --hook HOOK   Where it acts: publicPage (every page a reader sees), signIn (the admin's
                sign-in) or editorSuggestions (suggestions in the editor).
  --client      Also write client.ts, code that runs in the reader's browser.
  --dry-run     Print the files and lines it would add, and write nothing.`,
  check: `Usage: npm run tome -- check

Checks every theme and plugin in this TomeCMS source checkout, and prints each problem as
path:line: what is wrong. It changes nothing.`,
} as const;

type Name = keyof typeof usages;
type BuildGroup = keyof typeof buildUsages;
const help = { help: { type: 'boolean', short: 'h' } } as const;
const yes = { yes: { type: 'boolean', short: 'y' } } as const;
const options = {
  status: { ...help, json: { type: 'boolean' } },
  logs: { ...help, lines: { type: 'string', short: 'n' }, follow: { type: 'boolean', short: 'f' } },
  backup: { ...help, ...yes, full: { type: 'boolean' } },
  update: { ...help, ...yes },
  prune: { ...help, ...yes },
  restore: { ...help, ...yes },
} satisfies Record<Name, ParseArgsConfig['options']>;
const services: readonly LogService[] = ['app', 'postgres', 'seaweedfs', 'updater'];
const dryRun = { 'dry-run': { type: 'boolean' } } as const;
const buildOptions = {
  theme: { ...help, ...dryRun, from: { type: 'string' } },
  plugin: { ...help, ...dryRun, hook: { type: 'string' }, client: { type: 'boolean' } },
  check: { ...help },
} satisfies Record<BuildGroup, ParseArgsConfig['options']>;
const themeSources: readonly ThemeSource[] = ['plain', 'paper', 'almanac'];
const pluginHooks: readonly PluginHook[] = ['publicPage', 'signIn', 'editorSuggestions'];

function parse(args: readonly string[], options: ParseArgsConfig['options'], usage: string) {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true, strict: true }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'Wrong usage.', usage);
  }
}

export function parseCommand(argv: readonly string[]): Command {
  const [name, ...rest] = argv;
  if (name === '--help' || name === '-h') return { name: 'help', text: overview };
  if (!name || !Object.hasOwn(usages, name)) {
    throw new UsageError(name ? `Unknown command: ${name}` : 'Name a command.', overview);
  }
  const command = name as Name;
  const usage = usages[command];
  const { values, positionals } = parse(rest, options[command], usage);
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
  if (command === 'restore') {
    if (!positionals[0]) throw wrong('Name the backup directory to restore.');
    if (positionals.length > 1) throw wrong('Name one backup directory.');
    return { name: 'restore', directory: positionals[0], yes: values.yes === true };
  }
  if (positionals.length) throw wrong(`Unexpected argument: ${positionals[0]}`);
  if (command === 'status') return { name: 'status', json: values.json === true };
  if (command === 'backup') return { name: 'backup', full: values.full === true, yes: values.yes === true };
  return { name: 'prune', yes: values.yes === true };
}

/** Whether `name` is one of the builder commands, which run in a source checkout without root. */
export function isBuildCommand(name: string | undefined): name is BuildGroup {
  return name !== undefined && Object.hasOwn(buildUsages, name);
}

/** A builder command, from argv whose first word `isBuildCommand` accepts. */
export function parseBuildCommand(argv: readonly string[]): BuildCommand {
  const [group, ...rest] = argv as [BuildGroup, ...string[]];
  const usage = buildUsages[group];
  const { values, positionals } = parse(rest, buildOptions[group], usage);
  if (values.help) return { name: 'help', text: usage };
  const wrong = (message: string) => new UsageError(message, usage);

  if (group === 'check') {
    if (positionals.length) throw wrong(`Unexpected argument: ${positionals[0]}`);
    return { name: 'check' };
  }
  const [verb, id, ...extra] = positionals;
  if (verb !== 'new') throw wrong(verb ? `Unknown ${group} command: ${verb}` : `Say what to do: ${group} new <id>.`);
  if (!id) throw wrong(`Name the new ${group}'s id.`);
  if (extra.length) throw wrong(`Unexpected argument: ${extra[0]}`);
  const isDryRun = values['dry-run'] === true;
  if (group === 'theme') {
    const from = String(values.from ?? 'plain');
    if (!(themeSources as readonly string[]).includes(from)) throw wrong(`--from takes plain, paper or almanac, not ${from}.`);
    return { name: 'theme new', id, from: from as ThemeSource, dryRun: isDryRun };
  }
  if (values.hook === undefined) throw wrong('Name the hook with --hook.');
  const hook = String(values.hook);
  if (!(pluginHooks as readonly string[]).includes(hook)) throw wrong(`--hook takes publicPage, signIn or editorSuggestions, not ${hook}.`);
  return { name: 'plugin new', id, hook: hook as PluginHook, client: values.client === true, dryRun: isDryRun };
}
