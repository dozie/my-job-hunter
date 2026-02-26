import type { Client, TextChannel } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import type { IngestionSummary } from '../ingestion/orchestrator.js';

const log = logger.child({ module: 'discord:alerts' });

let discordClient: Client | null = null;

export function setAlertClient(client: Client): void {
  discordClient = client;
}

export async function sendIngestionAlert(summary: IngestionSummary): Promise<void> {
  if (!discordClient || !env.DISCORD_ALERT_CHANNEL_ID) return;

  try {
    const channel = await discordClient.channels.fetch(env.DISCORD_ALERT_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      log.warn('Alert channel not found or not a text channel');
      return;
    }

    const providerLines = summary.results.map(r => {
      if (r.error) return `  **${r.provider}**: failed — ${r.error}`;
      return `  **${r.provider}**: ${r.inserted} new, ${r.duplicates} dupes, ${r.scored} scored`;
    });

    const message = [
      summary.totalNew > 0
        ? `**Ingestion complete** — ${summary.totalNew} new jobs found`
        : '**Ingestion complete** — no new jobs',
      ...providerLines,
      summary.staleMarked > 0 ? `  Stale: ${summary.staleMarked} marked` : null,
    ].filter(Boolean).join('\n');

    await (channel as TextChannel).send(message);
    log.debug('Ingestion alert sent');
  } catch (err) {
    log.error({ err }, 'Failed to send ingestion alert');
  }
}

export async function sendErrorAlert(context: string, error: unknown): Promise<void> {
  if (!discordClient || !env.DISCORD_ALERT_CHANNEL_ID) return;

  try {
    const channel = await discordClient.channels.fetch(env.DISCORD_ALERT_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    const msg = error instanceof Error ? error.message : String(error);
    await (channel as TextChannel).send(`**Error** — ${context}: ${msg}`);
  } catch (err) {
    log.error({ err }, 'Failed to send error alert');
  }
}
