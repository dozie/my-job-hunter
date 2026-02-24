import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './client.js';
import { logger } from '../observability/logger.js';

const log = logger.child({ module: 'db:migrate' });

export async function runMigrations(): Promise<void> {
  log.info('Running database migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  log.info('Migrations complete');
}
