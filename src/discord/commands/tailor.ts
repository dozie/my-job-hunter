import { SlashCommandBuilder, AttachmentBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { buildResume } from '../../resume/builder.js';
import type { BotCommand } from '../bot.js';

export const tailorCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('tailor')
    .setDescription('Generate a tailored HTML resume for a specific job')
    .addIntegerOption(opt =>
      opt.setName('jobid').setDescription('The job ID to tailor for').setRequired(true),
    )
    .addBooleanOption(opt =>
      opt.setName('force').setDescription('Regenerate even if cached (costs money)'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const jobId = interaction.options.getInteger('jobid', true);
    const force = interaction.options.getBoolean('force') ?? false;

    try {
      const result = await buildResume(jobId, force);

      const attachment = new AttachmentBuilder(Buffer.from(result.html, 'utf-8'), {
        name: `resume-job-${jobId}.html`,
      });

      const status = result.cached ? '(cached)' : '(freshly generated)';
      const driveNote = result.resumeLink ? `\nResume: ${result.resumeLink}` : '';
      await interaction.editReply({
        content: `Resume tailored for job #${jobId} ${status}${driveNote}`,
        files: [attachment],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply({ content: `Failed to tailor resume: ${msg}` });
    }
  },
};
