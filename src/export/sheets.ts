import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import type { Job, Application } from '../db/schema.js';

const log = logger.child({ module: 'export:sheets' });

function ensureGoogleConfigured(): void {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.GOOGLE_SHEET_ID) {
    throw new Error(
      'Google Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID in .env',
    );
  }
}

export function isGoogleConfigured(): boolean {
  return !!(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY && env.GOOGLE_SHEET_ID);
}

async function getSheet(): Promise<GoogleSpreadsheet> {
  ensureGoogleConfigured();

  const auth = new JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(env.GOOGLE_SHEET_ID!, auth);
  await doc.loadInfo();
  return doc;
}

const JOBS_HEADERS = [
  'Title', 'Company', 'Score', 'Summary', 'Link',
  'Seniority', 'Interview Style', 'Compensation', 'Exported At',
];

const APPLICATIONS_HEADERS = [
  'Title', 'Company', 'Score', 'Link', 'Application Status',
  'Resume Link', 'Applied Date', 'Notes', 'Last Updated',
];

async function ensureTab(doc: GoogleSpreadsheet, title: string, headers: string[]) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: headers });
    log.info({ tab: title }, 'Created new sheet tab');
  }
  return sheet;
}

export async function appendJobsToSheet(jobRows: Job[]): Promise<number> {
  const doc = await getSheet();
  const sheet = await ensureTab(doc, 'Jobs', JOBS_HEADERS);

  const rows = jobRows.map(job => ({
    'Title': job.title,
    'Company': job.company,
    'Score': job.score ?? '0',
    'Summary': job.summary ?? '',
    'Link': job.link,
    'Seniority': job.seniority ?? '',
    'Interview Style': job.interviewStyle ?? '',
    'Compensation': job.compensation ?? '',
    'Exported At': new Date().toISOString(),
  }));

  await sheet.addRows(rows);
  log.info({ count: rows.length }, 'Appended jobs to Google Sheet');
  return rows.length;
}

export async function appendApplicationRow(
  job: Job,
  application: Application,
  resumeDriveLink?: string | null,
): Promise<void> {
  const doc = await getSheet();
  const sheet = await ensureTab(doc, 'Applications', APPLICATIONS_HEADERS);

  await sheet.addRow({
    'Title': job.title,
    'Company': job.company,
    'Score': job.score ?? '0',
    'Link': job.link,
    'Application Status': application.status ?? 'applied',
    'Resume Link': resumeDriveLink ?? '',
    'Applied Date': new Date().toISOString(),
    'Notes': application.notes ?? '',
    'Last Updated': new Date().toISOString(),
  });

  log.info({ jobId: job.id, company: job.company }, 'Appended application to Google Sheet');
}

export async function updateApplicationRow(
  jobLink: string,
  status: string,
): Promise<void> {
  try {
    const doc = await getSheet();
    const sheet = doc.sheetsByTitle['Applications'];
    if (!sheet) {
      log.warn('Applications tab not found in Google Sheet');
      return;
    }

    const rows = await sheet.getRows();
    const row = rows.find(r => r.get('Link') === jobLink);

    if (!row) {
      log.warn({ jobLink }, 'Application row not found in Sheet — DB is source of truth');
      return;
    }

    row.set('Application Status', status);
    row.set('Last Updated', new Date().toISOString());
    await row.save();

    log.info({ jobLink, status }, 'Updated application status in Google Sheet');
  } catch (err) {
    log.error({ err, jobLink }, 'Failed to update application row in Sheet');
  }
}
