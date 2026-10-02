import { readFile } from 'node:fs/promises';

import { parseManagedDiagnosticSecrets } from '../../updater/process.js';
import { composePrefix } from '../../updater/transaction.js';
import type { LogService } from '../args.js';
import type { CliContext } from '../main.js';
import { redactLine } from '../output.js';

/** The app's, a service's or the updater's logs, with every secret in the server's environment hidden. */
export async function logs(context: CliContext, options: { service: LogService; lines: number; follow: boolean }): Promise<number> {
  let secrets: string[];
  try {
    // The same secrets the updater hides from its own journal: every *PASSWORD, *TOKEN, *SECRET, *KEY…
    secrets = parseManagedDiagnosticSecrets(await readFile(context.config.environmentFile, 'utf8'), {});
  } catch {
    context.warn(`${context.config.environmentFile} could not be read, so secrets could not be hidden from the logs. Nothing is shown.`);
    return 1;
  }
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
