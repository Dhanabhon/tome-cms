const FRAME = /^\s*at .*:\d+:\d+\)?$/;

/**
 * Where a fault was thrown, for the log: the stack's frames without the message, which can quote
 * content. The message's own lines go first, so a line of it that begins "at " is never kept.
 */
export function faultFrames(error: unknown): string[] | undefined {
  if (!(error instanceof Error)) return undefined;
  const messageLines = String(error.message).split('\n').length;
  return error.stack?.split('\n').slice(messageLines).filter((line) => FRAME.test(line)).map((line) => line.trim());
}
