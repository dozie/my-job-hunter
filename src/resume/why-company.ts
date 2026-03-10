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
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Generate a "Why do you want to work at ${job.company}?" response for a job application.

INSTRUCTIONS:
- 2 paragraphs max, about 5 lines total. Keep it tight.
- Connect the candidate's experience to what the company is building. Pick one or two specific things from the JD, not everything.
- Conversational and professional. This is for pasting into an application form field.
- Do not state specific years of experience.

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

Write the response as plain text.`,
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
