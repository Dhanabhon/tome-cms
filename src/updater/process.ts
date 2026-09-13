import { spawn } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const outputLimit = 32 * 1024;

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
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        code: timedOut ? 124 : code ?? 1,
        stdout: boundedText(stdout, stdoutBytes),
        stderr: boundedText(stderr, stderrBytes),
      });
    });
  });
}

function boundedText(chunks: readonly Buffer[], bytes: number): string {
  let text = Buffer.concat(chunks, bytes).toString('utf8');
  while (Buffer.byteLength(text) > outputLimit) text = text.slice(0, -1);
  return text;
}
