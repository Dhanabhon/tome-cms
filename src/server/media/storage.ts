import { S3Client } from '@aws-sdk/client-s3';

import { getServerEnv, type ServerEnv } from '../env';

// The bundled SeaweedFS on the managed compose network. A normal update does not replace the
// compose file, so an install that predates S3_INTERNAL_ENDPOINT needs this default to be fixed.
const MANAGED_STORAGE_ENDPOINT = 'http://seaweedfs:8333';

// The browser uploads to the public address, so a presigned URL must be signed for it. Every
// call the app makes itself goes to an address the app can reach without the public proxy: a
// CDN in front of the media host can fail a signed server-side request it has not cached.
export function storageEndpoints(env: Pick<ServerEnv, 'S3_ENDPOINT' | 'S3_INTERNAL_ENDPOINT' | 'TOME_CMS_UPDATE_MODE'>) {
  return {
    presign: env.S3_ENDPOINT,
    server: env.S3_INTERNAL_ENDPOINT ?? (env.TOME_CMS_UPDATE_MODE === 'managed' ? MANAGED_STORAGE_ENDPOINT : env.S3_ENDPOINT),
  };
}

const env = getServerEnv();
const endpoints = storageEndpoints(env);

export const s3Bucket = env.S3_BUCKET;
const client = (endpoint: string) => new S3Client({
  endpoint,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});
/** For every call the app makes itself. */
export const s3 = client(endpoints.server);
/** Only for `getSignedUrl`: the URL it signs is the one the browser uses. */
export const s3Presign = client(endpoints.presign);
