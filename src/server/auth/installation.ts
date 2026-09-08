import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { RESERVED_ADMIN_PATHS } from '../../lib/admin';

export const adminPathSchema = z.string().trim()
  .regex(/^\/[a-z0-9][a-z0-9-]{1,39}$/)
  .refine((path) => !RESERVED_ADMIN_PATHS.has(path), 'This path is reserved.');

export const installationInputSchema = z.object({
  siteName: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(120),
  siteDescription: z.string().trim().max(160),
  defaultLocale: z.enum(['th', 'en']),
  timezone: z.enum(['Asia/Bangkok', 'UTC']),
  adminPath: adminPathSchema,
  email: z.email().max(254),
}).strict();

export type InstallationInput = z.infer<typeof installationInputSchema>;

export function installationTokenMatches(actual: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}
