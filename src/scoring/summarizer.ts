import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../observability/logger.js';
import type { JobMetadata } from './analyzer.js';

const log = logger.child({ module: 'scoring:summarizer' });

const anthropic = new Anthropic();

const SUMMARY_SCORE_THRESHOLD = 5.0;
const MAX_DESCRIPTION_LENGTH = 3000;

export function shouldGenerateSummary(score: number): boolean {
  return score >= SUMMARY_SCORE_THRESHOLD;
}

export async function generateSummary(
  title: string,
  description: string,
  metadata: JobMetadata,
): Promise<string | null> {
  try {
    const truncated = description.slice(0, MAX_DESCRIPTION_LENGTH);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `You are evaluating a job posting for a senior backend/platform engineer who prefers remote roles in Canada, assignment-based interviews, and backend or platform work.

Write a 2-3 sentence match assessment. Focus on: why this role is a good/poor fit, key strengths of the match, and any concerns.

Job Title: ${title}
Seniority: ${metadata.seniority}
Role Type: ${metadata.role_type}
Remote: ${metadata.remote_eligible ? 'Yes' : 'No'}
Interview Style: ${metadata.interview_style}

Description:
${truncated}`,
        },
      ],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );

    if (!textBlock) {
      log.warn({ title }, 'No text in Claude summary response');
      return null;
    }

    return textBlock.text.trim();
  } catch (err) {
    log.error({ err, title }, 'Summary generation failed');
    return null;
  }
}
