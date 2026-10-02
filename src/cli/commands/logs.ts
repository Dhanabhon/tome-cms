import { readFile } from 'node:fs/promises';

import { parseManagedDiagnosticSecrets } from '../../updater/process.js';
import { composePrefix } from '../../updater/config.js';
import type { LogService } from '../args.js';
import type { CliContext } from '../main.js';
import { redactionProblem, redactLine } from '../output.js';

/** The app's, a service's or the updater's logs, with every secret in the server's environment hidden. */
export async function logs(context: CliContext, options: { service: LogService; lines: number; follow: boolean }): Promise<number> {
  // The same secrets the updater hides from its own journal: every *PASSWORD, *TOKEN, *SECRET, *KEY…
  // Fail closed, and say why once: logs shown without their secrets hidden are never an option.
  const file = context.config.environmentFile;
  const refuse = (why: string) => {
    context.warn(`${why}, so secrets could not be hidden from the logs. Nothing is shown.`);
    return 1;
  };
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    return refuse(`${file} could not be read`);
  }
  let secrets: string[];
  try {
    secrets = parseManagedDiagnosticSecrets(source, {});
  } catch {
    return refuse(`${file} is not in the managed format (KEY='value' for every secret)`);
  }
  const problem = redactionProblem(secrets);
  if (problem) return refuse(`${file} has ${problem}`);
  const lines = String(options.lines);
  const follow = options.follow ? ['--follow'] : [];
  const [executable, args] = options.service === 'updater'
    ? ['journalctl', ['-u', 'tomecms-updater', '-n', lines, '--no-pager', ...follow]]
    : ['docker', [...composePrefix(context.config), 'logs', '--tail', lines, ...follow, options.service]];
  const code = await context.streamCommand(executable, args, (line, stream) => {
    (stream === 'stdout' ? context.print : context.warn)(redactLine(line, secrets));
  }).catch(() => null);
  if (code === null) context.warn(`Could not run ${executable}.`);
  return code === 0 ? 0 : 1;
}
