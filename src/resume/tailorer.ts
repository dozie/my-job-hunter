import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { logger } from '../observability/logger.js';
import type { ResumeData } from './builder.js';

const log = logger.child({ module: 'resume:tailorer' });

const anthropic = new Anthropic();

const MAX_DESCRIPTION_LENGTH = 4000;

export async function tailorResume(
  baseResume: ResumeData,
  jobDescription: string,
  jobTitle: string,
  company: string,
): Promise<ResumeData> {
  const truncatedJD = jobDescription.slice(0, MAX_DESCRIPTION_LENGTH);

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `You are tailoring a resume for a specific job posting.

INSTRUCTIONS:
- Reword work experience bullet points to mirror the job description's language and keywords (ATS optimization)
- Lead with quantified impact (metrics, scale, outcomes)
- Emphasize technical depth relevant to this specific role
- Frame experience to highlight seniority signals (leadership, architecture decisions, mentoring)
- Do NOT modify the education section — keep it exactly as provided
- Do NOT state specific years-of-experience counts
- Do NOT fabricate experience or skills — only reword existing content
- The summary should be tailored to this specific role
- Keep the same JSON structure as the input
- Keep bullet points direct and factual. No superlatives, no marketing language.
- The output should read like the candidate wrote their own resume, not like AI polished it.

WRITING STYLE (critical):
- NEVER use dashes (em dash, en dash, or hyphens used as dashes). Use periods or commas instead. Dashes are an AI giveaway.
- NEVER use these words or phrases: "seasoned", "leveraging", "passionate about", "I believe my unique", "aligns perfectly"
- Use natural, direct language. No corporate buzzwords.

TARGET JOB:
Title: ${jobTitle}
Company: ${company}
Description:
${truncatedJD}

CURRENT RESUME (JSON):
${JSON.stringify(baseResume, null, 2)}

Return ONLY the modified resume as valid JSON. No markdown, no explanation, just the JSON object.`,
      },
    ],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );

  if (!textBlock) {
    throw new Error('No text response from Claude for resume tailoring');
  }

  // Extract JSON from the response (handle potential markdown wrapping)
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr) as ResumeData;

  // Preserve education exactly as-is from the base resume
  parsed.education = baseResume.education;

  log.info({ jobTitle, company }, 'Resume tailored successfully');
  return parsed;
}
