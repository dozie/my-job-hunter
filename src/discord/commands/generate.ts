import { SlashCommandBuilder, AttachmentBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { buildResume } from '../../resume/builder.js';
import { generateCoverLetter } from '../../resume/cover-letter.js';
import { generateWhyCompany } from '../../resume/why-company.js';
import type { BotCommand } from '../bot.js';

export const generateCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('generate')
    .setDescription('Generate AI content for a job application')
    .addIntegerOption(opt =>
      opt.setName('jobid').setDescription('The job ID').setRequired(true),
    )
    .addStringOption(opt =>
      opt
        .setName('type')
        .setDescription('Type of content to generate')
        .setRequired(true)
        .addChoices(
          { name: 'resume', value: 'resume' },
          { name: 'cover-letter', value: 'cover-letter' },
          { name: 'why-company', value: 'why-company' },
        ),
    )
    .addBooleanOption(opt =>
      opt.setName('force').setDescription('Regenerate even if cached'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const jobId = interaction.options.getInteger('jobid', true);
    const type = interaction.options.getString('type', true);
    const force = interaction.options.getBoolean('force') ?? false;

    try {
      switch (type) {
        case 'resume':
          await handleResume(interaction, jobId, force);
          break;
        case 'cover-letter':
          await handleTextContent(interaction, jobId, force, 'cover-letter', generateCoverLetter);
          break;
        case 'why-company':
          await handleTextContent(interaction, jobId, force, 'why-company', generateWhyCompany);
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply({ content: `Failed to generate ${type}: ${msg}` });
    }
  },
};

async function handleResume(
  interaction: ChatInputCommandInteraction,
  jobId: number,
  force: boolean,
): Promise<void> {
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
}

async function handleTextContent(
  interaction: ChatInputCommandInteraction,
  jobId: number,
  force: boolean,
  label: string,
  generator: (jobId: number, force: boolean) => Promise<{ content: string; cached: boolean }>,
): Promise<void> {
  const result = await generator(jobId, force);
  const status = result.cached ? '(cached)' : '(freshly generated)';
  const displayLabel = label === 'cover-letter' ? 'Cover Letter' : 'Why This Company?';

  if (result.content.length > 1900) {
    const attachment = new AttachmentBuilder(Buffer.from(result.content, 'utf-8'), {
      name: `${label}-job-${jobId}.txt`,
    });
    await interaction.editReply({
      content: `${displayLabel} for job #${jobId} ${status}`,
      files: [attachment],
    });
  } else {
    await interaction.editReply({
      content: `**${displayLabel} — Job #${jobId}** ${status}\n\n${result.content}`,
    });
  }
}
