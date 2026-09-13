import { z } from 'zod';

const secret = z.string().min(32);
const timeout = (fallback: string, maximum: number) => z.string().regex(/^\d+$/).default(fallback)
  .transform(Number).pipe(z.number().int().min(100).max(maximum));
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: timeout('5000', 60_000),
  DATABASE_QUERY_TIMEOUT_MS: timeout('30000', 3_600_000),
  TOME_CMS_PUBLIC_URL: z.url({ protocol: /^https?$/ }),
  TOME_CMS_INSTALL_TOKEN: secret,
  BETTER_AUTH_SECRET: secret,
  TOME_CMS_CONTEXT_SECRET: secret,
  TOME_CMS_RECOVERY_PEPPER: secret,
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
  S3_REGION: z.string().trim().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  MEDIA_PUBLIC_URL: z.url({ protocol: /^https?$/ }),
  TOME_CMS_FRONTEND_MODE: z.enum(['bundled', 'headless']).default('bundled'),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && URL.canParse(value.TOME_CMS_PUBLIC_URL) && new URL(value.TOME_CMS_PUBLIC_URL).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['TOME_CMS_PUBLIC_URL'], message: 'Production requires HTTPS.' });
  }
  if (value.NODE_ENV === 'production' && URL.canParse(value.S3_ENDPOINT) && new URL(value.S3_ENDPOINT).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'Production signed uploads require a public HTTPS S3 endpoint.' });
  }
  if (value.NODE_ENV === 'production' && URL.canParse(value.MEDIA_PUBLIC_URL) && new URL(value.MEDIA_PUBLIC_URL).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['MEDIA_PUBLIC_URL'], message: 'Production media delivery requires HTTPS.' });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: NodeJS.ProcessEnv | Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(input);
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
