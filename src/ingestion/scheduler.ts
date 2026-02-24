import cron from 'node-cron';
import { runIngestion } from './orchestrator.js';
import { logger } from '../observability/logger.js';

const log = logger.child({ module: 'scheduler' });

// Every 4 hours between 06:00 and 18:00, America/Toronto
const CRON_EXPRESSION = '0 */4 6-18 * * *';
const TIMEZONE = 'America/Toronto';

let isRunning = false;

export function startScheduler(): cron.ScheduledTask {
  log.info(
    { cron: CRON_EXPRESSION, timezone: TIMEZONE },
    'Starting ingestion scheduler',
  );

  const task = cron.schedule(
    CRON_EXPRESSION,
    async () => {
      if (isRunning) {
        log.warn('Previous ingestion still running — skipping');
        return;
      }

      isRunning = true;
      try {
        log.info('Scheduled ingestion triggered');
        const summary = await runIngestion();
        log.info(
          { totalNew: summary.totalNew, staleMarked: summary.staleMarked },
          'Scheduled ingestion complete',
        );
      } catch (err) {
        log.error({ err }, 'Scheduled ingestion failed');
      } finally {
        isRunning = false;
      }
    },
    { timezone: TIMEZONE },
  );

  return task;
}

export function stopScheduler(task: cron.ScheduledTask): void {
  task.stop();
  log.info('Scheduler stopped');
}
