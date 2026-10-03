import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { applyEdits, planRegistration } from './anchors.js';
import { kindDirectory, validateId, type Kind } from './ids.js';

/** Where a builder command says what it did. */
export interface BuildOutput {
  print: (line: string) => void;
  warn: (line: string) => void;
}

/**
 * Makes a new theme or plugin, in the order that leaves nothing half made: check the id, check
 * the anchors in the lists, write the directory, then register it. When registering fails the
 * directory is removed again. A dry run stops after the checks and says what it would do.
 * `apply` is the registering, which tests make fail.
 */
export function create(root: string, kind: Kind, id: string, input: {
  dryRun: boolean;
  /** The new directory's files, by path inside it. Read only once the id is known to be free. */
  files: () => ReadonlyArray<{ path: string; text: string }>;
  next: readonly string[];
  output: BuildOutput;
  apply?: typeof applyEdits;
}): number {
  const { output } = input;
  const valid = validateId(kind, id, root);
  if (!valid.ok) {
    output.warn(valid.reason);
    return 1;
  }
  const plan = planRegistration(kind, id, root);
  if (!plan.ok) {
    for (const line of plan.manualLines) output.warn(line);
    return 1;
  }
  const directory = `${kindDirectory(kind)}/${id}`;
  const files = input.files();
  if (input.dryRun) {
    output.print('Would create:');
    for (const { path } of files) output.print(`  ${directory}/${path}`);
    for (const edit of plan.edits) {
      output.print(`Would add to ${relative(root, edit.path)}:`);
      for (const line of edit.lines) output.print(`  ${line}`);
    }
    output.print('Nothing was written.');
    return 0;
  }
  try {
    // Not recursive: a directory that appeared since the check is not written into.
    mkdirSync(join(root, directory));
  } catch (error) {
    output.warn(`Could not create ${directory}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  try {
    for (const { path, text } of files) {
      mkdirSync(dirname(join(root, directory, path)), { recursive: true });
      writeFileSync(join(root, directory, path), text, { flag: 'wx' });
    }
    (input.apply ?? applyEdits)(plan.edits);
  } catch (error) {
    rmSync(join(root, directory), { recursive: true, force: true });
    output.warn(`Nothing was added, and ${directory} was removed again: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  output.print(`Created ${directory} and added it to ${plan.edits.map((edit) => relative(root, edit.path)).join(' and ')}.`);
  output.print('Next:');
  for (const line of input.next) output.print(`  ${line}`);
  return 0;
}
