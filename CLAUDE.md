# Job Hunter — Project Conventions

## Overview
Personal job-hunting automation system. Modular monolith, single Node.js process.

## Tech Stack
- TypeScript 5.x, Node.js 20 LTS, ESM modules (`"type": "module"`)
- discord.js v14 for Discord bot
- Drizzle ORM + `postgres` driver for PostgreSQL 16
- pino for structured JSON logging
- zod for runtime validation
- node-cron for scheduling
- @anthropic-ai/sdk for Claude API (Haiku for extraction, Sonnet for summaries)
- js-yaml for YAML config loading

## Directory Structure
- `src/config/` — Environment and YAML config loaders (zod-validated)
- `src/db/` — Drizzle schema, client, migrations
- `src/ingestion/` — Providers, filters, orchestrator, scheduler
- `src/scoring/` — Scorer, Claude analyzer
- `src/discord/` — Bot, commands, embeds, pagination
- `src/observability/` — pino logger
- `config/` — YAML config files (scoring.yml, providers.yml)
- `drizzle/` — Generated migrations (never hand-edit)

## Coding Patterns
- All config validated with zod at startup — fail fast on bad config
- Use pino child loggers per module: `logger.child({ module: 'ingestion' })`
- Providers implement `JobProvider` interface from `src/ingestion/providers/base.ts`
- Use `Promise.allSettled` for parallel provider fetches
- Use explicit `.js` extensions in relative imports (ESM requirement)
- All async operations must have error handling

## Commands
- `npm run dev` — Run locally with tsx
- `npm run build` — Compile TypeScript
- `npx tsc --noEmit` — Type check
- `npm run db:generate` — Generate Drizzle migrations
- `npm run db:migrate` — Apply migrations
- `docker compose up postgres` — Start DB only (for local dev)
- `docker compose up` — Start full stack
