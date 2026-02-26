# Personal Job Hunter — Design Document

## Context

**Problem**: Job hunting as a software engineer involves repetitive manual effort — searching multiple platforms, evaluating fit, tailoring resumes, and tracking applications. This wastes hours that could be spent on interview prep.

**Solution**: A personal automation system that retrieves jobs from multiple sources, scores them against preferences, surfaces the best matches via Discord, and generates tailored application materials on demand.

**Intended Outcome**: Reduce daily job-search effort to a few Discord commands while ensuring no high-quality opportunities are missed.

---

## 1. System Architecture

**Style**: Modular monolith in a single Node.js/TypeScript process. No microservices — this is a personal tool.

**Why TypeScript**: Best discord.js ecosystem, strong typing, single language across all modules, good Claude SDK support.

```
┌─────────────────────────────────────────────────────┐
│                   Discord Bot (discord.js v14)       │
│          Slash Commands / Embeds / Pagination        │
├──────────┬──────────┬───────────┬───────────┬────────┤
│Ingestion │ Scoring  │  Resume   │  Export   │ Alert  │
│ Service  │ Service  │  Builder  │  Service  │ Module │
├──────────┴──────────┴───────────┴───────────┴────────┤
│              Persistence Layer (Drizzle ORM)          │
├──────────────────────────────────────────────────────┤
│                    PostgreSQL                         │
└──────────────────────────────────────────────────────┘
         ↕                ↕              ↕
   Job Provider APIs   Claude API   Google Sheets/Drive API
```

---

## 2. Technology Stack

| Component          | Technology                        | Rationale                                      |
|--------------------|-----------------------------------|------------------------------------------------|
| Runtime            | Node.js 20 LTS + TypeScript 5.x  | Best discord.js support, single language        |
| Discord            | discord.js v14                    | 295K+ weekly downloads, best slash cmd support  |
| Database           | PostgreSQL 16                     | User choice, robust for structured job data     |
| ORM                | Drizzle ORM                       | Type-safe, lightweight, SQL-like syntax         |
| Scheduler          | node-cron v3                      | Simple, timezone support, `noOverlap` option    |
| LLM                | @anthropic-ai/sdk                 | Official Claude SDK for TypeScript              |
| Logging            | pino                              | Structured JSON logging, fast                   |
| Google Sheets      | google-spreadsheet v5             | Simplified Sheets API v4 wrapper                |
| Google Drive       | googleapis (drive v3)             | Upload tailored resumes, generate shareable links|
| Email              | nodemailer                        | Standard Node.js email sending                  |
| Config             | YAML (scoring) + .env (secrets)   | Human-readable weights, secure secrets          |
| Validation         | zod                               | Runtime validation + Claude structured outputs  |
| Resume             | Reactive Resume (self-hosted)     | JSON schema, Docker, Chromium PDF rendering     |
| Containerization   | Docker Compose                    | App + PostgreSQL + Reactive Resume printer      |

---

## 3. Project Structure

```
my-job-hunter/
├── src/
│   ├── index.ts                    # Entry point: init bot, scheduler, DB
│   ├── config/
│   │   ├── env.ts                  # Environment variable loading + validation
│   │   ├── scoring.ts              # Load scoring weights from YAML
│   │   └── providers.ts            # Load + validate providers.yml config
│   ├── db/
│   │   ├── schema.ts               # Drizzle table definitions
│   │   ├── migrate.ts              # Migration runner
│   │   └── client.ts               # DB connection pool
│   ├── ingestion/
│   │   ├── scheduler.ts            # node-cron schedule (every 4h, 06:00-18:00 ET)
│   │   ├── orchestrator.ts         # Priority-tiered ingestion + dedup + score
│   │   ├── providers/
│   │   │   ├── base.ts             # JobProvider interface
│   │   │   ├── greenhouse.ts       # Greenhouse Job Board API
│   │   │   ├── ashby.ts            # Ashby Posting API
│   │   │   ├── adzuna.ts           # Adzuna job aggregator API
│   │   │   ├── remotive.ts         # Remotive remote jobs API
│   │   │   ├── coresignal.ts       # Coresignal Base Jobs API (search + collect)
│   │   │   └── brightdata.ts       # Bright Data Jobs Scraper (LinkedIn, Indeed, Glassdoor)
│   │   ├── filters.ts              # Role keyword filter + location/remote filter
│   │   └── normalizer.ts           # Normalize provider responses → Job schema + canonical key
│   ├── scoring/
│   │   ├── scorer.ts               # Apply weighted scoring rules
│   │   ├── analyzer.ts             # Claude Haiku: extract structured job data
│   │   └── summarizer.ts           # Claude Sonnet: generate match summaries (score-gated)
│   ├── discord/
│   │   ├── bot.ts                  # Discord client setup + command registration
│   │   ├── commands/
│   │   │   ├── topjobs.ts          # /topjobs [limit]
│   │   │   ├── alljobs.ts          # /alljobs [limit] [seniority]
│   │   │   ├── export.ts           # /export top|next|all [count] [email]
│   │   │   ├── tailor.ts           # /tailor [jobId] [force]
│   │   │   ├── generate-cover.ts   # /generate-cover [jobId] [force]
│   │   │   ├── generate-response.ts # /generate-response [jobId] [force]
│   │   │   ├── job.ts              # /job [jobId]
│   │   │   ├── apply.ts            # /apply [jobId] [notes]
│   │   │   ├── status.ts           # /status [jobId] [status] [notes]
│   │   │   └── rescore.ts          # /rescore [with-summaries]
│   │   ├── embeds.ts               # Job card embed builder
│   │   └── pagination.ts           # Paginated embed navigation
│   ├── resume/
│   │   ├── builder.ts              # Resume build orchestrator (cache + flow)
│   │   ├── tailorer.ts             # Claude Opus: reword tasks to match JD
│   │   ├── template.ts             # HTML resume template (grey sidebar)
│   │   ├── renderer.ts             # JSON → HTML conversion
│   │   ├── cover-letter.ts         # Cover letter generator (Claude Opus)
│   │   └── why-company.ts          # "Why this company?" generator (Claude Opus)
│   ├── export/
│   │   ├── sheets.ts               # Google Sheets append (Jobs + Applications tabs)
│   │   ├── drive.ts                # Google Drive resume upload
│   │   └── email.ts                # SMTP email summary
│   └── observability/
│       └── logger.ts               # pino structured logging with child loggers
├── config/
│   ├── scoring.yml                 # Scoring weights configuration
│   ├── providers.yml               # Provider boards + filter settings
│   └── resume-base.json            # Base resume data (Reactive Resume schema)
├── drizzle/                        # Generated migrations (never hand-edit)
├── docker-compose.yml              # App + PostgreSQL
├── Dockerfile                      # Multi-stage build
├── .env.example                    # Template for secrets
├── tsconfig.json
├── package.json
└── CLAUDE.md
```

---

## 4. Database Schema

```sql
-- Jobs: source of truth for all retrieved jobs
CREATE TABLE jobs (
  id                      SERIAL PRIMARY KEY,
  external_id             TEXT NOT NULL,              -- Provider's job ID
  provider                TEXT NOT NULL,              -- 'greenhouse', 'ashby', 'coresignal', 'brightdata', etc.
  title                   TEXT NOT NULL,
  company                 TEXT NOT NULL,
  link                    TEXT NOT NULL,
  description             TEXT,                       -- Full JD snapshot (HTML stripped)
  location                TEXT,
  remote_eligible         BOOLEAN DEFAULT FALSE,
  seniority               TEXT,                       -- 'senior', 'mid', 'junior', 'unknown'
  score                   NUMERIC(4,2) DEFAULT 0,
  score_breakdown         JSONB,                      -- { remote: 3, seniority: 2, ... }
  summary                 TEXT,                       -- AI-generated match summary
  interview_style         TEXT DEFAULT 'unknown',     -- 'assignment', 'leetcode', 'unknown'
  compensation            TEXT,                       -- Salary/compensation info
  canonical_key           TEXT,                       -- Cross-provider dedup key (normalized company::title::desc_hash)
  likely_duplicate_of_id  INTEGER REFERENCES jobs(id),-- FK to primary job (NULL = this IS the primary)
  export_status           TEXT DEFAULT 'pending',     -- 'pending', 'exported'
  export_cursor           INTEGER DEFAULT 0,          -- Global export sequence number (0 = not exported)
  is_stale                BOOLEAN DEFAULT FALSE,      -- Auto-set TRUE after 30 days
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(external_id, provider)                       -- Per-provider deduplication key
);

CREATE INDEX idx_jobs_score ON jobs(score DESC);
CREATE INDEX idx_jobs_seniority ON jobs(seniority);
CREATE INDEX idx_jobs_export_status ON jobs(export_status);
CREATE INDEX idx_jobs_stale ON jobs(is_stale);
CREATE INDEX idx_jobs_canonical_key ON jobs(canonical_key);
CREATE INDEX idx_jobs_likely_duplicate ON jobs(likely_duplicate_of_id);

-- Tailored resumes
CREATE TABLE resumes (
  id          SERIAL PRIMARY KEY,
  job_id      INTEGER REFERENCES jobs(id),
  html        TEXT NOT NULL,                  -- Final tailored HTML resume
  json_data   JSONB,                          -- Reactive Resume JSON (for re-rendering)
  drive_link  TEXT,                           -- Google Drive shareable link
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Cover letters and application content
CREATE TABLE cover_letters (
  id          SERIAL PRIMARY KEY,
  job_id      INTEGER REFERENCES jobs(id),
  content     TEXT NOT NULL,
  type        TEXT DEFAULT 'cover_letter',    -- 'cover_letter', 'why_company', 'response'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Application tracking
CREATE TABLE applications (
  id          SERIAL PRIMARY KEY,
  job_id      INTEGER REFERENCES jobs(id) UNIQUE,
  status      TEXT DEFAULT 'not_applied',     -- 'not_applied', 'applied', 'interviewing', 'rejected', 'offer'
  notes       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Ingestion log (observability)
CREATE TABLE ingestion_logs (
  id          SERIAL PRIMARY KEY,
  provider    TEXT NOT NULL,
  jobs_found  INTEGER DEFAULT 0,
  jobs_new    INTEGER DEFAULT 0,
  error       TEXT,
  ran_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. Module Design

### 5.1 Ingestion Service

**Provider Interface** (`src/ingestion/providers/base.ts`):
```typescript
interface JobProvider {
  name: string;
  fetchJobs(): Promise<RawJob[]>;
}

interface RawJob {
  externalId: string;
  title: string;
  company: string;
  link: string;
  description?: string;
  location?: string;
  remoteEligible?: boolean;
  seniority?: string;
  compensation?: string;               // Salary/compensation info
  metadata?: Record<string, unknown>;  // Provider-specific extras
}
```

**Scheduling** (`src/ingestion/scheduler.ts`):
- `node-cron` expression: `0 */4 6-19 * * *` (every 4 hours, 06:00-19:30)
- `noOverlap: true` prevents concurrent runs
- Timezone set to user's local (e.g., `America/Toronto`)

**Priority-Tiered Execution**:
Providers run sequentially by priority tier. Within each tier, providers run in parallel via `Promise.allSettled`. Higher-priority tiers establish primacy for cross-provider deduplication.

```
Tier 1: Coresignal       (richest data — search + collect API)
Tier 2: Bright Data       (LinkedIn, Indeed, Glassdoor scraping)
Tier 3: Greenhouse, Ashby, Adzuna, Remotive  (direct company boards + aggregators)
```

**Orchestrator Flow** (per provider within each tier):
1. Fetch raw jobs from provider
2. Normalize raw jobs to common schema + compute `canonicalKey`
3. **Filter by role**: Two-pass keyword filter on title (case-insensitive, configurable in `providers.yml`):
   - **Exclude** (discard immediately): `frontend`, `front-end`, `front end`, `UI engineer`, `UX engineer`
   - **Include** (keep): `software`, `engineer`, `developer`, `SWE`, `backend`, `back-end`, `fullstack`, `full-stack`, `full stack`, `platform`
   - Exclusion runs first — a "Frontend Software Engineer" is rejected
4. **Filter by location/remote**: Keep only jobs where location contains `Toronto` or `Canada`, OR remote eligibility is indicated in the listing. Use keyword matching on location field + description scan for remote indicators (`remote`, `work from anywhere`, `distributed`).
5. **Per-provider dedup**: Insert via `ON CONFLICT DO NOTHING` on `(external_id, provider)` unique constraint
6. **Cross-provider soft dedup**: After inserting, check if a job with the same `canonicalKey` already exists from a different provider. If so, set `likelyDuplicateOfId` pointing to the existing (primary) job. The duplicate is kept in DB but hidden from display/export and skipped during scoring.
7. Score new non-duplicate jobs (Haiku extraction + weighted formula + optional Sonnet summary)
8. Log results to `ingestion_logs` (counts: fetched, role-filtered, location-filtered, inserted, duplicates, scored)
9. **Stale job check**: After all tiers complete, mark jobs older than 30 days as `is_stale = TRUE`. Stale jobs are excluded from `/topjobs`, `/alljobs`, and `/export`.

**Cross-Provider Deduplication**:
- **Canonical key format**: `normalizeCompany(company)::normalizeTitle(title)::descriptionFingerprint(description)`
- Company normalization: lowercase, strip suffixes (Inc, Ltd, Corp, LLC, Co), collapse whitespace
- Title normalization: lowercase, expand abbreviations (Sr. → Senior, Jr. → Junior), collapse whitespace
- Description fingerprint: SHA-256 hash of first 500 chars of normalized description, truncated to 12 hex chars. If no description, uses `nodesc` (won't match jobs that do have a description)
- **Soft dedup**: All jobs are inserted, duplicates are flagged with `likelyDuplicateOfId` FK, not deleted. Primary jobs (first seen) have `likelyDuplicateOfId = NULL`.
- **Same-title detection**: When a job has the same company+title but a different description fingerprint (different team/role), it is logged at `warn` level but kept as a separate primary job
- **Known tradeoff**: If providers describe the same role differently, both are kept (false negative). A few leaked duplicates are preferred over missing genuinely different roles.

**Providers**:

| Provider | Type | Auth | Cost | API Pattern |
|----------|------|------|------|-------------|
| Greenhouse | Company board | None (public) | Free | `GET /v1/boards/{token}/jobs?content=true` |
| Ashby | Company board | None (public) | Free | `GET /posting-api/job-board/{name}?includeCompensation=true` |
| Adzuna | Aggregator | API key | Free tier | `GET /v1/api/jobs/{country}/search` |
| Remotive | Aggregator | None | Free (2 req/min) | `GET /api/remote-jobs?category={cat}` |
| Coresignal | Data API | API key | Credit-based | Two-step: `POST /search/filter` → `GET /collect/{id}` |
| Bright Data | Scraper API | API token | ~$1.50/1K records | Three-step: `POST /trigger` → `GET /progress/{id}` → `GET /snapshot/{id}` |

**Coresignal** (`src/ingestion/providers/coresignal.ts`):
- Credit-aware two-step fetch: search for job IDs (paginated) → collect individual job records
- Configurable `maxCollect` per board (default 50) prevents runaway credit usage
- Collects specific fields only (title, description, location, company, salary, seniority, etc.)
- Filters out deleted/inactive listings before returning
- Free trial: 400 search + 200 collect credits (14 days)

**Bright Data** (`src/ingestion/providers/brightdata.ts`):
- Async trigger → poll → download model for LinkedIn, Indeed, Glassdoor
- Dataset IDs: LinkedIn (`gd_lpfll7v5hcqtkxl6l`), Indeed (`gd_l4dx9j9sscpvs7no2`), Glassdoor (`gd_lpfbbndm1xnopbrcr0`)
- Polling: linear backoff (15s initial → 60s cap), 5-minute timeout per board
- `maxCollect` per board maps to `limit_per_input` (default 100 records ≈ $0.15/board/run)
- Board concurrency: 3 parallel snapshot triggers via `p-limit`
- Cost estimate logged after each snapshot download
- No auto-retry on trigger failure (prevents double-billing)
- Source-specific field mapping (e.g., LinkedIn `job_posting_id` → externalId, Indeed `jobid` → externalId)

### 5.2 Scoring Service

**Config** (`config/scoring.yml`):
```yaml
weights:
  remote_eligible: 3.0       # Max points for remote-from-Canada
  seniority_match: 2.5       # Alignment with target seniority
  employer_location: 1.5     # North American employer
  interview_style: 1.5       # Assignment-based preferred
  role_type: 1.5             # Backend/platform > fullstack

role_type_preferences:
  backend: 1.0               # Full points
  platform: 1.0              # Full points
  software_engineer: 0.8     # Generic SE — good
  fullstack: 0.3             # Low preference
  # frontend: excluded at ingestion — never enters the system

interview_preferences:
  assignment: 1.0            # Full points
  unknown: 0.5               # Neutral
  leetcode: 0.0              # No points

target_seniority:
  - senior
  - mid
```

**Flow**:
1. For new jobs, call Claude **Haiku** to extract structured data:
   - Seniority level, remote eligibility, location, interview style hints
   - Use Zod schemas + Claude structured outputs for guaranteed parsing
2. Apply weighted scoring formula from config
3. Call Claude **Sonnet** to generate a 2-3 sentence match summary
4. Update job record with score, breakdown, and summary

**Scoring Formula** (weighted sum, normalized to 10):
```
raw_score = (remote_eligible × w1) + (seniority_match × w2) + (employer_location × w3)
          + (interview_style × w4) + (role_type × w5)

Each factor is 0.0 to 1.0 (from config lookup tables).
max_possible = sum of all weights = 10.0
final_score = (raw_score / max_possible) × 10
```
Jobs you're most interested in (remote, backend, senior, assignment-based) score highest and appear first.

**Concurrent Scoring Throttle**:
- Process scoring in batches of 5 concurrent Claude API calls (configurable)
- Use `p-limit` or simple semaphore to cap concurrency
- Prevents Claude API rate limit errors during large ingestion batches

**Cost Optimization**:
- **Score threshold gating**: Sonnet summaries only generated for jobs scoring >= 5.0/10 (saves ~60% of Sonnet calls)
- **Duplicate scoring skip**: Cross-provider duplicates (jobs with `likelyDuplicateOfId` set) are not sent to the AI scorer
- **Estimated cost**: Haiku ~$0.001/job, Sonnet ~$0.005/job (threshold-gated), net ~$0.002/job average

**Re-scoring** (`/rescore` command):
- Triggered manually via Discord when scoring config weights are updated
- Iterates all jobs in DB, re-applies weighted formula using current `scoring.yml`
- Optionally re-generates summaries (flag: `--with-summaries` to also re-run Sonnet)
- Updates `score`, `score_breakdown`, and optionally `summary` fields
- Reports count of re-scored jobs to Discord when complete

### 5.3 Discord Bot

**Slash Commands**:

| Command | Description | Key Logic |
|---------|-------------|-----------|
| `/topjobs [limit]` | Top N jobs (default 10) | Query by score DESC, exclude stale + duplicates, paginated embeds |
| `/alljobs [limit] [seniority]` | All jobs, optional filter | Filter by seniority, exclude stale + duplicates, paginated |
| `/job [jobId]` | View full job details | Full description, score breakdown, compensation, application status |
| `/export top\|next\|all [count] [email]` | Export to Google Sheets | Push unexported jobs to Sheets, optionally email summary |
| `/tailor [jobId] [force]` | Tailored resume | Claude Opus → HTML resume → DB cache. Returns cached unless `force` |
| `/generate-cover [jobId] [force]` | Cover letter | Claude Opus → store + return. Cached by default |
| `/generate-response [jobId] [force]` | "Why this company?" response | Claude Opus → store + return. Cached by default |
| `/apply [jobId] [notes]` | Mark job as applied | Create record in DB + append to Sheets "Applications" tab with resume link |
| `/status [jobId] [status] [notes]` | Update application status | Update DB + Sheets row. Status: applied, interviewing, rejected, offer |
| `/rescore [with-summaries]` | Re-score all jobs | Re-run scoring weights. Optionally regenerate Sonnet summaries |

**Job Card Embed**:
```
📋 Senior Software Engineer — Acme Corp
Score: 8.5/10
📍 Remote (Canada eligible)
💼 Senior | Assignment-based interview
Summary: Strong match — remote-friendly, assignment interview...
🔗 Apply: [link]
```

**Pagination**: Use `@discordx/pagination` or custom button collector for navigating job lists (10 per page).

**Alerts**: Dedicated `#job-hunter-alerts` channel for system errors, provider failures, export failures.

### 5.4 Resume Builder

**Key Requirements** (from user):
- Align task descriptions with the job description
- Reword tasks to demonstrate impact matching what the JD seeks — present as top 1% candidate
- **Do NOT reword the education section** — keep verbatim
- **Omit explicit years-of-experience counts** — let accomplishments and skills speak for themselves
- Output as **HTML file** (preserves structure, easy PDF export)
- Leverage the `/resume-builder` skill (Reactive Resume schema) for tailoring
- Content must remain truthful — rewording is allowed, fabrication is not

**Resume Tailoring Strategy** (top 1% positioning):
- Reword bullet points to mirror JD language and keywords (ATS optimization)
- Lead with quantified impact (metrics, scale, outcomes)
- Emphasize technical depth and breadth relevant to the target role
- Frame experience to highlight seniority signals (leadership, architecture decisions, mentoring)
- Omit year counts in summary/headline — use "experienced" or "seasoned" phrasing instead

**Flow** (`/tailor [jobId]`):
1. Load base resume from `config/resume-base.json` (Reactive Resume JSON schema)
2. Fetch the target job description from DB
3. Call Claude **Opus** with a detailed prompt:
   - Input: base resume JSON + job description
   - Instructions: Reword work experience tasks to align with JD keywords and requirements. Emphasize impact. Present candidate as top 1%. **Do not modify education section.** Do not state specific years-of-experience counts. Do not fabricate experience or skills.
   - Output: Modified resume JSON following Reactive Resume schema
4. Convert the tailored JSON to HTML using an HTML template
5. Store HTML in `resumes` table
6. Return HTML file to user via Discord (as file attachment)

**Base Resume Setup** (one-time, before first `/tailor`):
1. Use the `/resume-builder` skill to create your base resume interactively
2. The skill outputs JSON conforming to the Reactive Resume schema
3. Save the output as `config/resume-base.json`
4. This file contains your real experience, skills, education — the "source of truth"
5. Each `/tailor` call reads this file and produces a JD-aligned variant

**HTML Template**: A clean, professional HTML resume template with inline CSS for portability. The template renders Reactive Resume JSON fields into formatted HTML sections.

**Cost**: ~$0.02-0.05 per tailored resume (Opus)

### 5.5 Export Service

**Google Sheets** (two tabs in one spreadsheet):
- Use `google-spreadsheet` v5 with service account credentials

**Tab 1 — "Jobs"** (all exported jobs):
- Columns: title, company, score, summary, link, seniority, interview_style, compensation, exported_at
- Track exports using `export_cursor` on each job record

**Tab 2 — "Applications"** (jobs you've applied to):
- Columns: title, company, score, link, application_status, resume_link, applied_date, notes, last_updated
- When `/apply [jobId]` is called → appends a row to this tab
- When `/status [jobId] [status]` is called → finds the row by job link and updates `application_status` and `last_updated`
- `resume_link` column contains a clickable Google Drive link to the tailored HTML resume (if generated)
- Gives you a live spreadsheet view of your entire application pipeline

**Google Drive Resume Storage**:
- When `/tailor [jobId]` generates an HTML resume, upload it to a designated Google Drive folder
- Use the same service account (grant Drive API scope) + share the folder with your personal account
- File name format: `Resume - {Company} - {JobTitle}.html`
- The Drive file link is stored in the `resumes` DB table and written to the Applications sheet `resume_link` column
- Requires enabling **Google Drive API** in addition to Sheets API (same project, same service account)

**Export Pagination Logic** (`/export next [count]`):
- Each exported job gets `export_cursor` set to a global sequence number (max cursor + 1, +2, etc.)
- `/export top` — exports top N jobs where `export_cursor = 0`, sets cursor
- `/export next [count]` — exports next `count` jobs where `export_cursor = 0`, ordered by score DESC
- `/export all` — exports all jobs where `export_cursor = 0`
- Jobs are never removed from DB after export — cursor just tracks what's been sent

**Google Setup** (one-time):
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Create project
2. Enable **Google Sheets API** and **Google Drive API**
3. Create a Service Account → Download JSON key
4. In your personal Google Drive:
   - Create a Google Sheet (e.g., "Job Hunter Tracker") → copy the Sheet ID
   - Create a folder (e.g., "Job Hunter - Resumes") → copy the Folder ID
   - Share both the sheet and the folder with the service account email (Editor permission)
5. Add credentials to `.env` (service account email, private key, sheet ID, folder ID)

> The sheet lives under your Google account and email. The service account is just granted edit access to write data.

**Email** (via nodemailer):
- SMTP config in `.env`
- HTML email template with ranked job table
- Triggered by `/export` commands or scheduled summary

### 5.6 Observability

**Logging** (pino):
- Structured JSON logs with child loggers per module
- Log levels: ingestion events, scoring, exports, resume generation, errors
- Output to stdout (Docker logs)

**Discord Alerts**:
- Post to `#job-hunter-alerts` channel on: provider failure, export failure, unhandled errors
- Include error context and timestamp

---

## 6. Deployment

**Docker Compose** (`docker-compose.yml`):

```yaml
services:
  app:
    build: .
    env_file: .env
    depends_on: [postgres]
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: jobhunter
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}

  # Reactive Resume printer for PDF rendering (optional)
  printer:
    image: browserless/chromium:latest
    restart: unless-stopped

volumes:
  pgdata:
```

**VPS Deployment**:
- Single DigitalOcean droplet (2GB RAM sufficient)
- Docker Compose for orchestration
- `.env` file for all secrets (API keys, DB credentials, Discord token)

---

## 7. Configuration Files

**`.env.example`**:
```
DATABASE_URL=postgresql://user:pass@postgres:5432/jobhunter
DISCORD_TOKEN=
DISCORD_GUILD_ID=
DISCORD_ALERT_CHANNEL_ID=
ANTHROPIC_API_KEY=

# Google Sheets & Drive (optional)
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SHEET_ID=
GOOGLE_DRIVE_FOLDER_ID=

# Email (optional)
SMTP_HOST=
SMTP_USER=
SMTP_PASS=
EMAIL_TO=

# Adzuna (optional — required if adzuna provider enabled)
ADZUNA_APP_ID=
ADZUNA_APP_KEY=

# Coresignal (optional — required if coresignal provider enabled)
CORESIGNAL_API_KEY=

# Bright Data (optional — required if brightdata provider enabled)
BRIGHTDATA_API_TOKEN=
```

**`config/providers.yml`**:
```yaml
greenhouse:
  enabled: true
  boards:
    - { token: "shopify", name: "Shopify" }
    - { token: "stripe", name: "Stripe" }

ashby:
  enabled: true
  boards:
    - { name: "notion", label: "Notion" }
    - { name: "linear", label: "Linear" }

adzuna:
  enabled: false  # Requires ADZUNA_APP_ID and ADZUNA_APP_KEY env vars
  boards:
    - { name: "Canada Software", country: "ca", keywords: "software engineer" }

remotive:
  enabled: false  # Rate-limited: 2 req/min, keep board count low
  boards:
    - { name: "Software Dev", category: "software-dev" }

coresignal:
  enabled: false  # Requires CORESIGNAL_API_KEY. Credit-based: 400 search + 200 collect on free tier (14 days).
  boards:
    - { name: "Canada Software Engineers", country: "Canada", keywords: "software engineer", employmentType: "Full-time", maxCollect: 50 }

brightdata:
  enabled: false  # Requires BRIGHTDATA_API_TOKEN. Pay-as-you-go: ~$1.50/1K records.
  boards:
    - { name: "LinkedIn Backend Canada", category: "linkedin", keywords: "backend engineer", country: "Canada", maxCollect: 100 }
    - { name: "Indeed Software Canada", category: "indeed", keywords: "software engineer", country: "Canada", maxCollect: 100 }
    - { name: "Glassdoor Platform Canada", category: "glassdoor", keywords: "platform engineer", country: "Canada", maxCollect: 50 }

# Role keyword filters (case-insensitive, applied to all providers)
filters:
  exclude_titles: [frontend, front-end, front end, ui engineer, ux engineer]
  include_titles: [software, engineer, developer, swe, backend, back-end, fullstack, full-stack, full stack, platform]
  location_keywords: [toronto, canada, remote]
  remote_indicators: [remote, work from anywhere, distributed]
```

---

## 8. Incremental Rollout Plan

**Phase 1 — Core Loop** (start here):
1. Project scaffolding (TypeScript, Drizzle, Docker Compose)
2. PostgreSQL schema + migrations
3. Greenhouse + Ashby providers
4. Basic scoring (config-driven weights + Claude Haiku extraction)
5. Discord bot with `/topjobs` and `/alljobs`
6. Ingestion scheduler

**Phase 2 — AI & Resume**:
7. Claude Sonnet summaries
8. Resume builder with HTML output (`/tailor`)
9. Cover letter generation (`/generate-cover`)

**Phase 3 — Export & Tracking**:
10. Google Sheets export (Jobs tab + Applications tab)
11. Google Drive resume upload + linking
12. `/apply`, `/status`, `/job` commands
13. Email export
14. Seniority filtering on commands
15. Export pagination tracking

**Phase 4 — Expand Sources (Aggregators)**:
16. Adzuna provider
17. Remotive provider
18. "Why this company?" generator (`/generate-response`)

**Phase 5 — Coresignal Provider**:
19. Coresignal Base Jobs API (search + collect, credit-aware)
20. Board-level `maxCollect` caps to control credit spend

**Phase 6 — Bright Data + Cross-Provider Dedup**:
21. Bright Data provider (LinkedIn, Indeed, Glassdoor via async scraper API)
22. Cross-provider soft dedup via `canonicalKey` (normalized company + title + description fingerprint)
23. Priority-tiered ingestion (Coresignal → Bright Data → remaining providers)
24. Duplicate scoring skip (saves LLM cost)
25. Display/export filters to hide flagged duplicates

---

## 9. Error Handling Strategy

- **Provider failures**: `Promise.allSettled` — one provider failing doesn't block others. Log error, alert Discord, continue.
- **Claude API failures**: Retry once with exponential backoff. If still failing, store job without score/summary, flag for re-scoring later.
- **Database errors**: Connection pool with retry. Fatal DB errors trigger Discord alert.
- **Discord API errors**: Log and retry. Bot auto-reconnects on disconnect.
- **No circuit breakers needed** — this is a personal tool with low request volume.

---

## 10. Verification Plan

1. **Unit tests**: Scoring logic, normalizer, provider response parsing
2. **Integration test**: Full ingestion → scoring → DB storage flow with mock provider responses
3. **Manual verification**:
   - Run ingestion against real Greenhouse/Ashby APIs
   - Verify jobs appear in DB with correct scores
   - Verify role and location filters exclude irrelevant jobs
   - Test all Discord slash commands (topjobs, alljobs, job, tailor, generate-cover, generate-response, apply, status, rescore, export)
   - Generate a tailored resume → verify HTML output + Google Drive upload + link in Applications sheet
   - Export to Google Sheets → verify Jobs tab row format
   - Use `/apply` and `/status` → verify Applications tab updates
   - Verify stale job expiry after 30 days
   - Verify priority-tiered execution (Coresignal logs before Bright Data, before Greenhouse/Ashby)
   - Verify cross-provider dedup: look for "Likely duplicate found — flagged" log messages
   - Verify duplicates hidden from `/topjobs`, `/alljobs`, `/export` (only primaries shown)
   - Verify DB state: `SELECT COUNT(*) FROM jobs WHERE likely_duplicate_of_id IS NOT NULL` shows flagged duplicates
4. **Docker**: `docker compose up` should bring up the entire stack
