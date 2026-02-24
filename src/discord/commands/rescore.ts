import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { jobs } from '../../db/schema.js';
import { loadScoringConfig } from '../../config/scoring.js';
import { scoreJob } from '../../scoring/scorer.js';
import { shouldGenerateSummary, generateSummary } from '../../scoring/summarizer.js';
import type { JobMetadata } from '../../scoring/analyzer.js';
import type { BotCommand } from '../bot.js';

export const rescoreCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('rescore')
    .setDescription('Re-apply scoring weights from config to all jobs')
    .addBooleanOption(opt =>
      opt.setName('with-summaries').setDescription('Also regenerate AI summaries for high-scoring jobs (costs money)'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const withSummaries = interaction.options.getBoolean('with-summaries') ?? false;

    // Reload scoring config (bypass cache to pick up YAML changes)
    loadScoringConfig(true);

    const allJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.isStale, false));

    let rescored = 0;
    let summariesGenerated = 0;

    for (const job of allJobs) {
      // Build metadata from existing DB fields
      const metadata: JobMetadata = {
        seniority: (job.seniority as JobMetadata['seniority']) || 'unknown',
        remote_eligible: job.remoteEligible ?? false,
        interview_style: (job.interviewStyle as JobMetadata['interview_style']) || 'unknown',
        role_type: 'software_engineer', // Default — role_type isn't stored separately
      };

      // Infer role_type from score breakdown if available
      if (job.scoreBreakdown) {
        const breakdown = job.scoreBreakdown as Record<string, number>;
        if (breakdown.role_type !== undefined) {
          // The breakdown stores the weighted value, not the factor
          // We can't perfectly reverse it, so keep the default
        }
      }

      const result = scoreJob(metadata, job.location ?? undefined);

      const updateData: Record<string, unknown> = {
        score: String(result.score),
        scoreBreakdown: result.breakdown,
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
    if (withSummaries) {
      message += ` Regenerated ${summariesGenerated} summaries.`;
    }

    await interaction.editReply({ content: message });
  },
};
