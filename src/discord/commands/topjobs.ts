import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { queryJobsInterleaved } from '../../db/queries.js';
import { buildJobEmbed } from '../embeds.js';
import { sendPaginatedEmbeds } from '../pagination.js';
import type { BotCommand } from '../bot.js';

export const topCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Show top-scored jobs')
    .addIntegerOption(opt =>
      opt.setName('limit').setDescription('Number of jobs to show (default 10)').setMinValue(1).setMaxValue(50),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const limit = interaction.options.getInteger('limit') ?? 10;
    const topJobs = await queryJobsInterleaved({ limit });

    const embeds = topJobs.map((job, i) => buildJobEmbed(job, i));
    await sendPaginatedEmbeds(interaction, embeds, `Top ${limit} Jobs`);
  },
};
