import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { jobs, resumes } from '../db/schema.js';
import { tailorResume } from './tailorer.js';
import { renderResumeHtml } from './renderer.js';
import { logger } from '../observability/logger.js';

const log = logger.child({ module: 'resume:builder' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESUME_BASE_PATH = resolve(__dirname, '../../config/resume-base.json');

const workEntrySchema = z.object({
  company: z.string(),
  position: z.string(),
  location: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  bullets: z.array(z.string()),
});

const educationEntrySchema = z.object({
  institution: z.string(),
  area: z.string(),
  studyType: z.string(),
  date: z.string(),
  location: z.string(),
});

const resumeDataSchema = z.object({
  basics: z.object({
    name: z.string(),
    headline: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    url: z.object({ linkedin: z.string() }).optional(),
    summary: z.string(),
  }),
  skills: z.array(z.string()),
  work: z.array(workEntrySchema),
  education: z.array(educationEntrySchema),
});

export type ResumeData = z.infer<typeof resumeDataSchema>;

export function loadResumeBase(): ResumeData {
  if (!existsSync(RESUME_BASE_PATH)) {
    throw new Error(
      'Resume base file not found at config/resume-base.json. Create it from your resume before using /tailor.',
    );
  }

  const raw = readFileSync(RESUME_BASE_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  return resumeDataSchema.parse(parsed);
}

export interface BuildResumeResult {
  html: string;
  jsonData: ResumeData;
  cached: boolean;
}

export async function buildResume(
  jobId: number,
  force = false,
): Promise<BuildResumeResult> {
  // Check cache unless force regenerate
  if (!force) {
    const existing = await db
      .select()
      .from(resumes)
      .where(eq(resumes.jobId, jobId))
      .limit(1);

    if (existing.length > 0) {
      log.info({ jobId }, 'Returning cached resume');
      return {
        html: existing[0].html,
        jsonData: existing[0].jsonData as ResumeData,
        cached: true,
      };
    }
  }

  // Load base resume
  const baseResume = loadResumeBase();

  // Fetch the job
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) {
    throw new Error(`Job with ID ${jobId} not found`);
  }
  if (!job.description) {
    throw new Error(`Job ${jobId} has no description — cannot tailor resume`);
  }

  // Tailor with Claude Opus
  log.info({ jobId, company: job.company, title: job.title }, 'Tailoring resume');
  const tailored = await tailorResume(baseResume, job.description, job.title, job.company);

  // Render to HTML
  const html = renderResumeHtml(tailored);

  // Store in DB
  await db.insert(resumes).values({
    jobId,
    html,
    jsonData: tailored as Record<string, unknown>,
  });

  log.info({ jobId }, 'Resume built and stored');
  return { html, jsonData: tailored, cached: false };
}
