import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

const log = logger.child({ module: 'export:r2' });

export function isR2Configured(): boolean {
  return !!(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET_NAME &&
    env.R2_PUBLIC_URL
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-');
}

export interface R2UploadResult {
  key: string;
  publicUrl: string;
}

export async function uploadResume(
  html: string,
  company: string,
  jobTitle: string,
): Promise<R2UploadResult> {
  if (!isR2Configured()) {
    throw new Error(
      'Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_PUBLIC_URL in .env',
    );
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });

  const timestamp = Date.now();
  const key = `resumes/${sanitizeFilename(company)}-${sanitizeFilename(jobTitle)}-${timestamp}.html`;

  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME!,
      Key: key,
      Body: html,
      ContentType: 'text/html',
    }),
  );

  const publicUrl = `${env.R2_PUBLIC_URL!.replace(/\/$/, '')}/${key}`;
  log.info({ key, publicUrl }, 'Uploaded resume to Cloudflare R2');

  return { key, publicUrl };
}
