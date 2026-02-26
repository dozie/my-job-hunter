import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { jobs } from '../../db/schema.js';
import { queryJobsInterleaved } from '../../db/queries.js';
import { isGoogleConfigured, appendJobsToSheet } from '../../export/sheets.js';
import { isEmailConfigured, sendJobSummaryEmail } from '../../export/email.js';
import { logger } from '../../observability/logger.js';
import type { BotCommand } from '../bot.js';

const log = logger.child({ module: 'discord:export' });

export const exportCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('export')
    .setDescription('Export jobs to Google Sheets (and optionally email)')
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('Which jobs to export')
        .setRequired(true)
        .addChoices(
          { name: 'top — highest scoring unexported', value: 'top' },
          { name: 'next — next batch by cursor', value: 'next' },
          { name: 'all — all unexported jobs', value: 'all' },
        ),
    )
    .addIntegerOption(opt =>
      opt.setName('count').setDescription('Number of jobs (default 25, used with top/next)'),
    )
    .addBooleanOption(opt =>
      opt.setName('email').setDescription('Also send an email summary'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    if (!isGoogleConfigured()) {
      await interaction.editReply(
        'Google Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID in .env',
      );
      return;
    }

    const mode = interaction.options.getString('mode', true);
    const count = interaction.options.getInteger('count') ?? 25;
    const sendEmail = interaction.options.getBoolean('email') ?? false;

    try {
      // Get the current max cursor for 'next' mode
      const [cursorResult] = await db
        .select({ maxCursor: sql<number>`COALESCE(MAX(${jobs.exportCursor}), 0)` })
        .from(jobs);
      const currentMaxCursor = cursorResult.maxCursor;

      // Query unexported jobs with company-interleaved ordering
      let jobRows = await queryJobsInterleaved({ unexportedOnly: true });

      if (mode === 'top' || mode === 'next') {
        jobRows = jobRows.slice(0, count);
      }
      // 'all' keeps the full list

      if (jobRows.length === 0) {
        await interaction.editReply('No unexported jobs found.');
        return;
      }

      // Append to Google Sheets
      const exported = await appendJobsToSheet(jobRows);

      // Update export status and cursor
      for (let i = 0; i < jobRows.length; i++) {
        await db
          .update(jobs)
          .set({
            exportStatus: 'exported',
            exportCursor: currentMaxCursor + i + 1,
          })
          .where(eq(jobs.id, jobRows[i].id));
      }

      // Optionally send email
      let emailNote = '';
      if (sendEmail) {
        if (!isEmailConfigured()) {
          emailNote = '\n(Email not configured — skipped. Set SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_TO)';
        } else {
          await sendJobSummaryEmail(jobRows);
          emailNote = '\nEmail summary sent!';
        }
      }

      log.info({ mode, count: exported }, 'Export completed');
      await interaction.editReply(
        `Exported **${exported}** jobs to Google Sheets (mode: ${mode}).${emailNote}`,
      );
    } catch (err) {
      log.error({ err }, 'Export failed');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply(`Export failed: ${msg}`);
    }
  },
};
