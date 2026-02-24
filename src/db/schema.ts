import {
  pgTable,
  serial,
  text,
  boolean,
  numeric,
  jsonb,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  externalId: text('external_id').notNull(),
  provider: text('provider').notNull(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  link: text('link').notNull(),
  description: text('description'),
  location: text('location'),
  remoteEligible: boolean('remote_eligible').default(false),
  seniority: text('seniority'),
  score: numeric('score', { precision: 4, scale: 2 }).default('0'),
  scoreBreakdown: jsonb('score_breakdown').$type<Record<string, number>>(),
  summary: text('summary'),
  interviewStyle: text('interview_style').default('unknown'),
  compensation: text('compensation'),
  exportStatus: text('export_status').default('pending'),
  exportCursor: integer('export_cursor').default(0),
  isStale: boolean('is_stale').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uq_jobs_external_provider').on(table.externalId, table.provider),
  index('idx_jobs_score').on(table.score),
  index('idx_jobs_seniority').on(table.seniority),
  index('idx_jobs_export_status').on(table.exportStatus),
  index('idx_jobs_stale').on(table.isStale),
]);

export const ingestionLogs = pgTable('ingestion_logs', {
  id: serial('id').primaryKey(),
  provider: text('provider').notNull(),
  jobsFound: integer('jobs_found').default(0),
  jobsNew: integer('jobs_new').default(0),
  error: text('error'),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow(),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type IngestionLog = typeof ingestionLogs.$inferSelect;
