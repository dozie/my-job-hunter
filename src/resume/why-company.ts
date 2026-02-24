import Anthropic from '@anthropic-ai/sdk';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { jobs, coverLetters } from '../db/schema.js';
import { loadResumeBase } from './builder.js';
import { logger } from '../observability/logger.js';

const log = logger.child({ module: 'resume:why-company' });

const anthropic = new Anthropic();
const MAX_DESCRIPTION_LENGTH = 4000;

export interface WhyCompanyResult {
  content: string;
  cached: boolean;
}

export async function generateWhyCompany(
  jobId: number,
  force = false,
): Promise<WhyCompanyResult> {
  // Check cache
  if (!force) {
    const existing = await db
      .select()
      .from(coverLetters)
      .where(and(eq(coverLetters.jobId, jobId), eq(coverLetters.type, 'why_company')))
      .limit(1);

    if (existing.length > 0) {
      log.info({ jobId }, 'Returning cached why-company response');
      return { content: existing[0].content, cached: true };
    }
  }

  // Fetch job
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error(`Job with ID ${jobId} not found`);
  if (!job.description) throw new Error(`Job ${jobId} has no description`);

  const baseResume = loadResumeBase();
  const truncatedJD = job.description.slice(0, MAX_DESCRIPTION_LENGTH);

  log.info({ jobId, company: job.company }, 'Generating why-company response');

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Generate a "Why do you want to work at ${job.company}?" response for a job application.

INSTRUCTIONS:
- Identify the company's mission, product, tech stack, and culture cues from the job description
- Connect the candidate's specific experience and skills to what the company is building
- Show genuine enthusiasm backed by concrete alignment (not generic flattery)
- Conversational yet professional tone — this is for pasting into an application form field
- 2-3 paragraphs, ready to use as-is
- Do not state specific years of experience

TARGET JOB:
Title: ${job.title}
Company: ${job.company}
Description:
${truncatedJD}

CANDIDATE RESUME:
${JSON.stringify(baseResume, null, 2)}

Write the response as plain text. No markdown formatting.`,
      },
    ],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );

  if (!textBlock) throw new Error('No text response from Claude for why-company');

  const content = textBlock.text.trim();

  // Store in DB
  await db.insert(coverLetters).values({
    jobId,
    content,
    type: 'why_company',
  });

  log.info({ jobId }, 'Why-company response generated and stored');
  return { content, cached: false };
}
