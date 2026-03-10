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
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Write a cover letter for this job application.

INSTRUCTIONS:
- 2-3 short paragraphs. Don't overdo it.
- Connect the candidate's experience to the role requirements. Pick the most relevant things, not everything.
- Professional but human tone.
- Do not use generic filler. Be specific to this role.
- Do not state specific years of experience.
- Address it generically (no "Dear Hiring Manager" unless you can infer a better address).

WRITING STYLE (critical):
- Write as a thoughtful literature writer. Good prose, not corporate speak.
- NEVER use dashes (em dash, en dash, or hyphens used as dashes). Use periods or commas instead. Dashes are an AI giveaway.
- NEVER use these AI phrases: "I'm particularly drawn to", "I'm excited about the opportunity", "aligns perfectly with", "I'm thrilled", "leveraging my expertise", "passionate about", "I believe my unique"
- Use contractions naturally (I've, I'm, didn't, wasn't).
- Vary sentence length. Mix short and long. Don't make every sentence the same rhythm.
- Don't start every sentence with "I".
- No bullet points, no bold text, no markdown.
- The output must read like a real person wrote it, not AI.

TARGET JOB:
Title: ${job.title}
Company: ${job.company}
Description:
${truncatedJD}

CANDIDATE RESUME:
${JSON.stringify(baseResume, null, 2)}

Write the cover letter as plain text.`,
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
