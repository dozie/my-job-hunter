import Anthropic from '@anthropic-ai/sdk';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { jobs, coverLetters } from '../db/schema.js';
import { loadResumeBase } from './builder.js';
import { logger } from '../observability/logger.js';

const log = logger.child({ module: 'resume:cover-letter' });

const anthropic = new Anthropic();
const MAX_DESCRIPTION_LENGTH = 4000;

export interface CoverLetterResult {
  content: string;
  cached: boolean;
}

export async function generateCoverLetter(
  jobId: number,
  force = false,
): Promise<CoverLetterResult> {
  // Check cache
  if (!force) {
    const existing = await db
      .select()
      .from(coverLetters)
      .where(and(eq(coverLetters.jobId, jobId), eq(coverLetters.type, 'cover_letter')))
      .limit(1);

    if (existing.length > 0) {
      log.info({ jobId }, 'Returning cached cover letter');
      return { content: existing[0].content, cached: true };
    }
  }

  // Fetch job
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error(`Job with ID ${jobId} not found`);
  if (!job.description) throw new Error(`Job ${jobId} has no description`);

  const baseResume = loadResumeBase();
  const truncatedJD = job.description.slice(0, MAX_DESCRIPTION_LENGTH);

  log.info({ jobId, company: job.company }, 'Generating cover letter');

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `Write a compelling, concise cover letter for this job application.

INSTRUCTIONS:
- Connect the candidate's specific experience to the role requirements
- Professional tone, 3-4 paragraphs
- Highlight relevant technical skills and achievements
- Show genuine understanding of what the company does
- Do not use generic filler — be specific to this role
- Do not state specific years of experience
- Address it generically (no "Dear Hiring Manager" unless you can infer a better address)

TARGET JOB:
Title: ${job.title}
Company: ${job.company}
Description:
${truncatedJD}

CANDIDATE RESUME:
${JSON.stringify(baseResume, null, 2)}

Write the cover letter as plain text. No markdown formatting.`,
      },
    ],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );

  if (!textBlock) throw new Error('No text response from Claude for cover letter');

  const content = textBlock.text.trim();

  // Store in DB
  await db.insert(coverLetters).values({
    jobId,
    content,
    type: 'cover_letter',
  });

  log.info({ jobId }, 'Cover letter generated and stored');
  return { content, cached: false };
}
