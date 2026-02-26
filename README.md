# My Job Hunter

A personal job-hunting automation system that retrieves software engineering jobs from multiple sources, scores them against your preferences, and surfaces the best matches via Discord.

## Features

- **Multi-source ingestion** — Fetches jobs from Greenhouse, Ashby, Adzuna, Remotive, Coresignal, and Bright Data (LinkedIn, Indeed, Glassdoor) APIs
- **Smart filtering** — Two-pass title filter (exclude frontend, include SE keywords) + location/remote filter
- **AI-powered scoring** — Claude Haiku extracts metadata; Sonnet generates match summaries (score threshold-gated); weighted scoring ranks jobs 0–10
- **Resume tailoring** — Claude Opus rewrites your resume bullets to match each JD, outputs styled HTML
- **Cover letters & "Why us?"** — On-demand AI generation, cached to avoid duplicate cost
- **Google Sheets export** — Export jobs and track applications in a Google Sheet
- **Google Drive resume storage** — Auto-upload tailored resumes to Drive with shareable links
- **Application tracking** — Track application status (applied → interviewing → offer/rejected) in DB + Sheets
- **Email summaries** — Send HTML email digest of exported jobs via SMTP
- **Discord bot** — 10 slash commands with paginated embeds
- **Scheduled runs** — Ingests every 4 hours (06:00–18:00 ET) via node-cron
- **Deduplication** — Per-provider unique constraint on `(external_id, provider)` + cross-provider soft dedup via canonical key (normalized company + title + description fingerprint). Duplicates are flagged, not deleted, and hidden from display/export
- **Priority-tiered ingestion** — Providers run in priority order (Coresignal → Bright Data → Greenhouse/Ashby/Adzuna/Remotive) so higher-quality sources establish primacy for dedup
- **Stale job expiry** — Jobs older than 30 days are auto-marked stale

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20 + TypeScript (ESM) |
| Discord | discord.js v14 |
| Database | PostgreSQL 16 + Drizzle ORM |
| AI | @anthropic-ai/sdk (Haiku, Sonnet, Opus) |
| Export | google-spreadsheet v5 + googleapis (Drive) |
| Email | nodemailer (SMTP) |
| Scheduler | node-cron v3 |
| Logging | pino |
| Config | YAML (scoring/providers) + .env (secrets) |
| Deploy | Docker Compose |

## Project Structure

```
src/
├── index.ts                    # Entry point
├── config/
│   ├── env.ts                  # Zod-validated environment variables
│   ├── scoring.ts              # YAML scoring weights loader
│   └── providers.ts            # YAML providers config loader
├── db/
│   ├── schema.ts               # Drizzle table definitions
│   ├── client.ts               # DB connection
│   └── migrate.ts              # Migration runner
├── ingestion/
│   ├── orchestrator.ts         # Fetch → filter → normalize → store → score
│   ├── scheduler.ts            # node-cron scheduler
│   ├── filters.ts              # Role + location filters
│   ├── normalizer.ts           # RawJob → NewJob conversion
│   └── providers/
│       ├── base.ts             # JobProvider interface
│       ├── greenhouse.ts       # Greenhouse Job Board API
│       ├── ashby.ts            # Ashby Posting API
│       ├── adzuna.ts           # Adzuna job aggregator API
│       ├── remotive.ts         # Remotive remote jobs API
│       ├── coresignal.ts       # Coresignal Base Jobs API (search + collect)
│       └── brightdata.ts       # Bright Data Jobs Scraper (LinkedIn, Indeed, Glassdoor)
├── scoring/
│   ├── analyzer.ts             # Claude Haiku metadata extraction
│   ├── summarizer.ts           # Claude Sonnet match summaries
│   └── scorer.ts               # Weighted scoring formula
├── resume/
│   ├── builder.ts              # Resume build orchestrator (cache + flow)
│   ├── tailorer.ts             # Claude Opus resume tailoring
│   ├── renderer.ts             # JSON → HTML conversion
│   ├── template.ts             # HTML resume template (grey sidebar)
│   ├── cover-letter.ts         # Cover letter generator
│   └── why-company.ts          # "Why this company?" generator
├── export/
│   ├── sheets.ts               # Google Sheets client (append/update)
│   ├── drive.ts                # Google Drive resume upload
│   └── email.ts                # SMTP email summary
├── discord/
│   ├── bot.ts                  # Client setup + command registration
│   ├── embeds.ts               # Job card embed builder
│   ├── pagination.ts           # Paginated embed navigation
│   └── commands/
│       ├── topjobs.ts          # /topjobs [limit]
│       ├── alljobs.ts          # /alljobs [limit] [seniority]
│       ├── job.ts              # /job [jobId]
│       ├── tailor.ts           # /tailor [jobId]
│       ├── generate-cover.ts   # /generate-cover [jobId]
│       ├── generate-response.ts # /generate-response [jobId]
│       ├── rescore.ts          # /rescore
│       ├── export.ts           # /export [mode] [count] [email]
│       ├── apply.ts            # /apply [jobId] [notes]
│       └── status.ts           # /status [jobId] [status] [notes]
└── observability/
    └── logger.ts               # pino structured logging
```

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 16 (or use Docker Compose)
- Discord bot token + guild
- Anthropic API key
- (Optional) Google Cloud service account for Sheets/Drive export
- (Optional) Gmail app password for email summaries
- (Optional) Adzuna API credentials for Adzuna provider
- (Optional) Coresignal API key for Coresignal provider
- (Optional) Bright Data API token for Bright Data provider (LinkedIn, Indeed, Glassdoor)

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/my-job-hunter.git
cd my-job-hunter
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in DATABASE_URL, DISCORD_TOKEN, DISCORD_GUILD_ID, ANTHROPIC_API_KEY
```

### 3. Configure providers

Edit `config/providers.yml` to add company boards you want to track:

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
  enabled: false  # Requires ADZUNA_APP_ID + ADZUNA_APP_KEY
  boards:
    - { name: "Canada Software", country: "ca", keywords: "software engineer" }

remotive:
  enabled: false  # Rate-limited: 2 req/min
  boards:
    - { name: "Software Dev", category: "software-dev" }

coresignal:
  enabled: false  # Requires CORESIGNAL_API_KEY, credit-based
  boards:
    - { name: "Canada Software Engineers", country: "Canada", keywords: "software engineer", employmentType: "Full-time", maxCollect: 50 }

brightdata:
  enabled: false  # Requires BRIGHTDATA_API_TOKEN, pay-as-you-go
  boards:
    - { name: "LinkedIn Backend Canada", category: "linkedin", keywords: "backend engineer", country: "Canada", maxCollect: 100 }
    - { name: "Indeed Software Canada", category: "indeed", keywords: "software engineer", country: "Canada", maxCollect: 100 }
    - { name: "Glassdoor Platform Canada", category: "glassdoor", keywords: "platform engineer", country: "Canada", maxCollect: 50 }
```

### 4. Configure scoring

Edit `config/scoring.yml` to adjust weights and preferences.

### 5. Start with Docker Compose

```bash
docker compose up -d
```

Or run locally:

```bash
npm run db:generate   # Generate migrations
npm run db:migrate    # Run migrations
npm run dev           # Start with tsx
```

## Scoring

Jobs are scored 0–10 using a weighted formula:

| Factor | Weight | Description |
|--------|--------|-------------|
| Remote eligible | 3.0 | Remote-from-Canada friendly |
| Seniority match | 2.5 | Senior/mid targets |
| Employer location | 1.5 | North American employer |
| Interview style | 1.5 | Assignment-based preferred |
| Role type | 1.5 | Backend/platform preferred |

## Discord Commands

### Job Discovery

| Command | Options | Description |
|---------|---------|-------------|
| `/topjobs` | `limit` (default 10) | Show top-scored jobs, sorted by score |
| `/alljobs` | `limit` (default 25), `seniority` | All jobs with optional seniority filter |
| `/job` | `jobid` (required) | View full job details: score breakdown, compensation, description |

### AI Generation

| Command | Options | Description |
|---------|---------|-------------|
| `/tailor` | `jobid` (required), `force` (optional) | Generate a tailored HTML resume for a specific job (Claude Opus). Returns cached version unless `force` is set. |
| `/generate-cover` | `jobid` (required), `force` (optional) | Generate a cover letter tailored to the job (Claude Opus). Cached by default. |
| `/generate-response` | `jobid` (required), `force` (optional) | Generate a "Why this company?" response for an application (Claude Opus). Cached by default. |

### Export & Tracking

| Command | Options | Description |
|---------|---------|-------------|
| `/export` | `mode` (top/next/all), `count` (default 25), `email` (optional) | Export unexported jobs to Google Sheets. `top` = highest scoring, `next` = next batch by cursor, `all` = everything. Optionally sends email summary. |
| `/apply` | `jobid` (required), `notes` (optional) | Mark a job as applied. Creates application record in DB and syncs to Google Sheets "Applications" tab with resume Drive link (if available). |
| `/status` | `jobid` (required), `status` (applied/interviewing/rejected/offer), `notes` (optional) | Update application status in DB + Google Sheets. |

### System

| Command | Options | Description |
|---------|---------|-------------|
| `/rescore` | `with-summaries` (optional) | Re-apply scoring weights from `config/scoring.yml` to all jobs. Free unless `with-summaries` is set (regenerates Sonnet summaries). |

## Cost Optimization

- **Score threshold**: Sonnet summaries only generated for jobs scoring >= 5.0/10
- **Caching**: Resume, cover letter, and "why us" results are cached in DB — calling the same command twice returns the cached version at zero cost
- **On-demand only**: Opus calls (`/tailor`, `/generate-cover`, `/generate-response`) only fire when you explicitly request them
- **Coresignal credit cap**: Each board has a configurable `maxCollect` limit (default 50) to prevent runaway collect credit usage
- **Bright Data record cap**: Each board has a configurable `maxCollect` limit (default 100) mapped to `limit_per_input` (~$1.50/1K records)
- **Duplicate scoring skip**: Cross-provider duplicates are not sent to the AI scorer, saving LLM cost
- **Estimated cost**: Haiku ~$0.001/job, Sonnet ~$0.005/job (threshold-gated), Opus ~$0.03/use

## Google Cloud Setup (Optional)

Required for `/export`, `/apply`, `/status` Sheets sync, and Drive resume upload.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Create a project (e.g., "Job Hunter")
2. Enable **Google Sheets API** and **Google Drive API**
3. Go to **IAM & Admin → Service Accounts** → Create a service account
4. Go to the **Keys** tab → **Add Key → Create new key → JSON** → Download
5. From the JSON file:
   - `client_email` → set as `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → set as `GOOGLE_PRIVATE_KEY`
6. Create a Google Sheet (e.g., "Job Hunter Tracker"):
   - Copy the Sheet ID from the URL (`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`)
   - Set as `GOOGLE_SHEET_ID`
   - Share the sheet with the service account email (Editor)
7. Create a Google Drive folder (e.g., "Job Hunter Resumes"):
   - Copy the Folder ID from the URL (`https://drive.google.com/drive/folders/<FOLDER_ID>`)
   - Set as `GOOGLE_DRIVE_FOLDER_ID`
   - Share the folder with the service account email (Editor)

## Adzuna Setup (Optional)

Required if you enable the `adzuna` provider in `config/providers.yml`.

1. Sign up at [developer.adzuna.com](https://developer.adzuna.com/)
2. From the dashboard, copy your **Application ID** and **Application Key**
3. Set in `.env`:
   ```
   ADZUNA_APP_ID=your_app_id
   ADZUNA_APP_KEY=your_app_key
   ```
4. Enable in `config/providers.yml`: set `adzuna.enabled: true`

Note: Adzuna provides description snippets only (not full JDs), which may result in less precise AI scoring compared to other providers.

## Remotive Setup (Optional)

No credentials needed — just enable in `config/providers.yml`: set `remotive.enabled: true`. All Remotive jobs are remote. Rate-limited to 2 requests/minute, so keep the board count low.

## Coresignal Setup (Optional)

Required if you enable the `coresignal` provider in `config/providers.yml`.

1. Sign up at [coresignal.com](https://coresignal.com/) for a free trial (400 search + 200 collect credits, 14 days)
2. From the dashboard, copy your **API Key**
3. Set in `.env`:
   ```
   CORESIGNAL_API_KEY=your_api_key
   ```
4. Enable in `config/providers.yml`: set `coresignal.enabled: true`
5. Configure boards with filters:
   ```yaml
   coresignal:
     enabled: true
     boards:
       - { name: "Canada Software Engineers", country: "Canada", keywords: "software engineer", employmentType: "Full-time", maxCollect: 50 }
   ```

**Credit usage per ingestion run:**
- Each board uses 1–3 search credits (pagination) + up to `maxCollect` collect credits
- Default `maxCollect` is 50 per board if not specified
- Free tier: 400 search + 200 collect credits — keep total `maxCollect` across all boards under 200

| Board Config | Required | Description |
|-------------|----------|-------------|
| `name` | Yes | Display name for logging |
| `country` | No | Filter by country (e.g. "United States", "Canada") |
| `keywords` | No | Filter by job title keywords |
| `employmentType` | No | "Full-time", "Part-time", "Contract", etc. |
| `maxCollect` | No | Max records to collect per board (default: 50) |

## Bright Data Setup (Optional)

Required if you enable the `brightdata` provider in `config/providers.yml`. Scrapes jobs from LinkedIn, Indeed, and Glassdoor via Bright Data's Jobs Scraper API.

1. Sign up at [brightdata.com](https://brightdata.com/) — pay-as-you-go pricing (~$1.50/1K records)
2. From the dashboard, copy your **API Token**
3. Set in `.env`:
   ```
   BRIGHTDATA_API_TOKEN=your_api_token
   ```
4. Enable in `config/providers.yml`: set `brightdata.enabled: true`
5. Configure boards with source categories:
   ```yaml
   brightdata:
     enabled: true
     boards:
       - { name: "LinkedIn Backend Canada", category: "linkedin", keywords: "backend engineer", country: "Canada", maxCollect: 100 }
       - { name: "Indeed Software Canada", category: "indeed", keywords: "software engineer", country: "Canada", maxCollect: 100 }
   ```

**Supported sources:** `linkedin`, `indeed`, `glassdoor`

**How it works:** Each board triggers an async snapshot (trigger → poll → download). Polling uses linear backoff (15s → 60s cap) with a 5-minute timeout per board.

**Cost per ingestion run:**
- ~$0.0015 per record collected
- A board with `maxCollect: 100` costs ~$0.15 per run
- Cost estimate is logged after each snapshot download

| Board Config | Required | Description |
|-------------|----------|-------------|
| `name` | Yes | Display name for logging |
| `category` | Yes | Source: `linkedin`, `indeed`, or `glassdoor` |
| `keywords` | No | Job search keywords |
| `country` | No | Country filter |
| `employmentType` | No | LinkedIn/Indeed job type filter |
| `maxCollect` | No | Max records per board (default: 100) |

## Email Setup (Optional)

Required for `/export --email` email summaries.

1. Use Gmail with an [App Password](https://myaccount.google.com/apppasswords):
   - Enable 2-Step Verification on your Google account
   - Generate an app password for "Mail"
2. Set in `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   EMAIL_TO=recipient@email.com
   ```

## License

MIT
