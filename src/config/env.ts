import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_ALERT_CHANNEL_ID: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  RUN_INGESTION_ON_STARTUP: z.string().transform(v => v === 'true').default('false'),

  // Google Sheets & Drive (optional — Phase 3)
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SHEET_ID: z.string().optional(),
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),

  // Email (optional — Phase 3)
  SMTP_HOST: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_TO: z.string().optional(),

  // Adzuna (optional — Phase 4)
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),

  // Coresignal (optional — needed if coresignal provider is enabled in providers.yml)
  CORESIGNAL_API_KEY: z.string().optional(),

  // Bright Data (optional — needed if brightdata provider is enabled in providers.yml)
  BRIGHTDATA_API_TOKEN: z.string().optional(),

  // SerpApi (optional — needed if serpapi provider is enabled in providers.yml)
  SERPAPI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
