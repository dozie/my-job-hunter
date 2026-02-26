import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { desc, eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { jobs } from '../../db/schema.js';
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

    const topJobs = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.isStale, false), isNull(jobs.likelyDuplicateOfId)))
      .orderBy(desc(jobs.score))
      .limit(limit);

    const embeds = topJobs.map((job, i) => buildJobEmbed(job, i));
    await sendPaginatedEmbeds(interaction, embeds, `Top ${limit} Jobs`);
  },
};
