import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { jobs, applications } from '../../db/schema.js';
import type { BotCommand } from '../bot.js';

export const skipCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Dismiss a job from listings')
    .addIntegerOption(opt =>
      opt.setName('jobid').setDescription('The job ID to skip').setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const jobId = interaction.options.getInteger('jobid', true);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) {
      await interaction.editReply(`Job #${jobId} not found.`);
      return;
    }

    await db
      .insert(applications)
      .values({ jobId, status: 'skipped' })
      .onConflictDoUpdate({
        target: applications.jobId,
        set: { status: 'skipped', updatedAt: new Date() },
      });

    await interaction.editReply(`Skipped: **${job.title}** at ${job.company}`);
  },
};
