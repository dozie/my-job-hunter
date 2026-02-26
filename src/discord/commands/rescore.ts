import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { jobs } from '../../db/schema.js';
import { loadScoringConfig } from '../../config/scoring.js';
import { scoreJob } from '../../scoring/scorer.js';
import { shouldGenerateSummary, generateSummary } from '../../scoring/summarizer.js';
import { analyzeJob, inferSeniorityFromTitle, type JobMetadata } from '../../scoring/analyzer.js';
import { logger } from '../../observability/logger.js';
import type { BotCommand } from '../bot.js';

const log = logger.child({ module: 'discord:rescore' });

export const rescoreCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('rescore')
    .setDescription('Re-apply scoring weights from config to all jobs')
    .addBooleanOption(opt =>
      opt.setName('with-analysis').setDescription('Re-run AI analysis on all jobs (fixes seniority/remote detection)'),
    )
    .addBooleanOption(opt =>
      opt.setName('with-summaries').setDescription('Also regenerate AI summaries for high-scoring jobs (costs money)'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const withAnalysis = interaction.options.getBoolean('with-analysis') ?? false;
    const withSummaries = interaction.options.getBoolean('with-summaries') ?? false;

    // Reload scoring config (bypass cache to pick up YAML changes)
    loadScoringConfig(true);

    const allJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.isStale, false));

    let rescored = 0;
    let reanalyzed = 0;
    let summariesGenerated = 0;

    for (const job of allJobs) {
      let metadata: JobMetadata;

      if (withAnalysis && job.description) {
        // Re-run AI analysis with improved prompt + location
        try {
          metadata = await analyzeJob(job.title, job.description, job.location ?? undefined);
          reanalyzed++;
        } catch (err) {
          log.warn({ err, jobId: job.id }, 'Re-analysis failed, falling back to DB metadata');
          metadata = {
            seniority: (job.seniority as JobMetadata['seniority']) || 'unknown',
            remote_eligible: job.remoteEligible ?? false,
            interview_style: (job.interviewStyle as JobMetadata['interview_style']) || 'unknown',
            role_type: 'software_engineer',
          };
        }
      } else {
        // Build metadata from existing DB fields
        metadata = {
          seniority: (job.seniority as JobMetadata['seniority']) || 'unknown',
          remote_eligible: job.remoteEligible ?? false,
          interview_style: (job.interviewStyle as JobMetadata['interview_style']) || 'unknown',
          role_type: 'software_engineer',
        };

        // Apply title-based seniority override even without full re-analysis
        const titleSeniority = inferSeniorityFromTitle(job.title);
        if (metadata.seniority === 'unknown' && titleSeniority) {
          metadata.seniority = titleSeniority;
        }
      }

      const result = scoreJob(metadata, job.location ?? undefined);

      const updateData: Record<string, unknown> = {
        score: String(result.score),
        scoreBreakdown: result.breakdown,
        seniority: metadata.seniority,
        remoteEligible: metadata.remote_eligible,
        interviewStyle: metadata.interview_style,
      };

      // Optionally regenerate summaries
      if (withSummaries && shouldGenerateSummary(result.score) && job.description) {
        const summary = await generateSummary(job.title, job.description, metadata);
        if (summary) {
          updateData.summary = summary;
          summariesGenerated++;
        }
      }

      await db.update(jobs).set(updateData).where(eq(jobs.id, job.id));
      rescored++;
    }

    let message = `Re-scored ${rescored} jobs with current scoring config.`;
    if (withAnalysis) {
      message += ` Re-analyzed ${reanalyzed} jobs.`;
    }
    if (withSummaries) {
      message += ` Regenerated ${summariesGenerated} summaries.`;
    }

    await interaction.editReply({ content: message });
  },
};
