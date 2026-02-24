# My Job Hunter

A personal job-hunting automation system that retrieves software engineering jobs from multiple sources, scores them against your preferences, and surfaces the best matches via Discord.

## Features

- **Multi-source ingestion** — Fetches jobs from Greenhouse and Ashby job board APIs (free, no auth required)
- **Smart filtering** — Two-pass title filter (exclude frontend, include SE keywords) + location/remote filter
- **AI-powered scoring** — Claude Haiku extracts metadata; Sonnet generates match summaries (score threshold-gated); weighted scoring ranks jobs 0–10
- **Resume tailoring** — Claude Opus rewrites your resume bullets to match each JD, outputs styled HTML
- **Cover letters & "Why us?"** — On-demand AI generation, cached to avoid duplicate cost
- **Discord bot** — 7 slash commands with paginated embeds
- **Scheduled runs** — Ingests every 4 hours (06:00–18:00 ET) via node-cron
- **Deduplication** — Unique constraint on `(external_id, provider)` prevents duplicates
- **Stale job expiry** — Jobs older than 30 days are auto-marked stale

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20 + TypeScript (ESM) |
| Discord | discord.js v14 |
| Database | PostgreSQL 16 + Drizzle ORM |
| AI | @anthropic-ai/sdk (Haiku, Sonnet, Opus) |
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
│       └── ashby.ts            # Ashby Posting API
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
│       └── rescore.ts          # /rescore
└── observability/
    └── logger.ts               # pino structured logging
```

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 16 (or use Docker Compose)
- Discord bot token + guild
- Anthropic API key

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

### System

| Command | Options | Description |
|---------|---------|-------------|
| `/rescore` | `with-summaries` (optional) | Re-apply scoring weights from `config/scoring.yml` to all jobs. Free unless `with-summaries` is set (regenerates Sonnet summaries). |

## Cost Optimization

- **Score threshold**: Sonnet summaries only generated for jobs scoring >= 5.0/10
- **Caching**: Resume, cover letter, and "why us" results are cached in DB — calling the same command twice returns the cached version at zero cost
- **On-demand only**: Opus calls (`/tailor`, `/generate-cover`, `/generate-response`) only fire when you explicitly request them
- **Estimated cost**: Haiku ~$0.001/job, Sonnet ~$0.005/job (threshold-gated), Opus ~$0.03/use

## Roadmap

- **Phase 3**: Google Sheets export, Drive resume storage, application tracking (`/apply`, `/status`, `/export`)
- **Phase 4**: Adzuna + Remotive providers

## License

MIT
