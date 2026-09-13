import { spawn } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
}

const outputLimit = 32 * 1024;
const diagnosticLimit = 4 * 1024;

export function runCommand(executable: string, args: readonly string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<CommandResult> {
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
        signal,
        timedOut,
      });
    });
  });
}

export function redactDiagnosticText(value: unknown, secrets: readonly string[], limit = diagnosticLimit): string {
  let text = String(value ?? '');
  const redactions = [...new Set(secrets.filter(Boolean).flatMap(secretRepresentations))]
    .sort((left, right) => right.length - left.length);
  for (const redaction of redactions) text = text.split(redaction).join('[redacted]');
  text = boundedString(text, limit);
  while (Buffer.byteLength(JSON.stringify(text)) - 2 > limit) text = text.slice(0, -1);
  return text;
}

function secretRepresentations(value: string): string[] {
  const encoded = [encodeURIComponent(value), encodeURI(value),
    new URLSearchParams({ value }).toString().slice('value='.length)];
  return [value, ...encoded, ...encoded.map((item) => item.replace(/%[0-9A-F]{2}/g, (part) => part.toLowerCase())),
    JSON.stringify(value).slice(1, -1), Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url')];
}

function boundedText(chunks: readonly Buffer[], bytes: number): string {
  return boundedString(Buffer.concat(chunks, bytes).toString('utf8'), outputLimit);
}

function boundedString(value: string, limit: number): string {
  let text = Buffer.from(value).subarray(0, limit).toString('utf8');
  while (Buffer.byteLength(text) > limit) text = text.slice(0, -1);
  return text;
}
