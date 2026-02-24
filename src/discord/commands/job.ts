import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { jobs } from '../../db/schema.js';
import type { BotCommand } from '../bot.js';

export const jobCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('job')
    .setDescription('View full details for a specific job')
    .addIntegerOption(opt =>
      opt.setName('jobid').setDescription('The job ID').setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const jobId = interaction.options.getInteger('jobid', true);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (!job) {
      await interaction.editReply({ content: `Job #${jobId} not found.` });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${job.title}`)
      .setURL(job.link)
      .setColor(0x5a6977)
      .addFields(
        { name: 'Company', value: job.company, inline: true },
        { name: 'Score', value: `${job.score}/10`, inline: true },
        { name: 'Remote', value: job.remoteEligible ? 'Yes' : 'No', inline: true },
      );

    if (job.seniority) {
      embed.addFields({ name: 'Seniority', value: job.seniority, inline: true });
    }
    if (job.interviewStyle && job.interviewStyle !== 'unknown') {
      embed.addFields({ name: 'Interview Style', value: job.interviewStyle, inline: true });
    }
    if (job.compensation) {
      embed.addFields({ name: 'Compensation', value: job.compensation, inline: true });
    }
    if (job.location) {
      embed.addFields({ name: 'Location', value: job.location, inline: false });
    }

    // Score breakdown
    if (job.scoreBreakdown) {
      const breakdown = Object.entries(job.scoreBreakdown)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ');
      embed.addFields({ name: 'Score Breakdown', value: breakdown, inline: false });
    }

    if (job.summary) {
      embed.setDescription(job.summary);
    }

    // Description (truncated for Discord)
    if (job.description) {
      const truncated = job.description.length > 1000
        ? job.description.slice(0, 1000) + '...'
        : job.description;
      embed.addFields({ name: 'Description', value: truncated, inline: false });
    }

    embed.setFooter({ text: `ID: ${job.id} | ${job.provider} | ${job.isStale ? 'Stale' : 'Active'}` });
    embed.setTimestamp(job.createdAt);

    await interaction.editReply({ embeds: [embed] });
  },
};
