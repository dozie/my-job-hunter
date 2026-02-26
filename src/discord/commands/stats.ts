import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { jobs } from '../../db/schema.js';
import { logger } from '../../observability/logger.js';
import type { BotCommand } from '../bot.js';

const log = logger.child({ module: 'discord:stats' });

export const statsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show job counts by provider') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    try {
      const byProvider = await db
        .select({
          provider: jobs.provider,
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where not ${jobs.isStale})::int`,
          stale: sql<number>`count(*) filter (where ${jobs.isStale})::int`,
        })
        .from(jobs)
        .groupBy(jobs.provider)
        .orderBy(sql`count(*) desc`);

      const grandTotal = byProvider.reduce((s, r) => s + r.total, 0);
      const grandActive = byProvider.reduce((s, r) => s + r.active, 0);
      const grandStale = byProvider.reduce((s, r) => s + r.stale, 0);

      const lines = byProvider.map(
        r => `**${r.provider}**: ${r.total} (${r.active} active, ${r.stale} stale)`,
      );

      const embed = new EmbedBuilder()
        .setTitle('Job Stats')
        .setColor(0x5a6977)
        .setDescription(lines.join('\n') || 'No jobs ingested yet.')
        .setFooter({ text: `Total: ${grandTotal} jobs (${grandActive} active, ${grandStale} stale)` });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      log.error({ err }, 'Stats command failed');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply(`Failed to fetch stats: ${msg}`);
    }
  },
};
