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
  type AnyPgColumn,
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
  canonicalKey: text('canonical_key'),
  likelyDuplicateOfId: integer('likely_duplicate_of_id').references((): AnyPgColumn => jobs.id),
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
  index('idx_jobs_canonical_key').on(table.canonicalKey),
  index('idx_jobs_likely_duplicate').on(table.likelyDuplicateOfId),
]);

export const ingestionLogs = pgTable('ingestion_logs', {
  id: serial('id').primaryKey(),
  provider: text('provider').notNull(),
  jobsFound: integer('jobs_found').default(0),
  jobsNew: integer('jobs_new').default(0),
  error: text('error'),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow(),
});

export const resumes = pgTable('resumes', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').references(() => jobs.id),
  jsonData: jsonb('json_data').notNull(),
  resumeLink: text('resume_link'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const coverLetters = pgTable('cover_letters', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').references(() => jobs.id),
  content: text('content').notNull(),
  type: text('type').default('cover_letter'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const applications = pgTable('applications', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').references(() => jobs.id).unique(),
  status: text('status').default('not_applied'),
  notes: text('notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type IngestionLog = typeof ingestionLogs.$inferSelect;
export type Resume = typeof resumes.$inferSelect;
export type CoverLetter = typeof coverLetters.$inferSelect;
export type Application = typeof applications.$inferSelect;
