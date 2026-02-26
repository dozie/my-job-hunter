import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { queryJobsInterleaved } from '../../db/queries.js';
import { buildJobEmbed } from '../embeds.js';
import { sendPaginatedEmbeds } from '../pagination.js';
import type { BotCommand } from '../bot.js';

export const allCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('all')
    .setDescription('Show all jobs with optional filters')
    .addIntegerOption(opt =>
      opt.setName('limit').setDescription('Max jobs to show (default 25)').setMinValue(1).setMaxValue(100),
    )
    .addStringOption(opt =>
      opt
        .setName('seniority')
        .setDescription('Filter by seniority level')
        .addChoices(
          { name: 'Senior', value: 'senior' },
          { name: 'Mid', value: 'mid' },
          { name: 'Junior', value: 'junior' },
          { name: 'Lead', value: 'lead' },
          { name: 'Staff', value: 'staff' },
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const limit = interaction.options.getInteger('limit') ?? 25;
    const seniority = interaction.options.getString('seniority') ?? undefined;

    const allJobs = await queryJobsInterleaved({ limit, seniority });

    const title = seniority
      ? `All Jobs (${seniority}) — limit ${limit}`
      : `All Jobs — limit ${limit}`;

    const embeds = allJobs.map((job, i) => buildJobEmbed(job, i));
    await sendPaginatedEmbeds(interaction, embeds, title);
  },
};
