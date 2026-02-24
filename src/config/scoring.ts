import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { z } from 'zod';
import { logger } from '../observability/logger.js';

const scoringConfigSchema = z.object({
  weights: z.object({
    remote_eligible: z.number(),
    seniority_match: z.number(),
    employer_location: z.number(),
    interview_style: z.number(),
    role_type: z.number(),
  }),
  role_type_preferences: z.record(z.string(), z.number()),
  interview_preferences: z.record(z.string(), z.number()),
  target_seniority: z.array(z.string()),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../../config/scoring.yml');

let _config: ScoringConfig | null = null;

export function loadScoringConfig(bypassCache = false): ScoringConfig {
  if (_config && !bypassCache) return _config;

  const log = logger.child({ module: 'config:scoring' });
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = yaml.load(raw);
    _config = scoringConfigSchema.parse(parsed);
    log.info('Scoring config loaded');
    return _config;
  } catch (err) {
    log.fatal({ err }, 'Failed to load scoring config');
    process.exit(1);
  }
}
