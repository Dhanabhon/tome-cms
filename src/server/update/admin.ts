import { z } from 'zod';

const stableVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);

export const updateActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check') }).strict(),
  z.object({ action: z.literal('apply'), version: stableVersion }).strict(),
]);

export type UpdateAction = z.infer<typeof updateActionSchema>;
