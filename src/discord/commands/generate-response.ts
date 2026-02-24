import { SlashCommandBuilder, AttachmentBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { generateWhyCompany } from '../../resume/why-company.js';
import type { BotCommand } from '../bot.js';

export const generateResponseCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('generate-response')
    .setDescription('Generate a "Why this company?" response for an application')
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
      const result = await generateWhyCompany(jobId, force);
      const status = result.cached ? '(cached)' : '(freshly generated)';

      if (result.content.length > 1900) {
        const attachment = new AttachmentBuilder(Buffer.from(result.content, 'utf-8'), {
          name: `why-company-job-${jobId}.txt`,
        });
        await interaction.editReply({
          content: `"Why this company?" for job #${jobId} ${status}`,
          files: [attachment],
        });
      } else {
        await interaction.editReply({
          content: `**Why This Company? — Job #${jobId}** ${status}\n\n${result.content}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply({ content: `Failed to generate response: ${msg}` });
    }
  },
};
