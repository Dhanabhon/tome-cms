import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  stdoutAtLimit?: boolean;
  stderrAtLimit?: boolean;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
}

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export type CommandExecutable = 'docker' | 'gh';
export type CommandDiagnosticStage =
  | 'preflight.app.list' | 'preflight.app.inspect' | 'download.image'
  | 'verify.migration_inventory' | 'quiesce.stop_app' | 'backup.create'
  | 'migration.apply' | 'restart.start_app' | 'rollback.start_app'
  | 'cleanup.one_shot.list' | 'cleanup.one_shot.remove'
  | 'reconcile.app.list' | 'reconcile.app.inspect'
  | 'verify.docker_engine' | 'verify.compose_cli' | 'verify.gh_cli'
  | 'verify.manifest_attestation' | 'verify.image_attestation' | 'verify.compose_health';

export interface CommandDiagnosticContext {
  jobId: string;
  targetVersion: string;
  secrets: readonly string[] | null;
}

const outputLimit = 32 * 1024;
const diagnosticLimit = 4 * 1024;
const omittedDiagnostic = '{"event":"updater_command_failed","diagnostic":"omitted"}';

export function runCommand(executable: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    child.stdout.on('data', (chunk: Buffer) => {
      const remaining = outputLimit - stdoutBytes;
      if (remaining > 0) {
        stdout.push(chunk.subarray(0, remaining));
        stdoutBytes += Math.min(chunk.length, remaining);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const remaining = outputLimit - stderrBytes;
      if (remaining > 0) {
        stderr.push(chunk.subarray(0, remaining));
        stderrBytes += Math.min(chunk.length, remaining);
      }
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, options.timeoutMs);

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        code: timedOut ? 124 : code ?? 1,
        stdout: boundedText(stdout, stdoutBytes),
        stderr: boundedText(stderr, stderrBytes),
        stdoutAtLimit: stdoutBytes === outputLimit,
        stderrAtLimit: stderrBytes === outputLimit,
        signal,
        timedOut,
      });
    });
  });
}

export async function runCheckedCommand(
  runner: typeof runCommand,
  executable: CommandExecutable,
  args: readonly string[],
  options: CommandOptions,
  diagnostics: CommandDiagnosticContext | undefined,
  stage: CommandDiagnosticStage,
  failureMessage: string,
): Promise<CommandResult> {
  let result: CommandResult;
  try {
    result = await runner(executable, args, options);
  } catch {
    if (diagnostics) writeCommandFailure(diagnostics, executable, stage, null);
    throw new Error(failureMessage);
  }
  if (result.code !== 0) {
    if (diagnostics) writeCommandFailure(diagnostics, executable, stage, result);
    throw new Error(failureMessage);
  }
  return result;
}

export function redactDiagnosticText(
  value: unknown,
  secrets: readonly string[],
  limit = diagnosticLimit,
): string | null {
  try {
    if (!Number.isSafeInteger(limit) || limit < 1 || secrets.length === 0 || secrets.length > 64 ||
      secrets.some((secret) => Buffer.byteLength(secret) < 8 || Buffer.byteLength(secret) > 4096)) return null;
    const text = String(value ?? '');
    if (Buffer.byteLength(text) >= outputLimit) return null;
    const redactions = [...new Set(secrets.flatMap(secretRepresentations))]
      .sort((left, right) => right.length - left.length);
    if (redactions.some((redaction) => redaction.length === 0 || '[redacted]'.includes(redaction.toLowerCase())) ||
      Buffer.byteLength(redactions.join('')) > 64 * 1024) return null;
    const matcher = new RegExp(redactions.map(escapeRegularExpression).join('|'), 'giu');
    let redacted = text.replace(matcher, '[redacted]');
    redacted = boundedString(redacted, limit);
    while (Buffer.byteLength(JSON.stringify(redacted)) - 2 > limit) redacted = redacted.slice(0, -1);
    return redacted;
  } catch {
    return null;
  }
}

export function parseManagedDiagnosticSecrets(
  source: string,
  runtime: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string[] {
  const canonical = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const key = /^(?:export\s+)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (!key || !isSecretName(key)) continue;
    const assignment = /^([A-Z][A-Z0-9_]*)='([^'\r\n]*)'$/.exec(line);
    if (!assignment || assignment[1] !== key || canonical.has(key)) throw invalidManagedEnvironment();
    canonical.set(key, assignment[2]!);
  }

  let configured: NodeJS.Dict<string>;
  try { configured = parseEnv(source); }
  catch { throw invalidManagedEnvironment(); }
  for (const [key, value] of Object.entries(configured)) {
    if (isSecretName(key) && canonical.get(key) !== value) throw invalidManagedEnvironment();
  }

  const secrets: string[] = [];
  for (const [name, value] of [...Object.entries(runtime), ...Object.entries(configured)]) {
    if (!value || !isSecretName(name)) continue;
    secrets.push(value);
    if (name.toUpperCase().includes('DATABASE_URL')) addUrlSecrets(value, secrets);
  }
  return [...new Set(secrets)];
}

function writeCommandFailure(
  diagnostics: CommandDiagnosticContext,
  executable: CommandExecutable,
  stage: CommandDiagnosticStage,
  result: CommandResult | null,
): void {
  try {
    const timedOut = result !== null && (result.timedOut ?? result.code === 124);
    const captureAtLimit = result?.stdoutAtLimit === true || result?.stderrAtLimit === true;
    const stdout = captureAtLimit || diagnostics.secrets === null
      ? null : redactDiagnosticText(result?.stdout, diagnostics.secrets);
    const stderr = captureAtLimit || diagnostics.secrets === null
      ? null : redactDiagnosticText(result?.stderr, diagnostics.secrets);
    const streams = stdout === null || stderr === null
      ? { stdout: '[omitted: unsafe secret patterns]', stderr: '[omitted: unsafe secret patterns]' }
      : { stdout, stderr };
    console.error(JSON.stringify({
      event: 'updater_command_failed', jobId: diagnostics.jobId, targetVersion: diagnostics.targetVersion,
      executable, stage, errorClass: result === null ? 'spawn_error' : timedOut ? 'timeout' : 'exit_nonzero',
      exitCode: result !== null && Number.isSafeInteger(result.code) ? result.code : null, timedOut,
      signal: typeof result?.signal === 'string' && /^SIG[A-Z0-9]+$/.test(result.signal) ? result.signal : null,
      ...streams,
    }));
  } catch {
    try { console.error(omittedDiagnostic); } catch { /* Logging cannot alter cleanup or rollback. */ }
  }
}

function secretRepresentations(value: string): string[] {
  const base64 = Buffer.from(value).toString('base64');
  const base64Url = base64.replace(/\+/g, '-').replace(/\//g, '_');
  const json = JSON.stringify(value).slice(1, -1);
  return [value, encodeURIComponent(value), encodeURI(value),
    new URLSearchParams({ value }).toString().slice('value='.length), json, htmlSafeJson(json),
    base64, base64.replace(/=+$/, ''), base64Url, base64Url.replace(/=+$/, '')];
}

function htmlSafeJson(value: string): string {
  return value.replace(/[<>&\u2028\u2029]/gu, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`);
}

function addUrlSecrets(value: string, secrets: string[]): void {
  try {
    const url = new URL(value);
    if (url.password) secrets.push(url.password, decodeURIComponent(url.password));
    for (const [key, parameter] of url.searchParams) {
      if (parameter && isSecretName(key)) secrets.push(parameter);
    }
  } catch { /* The complete malformed value is still redacted. */ }
}

function isSecretName(name: string): boolean {
  return /PASSWORD|TOKEN|SECRET|KEY|PEPPER|DATABASE_URL/i.test(name);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function invalidManagedEnvironment(): Error {
  return new Error('Secret assignments must use the canonical managed environment format');
}

function boundedText(chunks: readonly Buffer[], bytes: number): string {
  return boundedString(Buffer.concat(chunks, bytes).toString('utf8'), outputLimit);
}

function boundedString(value: string, limit: number): string {
  let text = Buffer.from(value).subarray(0, limit).toString('utf8');
  while (Buffer.byteLength(text) > limit) text = text.slice(0, -1);
  return text;
}
