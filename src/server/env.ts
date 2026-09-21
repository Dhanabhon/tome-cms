import { isIP } from 'node:net';
import { z } from 'zod';

function isPublicHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host) === 4) {
    const [a, b, c] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(host) === 6) {
    const [first, second] = host.split(':').map((part) => Number.parseInt(part || '0', 16));
    return first >= 0x2000 && first <= 0x3fff
      && !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
      && first !== 0x2002 && !(first === 0x3fff && second < 0x1000);
  }
  const localSuffixes = ['local', 'localhost', 'internal', 'localdomain', 'lan', 'home.arpa', 'test', 'invalid', 'example', 'onion', 'alt'];
  return host.length <= 253 && host.includes('.')
    && host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && !localSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

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
  TOME_CMS_UPDATE_MODE: z.enum(['check-only', 'managed']).default('check-only'),
  /* Optional. Without it the admin simply offers no suggestions: the key buys a
     convenience, and nothing the site does for a reader depends on it. */
  TYPESAFE_API_KEY: z.string().trim().min(1).optional(),
  TOME_CMS_UPDATER_SOCKET: z.string()
    .regex(/^\/run\/tome-cms\/[a-z0-9.-]+\.sock$/)
    .default('/run/tome-cms/updater.sock'),
}).superRefine((value, context) => {
  if (URL.canParse(value.TOME_CMS_PUBLIC_URL)) {
    const publicUrl = new URL(value.TOME_CMS_PUBLIC_URL);
    if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
      context.addIssue({ code: 'custom', path: ['TOME_CMS_PUBLIC_URL'], message: 'Use an origin without a path, query, or fragment.' });
    }
  }
  if (value.NODE_ENV === 'production' && URL.canParse(value.TOME_CMS_PUBLIC_URL) && new URL(value.TOME_CMS_PUBLIC_URL).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['TOME_CMS_PUBLIC_URL'], message: 'Production requires HTTPS.' });
  }
  if (value.NODE_ENV === 'production' && URL.canParse(value.S3_ENDPOINT) && new URL(value.S3_ENDPOINT).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'Production signed uploads require a public HTTPS S3 endpoint.' });
  }
  if (value.NODE_ENV === 'production' && URL.canParse(value.MEDIA_PUBLIC_URL) && new URL(value.MEDIA_PUBLIC_URL).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['MEDIA_PUBLIC_URL'], message: 'Production media delivery requires HTTPS.' });
  }
  if (value.NODE_ENV === 'production') {
    for (const key of ['TOME_CMS_PUBLIC_URL', 'S3_ENDPOINT', 'MEDIA_PUBLIC_URL'] as const) {
      if (URL.canParse(value[key]) && !isPublicHost(new URL(value[key]).hostname)) {
        context.addIssue({ code: 'custom', path: [key], message: 'Production requires a browser-reachable public host.' });
      }
    }
  }
}).transform((value) => ({ ...value, TOME_CMS_PUBLIC_URL: new URL(value.TOME_CMS_PUBLIC_URL).origin }));

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: NodeJS.ProcessEnv | Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(input);
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
