import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

const log = logger.child({ module: 'export:drive' });

function ensureDriveConfigured(): void {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.GOOGLE_DRIVE_FOLDER_ID) {
    throw new Error(
      'Google Drive is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_DRIVE_FOLDER_ID in .env',
    );
  }
}

export function isDriveConfigured(): boolean {
  return !!(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY && env.GOOGLE_DRIVE_FOLDER_ID);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-');
}

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string;
}

export async function uploadResume(
  html: string,
  company: string,
  jobTitle: string,
): Promise<DriveUploadResult> {
  ensureDriveConfigured();

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  const drive = google.drive({ version: 'v3', auth });

  const fileName = sanitizeFilename(`Resume - ${company} - ${jobTitle}.html`);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'text/html',
      parents: [env.GOOGLE_DRIVE_FOLDER_ID!],
    },
    media: {
      mimeType: 'text/html',
      body: Readable.from(html),
    },
    fields: 'id, webViewLink',
  });

  const fileId = response.data.id!;

  // Make the file viewable by anyone with the link
  await drive.permissions.create({
    fileId,
    requestBody: {
      type: 'anyone',
      role: 'reader',
    },
  });

  const webViewLink = response.data.webViewLink!;
  log.info({ fileId, fileName }, 'Uploaded resume to Google Drive');

  return { fileId, webViewLink };
}
