import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { jobs, applications, resumes } from '../../db/schema.js';
import { isGoogleConfigured, appendApplicationRow } from '../../export/sheets.js';
import { logger } from '../../observability/logger.js';
import type { BotCommand } from '../bot.js';

const log = logger.child({ module: 'discord:apply' });

export const applyCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Mark a job as applied and track it')
    .addIntegerOption(opt =>
      opt.setName('jobid').setDescription('The job ID').setRequired(true),
    )
    .addStringOption(opt =>
      opt.setName('notes').setDescription('Optional notes about the application'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const jobId = interaction.options.getInteger('jobid', true);
    const notes = interaction.options.getString('notes');

    try {
      // Fetch job
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (!job) {
        await interaction.editReply(`Job #${jobId} not found.`);
        return;
      }

      // Upsert application
      const [application] = await db
        .insert(applications)
        .values({
          jobId,
          status: 'applied',
          notes: notes ?? null,
        })
        .onConflictDoUpdate({
          target: applications.jobId,
          set: {
            status: 'applied',
            notes: notes ?? undefined,
            updatedAt: new Date(),
          },
        })
        .returning();

      // Check for existing resume + driveLink
      const [resume] = await db
        .select()
        .from(resumes)
        .where(eq(resumes.jobId, jobId))
        .limit(1);
      const driveLink = resume?.driveLink ?? null;

      // Sync to Google Sheets if configured
      if (isGoogleConfigured()) {
        try {
          await appendApplicationRow(job, application, driveLink);
        } catch (err) {
          log.error({ err, jobId }, 'Failed to sync application to Google Sheets');
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('Application Tracked')
        .setColor(0x00ae86)
        .addFields(
          { name: 'Job', value: `#${job.id} — ${job.title}`, inline: true },
          { name: 'Company', value: job.company, inline: true },
          { name: 'Status', value: 'applied', inline: true },
        );

      if (driveLink) {
        embed.addFields({ name: 'Resume', value: `[View on Drive](${driveLink})` });
      }
      if (notes) {
        embed.addFields({ name: 'Notes', value: notes });
      }

      log.info({ jobId, company: job.company }, 'Application tracked');
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      log.error({ err, jobId }, 'Apply command failed');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply(`Failed to track application: ${msg}`);
    }
  },
};
