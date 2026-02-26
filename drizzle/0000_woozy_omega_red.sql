CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer,
	"status" text DEFAULT 'not_applied',
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "applications_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "cover_letters" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer,
	"content" text NOT NULL,
	"type" text DEFAULT 'cover_letter',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ingestion_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"jobs_found" integer DEFAULT 0,
	"jobs_new" integer DEFAULT 0,
	"error" text,
	"ran_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"provider" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"link" text NOT NULL,
	"description" text,
	"location" text,
	"remote_eligible" boolean DEFAULT false,
	"seniority" text,
	"score" numeric(4, 2) DEFAULT '0',
	"score_breakdown" jsonb,
	"summary" text,
	"interview_style" text DEFAULT 'unknown',
	"compensation" text,
	"canonical_key" text,
	"likely_duplicate_of_id" integer,
	"export_status" text DEFAULT 'pending',
	"export_cursor" integer DEFAULT 0,
	"is_stale" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer,
	"html" text NOT NULL,
	"json_data" jsonb,
	"drive_link" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_letters" ADD CONSTRAINT "cover_letters_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_likely_duplicate_of_id_jobs_id_fk" FOREIGN KEY ("likely_duplicate_of_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_jobs_external_provider" ON "jobs" USING btree ("external_id","provider");--> statement-breakpoint
CREATE INDEX "idx_jobs_score" ON "jobs" USING btree ("score");--> statement-breakpoint
CREATE INDEX "idx_jobs_seniority" ON "jobs" USING btree ("seniority");--> statement-breakpoint
CREATE INDEX "idx_jobs_export_status" ON "jobs" USING btree ("export_status");--> statement-breakpoint
CREATE INDEX "idx_jobs_stale" ON "jobs" USING btree ("is_stale");--> statement-breakpoint
CREATE INDEX "idx_jobs_canonical_key" ON "jobs" USING btree ("canonical_key");--> statement-breakpoint
CREATE INDEX "idx_jobs_likely_duplicate" ON "jobs" USING btree ("likely_duplicate_of_id");