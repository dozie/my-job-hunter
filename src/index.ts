import { logger } from './observability/logger.js';
import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { startBot } from './discord/bot.js';
import { startScheduler } from './ingestion/scheduler.js';
import { runIngestion } from './ingestion/orchestrator.js';

const log = logger.child({ module: 'main' });

async function main(): Promise<void> {
  log.info('Starting Job Hunter');

  // Run database migrations
  await runMigrations();

  // Start Discord bot
  const client = await startBot();

  // Start ingestion scheduler
  const scheduler = startScheduler();

  // Optionally run ingestion immediately on startup
  if (env.RUN_INGESTION_ON_STARTUP) {
    log.info('Running ingestion on startup');
    runIngestion().catch(err => {
      log.error({ err }, 'Startup ingestion failed');
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    scheduler.stop();
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
