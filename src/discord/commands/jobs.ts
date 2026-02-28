import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { queryJobsInterleaved } from '../../db/queries.js';
import { buildJobEmbed } from '../embeds.js';
import { sendPaginatedEmbeds } from '../pagination.js';
import type { BotCommand } from '../bot.js';

export const jobsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('jobs')
    .setDescription('Browse jobs with filters')
    .addStringOption(opt =>
      opt
        .setName('view')
        .setDescription('View mode (default: top)')
        .addChoices(
          { name: 'top', value: 'top' },
          { name: 'all', value: 'all' },
        ),
    )
    .addStringOption(opt =>
      opt
        .setName('filter')
        .setDescription('Filter by application status (default: unapplied)')
        .addChoices(
          { name: 'unapplied', value: 'unapplied' },
          { name: 'applied', value: 'applied' },
        ),
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
    )
    .addIntegerOption(opt =>
      opt.setName('limit').setDescription('Number of jobs to show').setMinValue(1).setMaxValue(100),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const view = interaction.options.getString('view') ?? 'top';
    const filter = (interaction.options.getString('filter') ?? 'unapplied') as 'unapplied' | 'applied';
    const seniority = interaction.options.getString('seniority') ?? undefined;
    const limit = interaction.options.getInteger('limit') ?? (view === 'top' ? 10 : 25);

    const jobsList = await queryJobsInterleaved({ limit, seniority, appliedFilter: filter });

    const filterLabel = filter === 'applied' ? 'Applied' : '';
    const seniorityLabel = seniority ? ` (${seniority})` : '';
    const title = view === 'top'
      ? `Top ${limit} ${filterLabel} Jobs${seniorityLabel}`
      : `All ${filterLabel} Jobs${seniorityLabel} — limit ${limit}`;

    const embeds = jobsList.map((job, i) => buildJobEmbed(job, i));
    await sendPaginatedEmbeds(interaction, embeds, title.replace(/\s+/g, ' ').trim());
  },
};
