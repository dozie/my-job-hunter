import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { logger } from '../observability/logger.js';

const log = logger.child({ module: 'scoring:analyzer' });

const anthropic = new Anthropic();

const extractionSchema = z.object({
  seniority: z.enum(['senior', 'mid', 'junior', 'lead', 'staff', 'unknown']),
  remote_eligible: z.boolean(),
  interview_style: z.enum(['assignment', 'leetcode', 'unknown']),
  role_type: z.enum(['backend', 'platform', 'software_engineer', 'fullstack', 'other']),
});

export type JobMetadata = z.infer<typeof extractionSchema> & { fromDefaults?: boolean };

const DEFAULTS: JobMetadata = {
  seniority: 'unknown',
  remote_eligible: false,
  interview_style: 'unknown',
  role_type: 'software_engineer',
};

const extractionTool: Anthropic.Tool = {
  name: 'extract_job_metadata',
  description: 'Extract structured metadata from a job posting',
  input_schema: {
    type: 'object' as const,
    properties: {
      seniority: {
        type: 'string',
        enum: ['senior', 'mid', 'junior', 'lead', 'staff', 'unknown'],
        description: 'The seniority level of the role',
      },
      remote_eligible: {
        type: 'boolean',
        description: 'Whether the role allows remote work from Canada',
      },
      interview_style: {
        type: 'string',
        enum: ['assignment', 'leetcode', 'unknown'],
        description: 'The interview process style',
      },
      role_type: {
        type: 'string',
        enum: ['backend', 'platform', 'software_engineer', 'fullstack', 'other'],
        description: 'The type of engineering role',
      },
    },
    required: ['seniority', 'remote_eligible', 'interview_style', 'role_type'],
  },
};

export async function analyzeJob(
  title: string,
  description: string,
): Promise<JobMetadata> {
  try {
    // Truncate description to control cost
    const truncated = description.slice(0, 4000);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [extractionTool],
      tool_choice: { type: 'tool', name: 'extract_job_metadata' },
      messages: [
        {
          role: 'user',
          content: `Analyze this job posting and extract metadata.\n\nTitle: ${title}\n\nDescription:\n${truncated}`,
        },
      ],
    });

    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolBlock) {
      log.warn({ title }, 'No tool use in Claude response, using defaults');
      return { ...DEFAULTS, fromDefaults: true };
    }

    return extractionSchema.parse(toolBlock.input);
  } catch (err) {
    log.error({ err, title }, 'Job analysis failed, using defaults');
    return { ...DEFAULTS, fromDefaults: true };
  }
}
