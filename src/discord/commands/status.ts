import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { jobs, applications } from '../../db/schema.js';
import { isGoogleConfigured, updateApplicationRow } from '../../export/sheets.js';
import { logger } from '../../observability/logger.js';
import type { BotCommand } from '../bot.js';

const log = logger.child({ module: 'discord:status' });

export const statusCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Update the status of a job application')
    .addIntegerOption(opt =>
      opt.setName('jobid').setDescription('The job ID').setRequired(true),
    )
    .addStringOption(opt =>
      opt
        .setName('status')
        .setDescription('New application status')
        .setRequired(true)
        .addChoices(
          { name: 'applied', value: 'applied' },
          { name: 'interviewing', value: 'interviewing' },
          { name: 'rejected', value: 'rejected' },
          { name: 'offer', value: 'offer' },
        ),
    )
    .addStringOption(opt =>
      opt.setName('notes').setDescription('Optional notes'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const jobId = interaction.options.getInteger('jobid', true);
    const newStatus = interaction.options.getString('status', true);
    const notes = interaction.options.getString('notes');

    try {
      // Fetch job
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (!job) {
        await interaction.editReply(`Job #${jobId} not found.`);
        return;
      }

      // Check existing application
      const [existing] = await db
        .select()
        .from(applications)
        .where(eq(applications.jobId, jobId))
        .limit(1);

      const oldStatus = existing?.status ?? 'not_applied';

      // Upsert application
      await db
        .insert(applications)
        .values({
          jobId,
          status: newStatus,
          notes: notes ?? null,
        })
        .onConflictDoUpdate({
          target: applications.jobId,
          set: {
            status: newStatus,
            ...(notes !== null ? { notes } : {}),
            updatedAt: new Date(),
          },
        });

      // Sync to Google Sheets if configured
      if (isGoogleConfigured()) {
        try {
          await updateApplicationRow(job.link, newStatus);
        } catch (err) {
          log.error({ err, jobId }, 'Failed to sync status to Google Sheets');
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('Application Status Updated')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Job', value: `#${job.id} — ${job.title}`, inline: true },
          { name: 'Company', value: job.company, inline: true },
          { name: 'Status', value: `${oldStatus} → **${newStatus}**`, inline: true },
        );

      if (notes) {
        embed.addFields({ name: 'Notes', value: notes });
      }

      log.info({ jobId, oldStatus, newStatus }, 'Application status updated');
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      log.error({ err, jobId }, 'Status command failed');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply(`Failed to update status: ${msg}`);
    }
  },
};
