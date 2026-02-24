import { SlashCommandBuilder, AttachmentBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { generateCoverLetter } from '../../resume/cover-letter.js';
import type { BotCommand } from '../bot.js';

export const generateCoverCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('generate-cover')
    .setDescription('Generate a cover letter tailored to a specific job')
    .addIntegerOption(opt =>
      opt.setName('jobid').setDescription('The job ID').setRequired(true),
    )
    .addBooleanOption(opt =>
      opt.setName('force').setDescription('Regenerate even if cached'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const jobId = interaction.options.getInteger('jobid', true);
    const force = interaction.options.getBoolean('force') ?? false;

    try {
      const result = await generateCoverLetter(jobId, force);
      const status = result.cached ? '(cached)' : '(freshly generated)';

      if (result.content.length > 1900) {
        const attachment = new AttachmentBuilder(Buffer.from(result.content, 'utf-8'), {
          name: `cover-letter-job-${jobId}.txt`,
        });
        await interaction.editReply({
          content: `Cover letter for job #${jobId} ${status}`,
          files: [attachment],
        });
      } else {
        await interaction.editReply({
          content: `**Cover Letter for Job #${jobId}** ${status}\n\n${result.content}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply({ content: `Failed to generate cover letter: ${msg}` });
    }
  },
};
