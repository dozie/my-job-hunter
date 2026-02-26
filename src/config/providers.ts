import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { z } from 'zod';
import { logger } from '../observability/logger.js';

const boardSchema = z.object({
  token: z.string().optional(),
  name: z.string(),
  label: z.string().optional(),
  country: z.string().optional(),
  keywords: z.string().optional(),
  category: z.string().optional(),
  employmentType: z.string().optional(),
  maxCollect: z.number().int().positive().optional(),
});

const filtersSchema = z.object({
  exclude_titles: z.array(z.string()),
  include_titles: z.array(z.string()),
  location_keywords: z.array(z.string()),
  remote_indicators: z.array(z.string()),
  onsite_indicators: z.array(z.string()),
});

const providersConfigSchema = z.object({
  greenhouse: z.object({
    enabled: z.boolean(),
    boards: z.array(boardSchema),
  }),
  ashby: z.object({
    enabled: z.boolean(),
    boards: z.array(boardSchema),
  }),
  adzuna: z.object({
    enabled: z.boolean(),
    boards: z.array(boardSchema),
  }),
  remotive: z.object({
    enabled: z.boolean(),
    boards: z.array(boardSchema),
  }),
  coresignal: z.object({
    enabled: z.boolean(),
    boards: z.array(boardSchema),
  }),
  brightdata: z.object({
    enabled: z.boolean(),
    boards: z.array(boardSchema),
  }),
  serpapi: z.object({
    enabled: z.boolean(),
    boards: z.array(boardSchema),
  }),
  filters: filtersSchema,
});

export type ProvidersConfig = z.infer<typeof providersConfigSchema>;
export type Board = z.infer<typeof boardSchema>;
export type FiltersConfig = z.infer<typeof filtersSchema>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../../config/providers.yml');

let _config: ProvidersConfig | null = null;

export function loadProvidersConfig(): ProvidersConfig {
  if (_config) return _config;

  const log = logger.child({ module: 'config:providers' });
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = yaml.load(raw);
    _config = providersConfigSchema.parse(parsed);
    log.info(
      {
        greenhouse: _config.greenhouse.boards.length,
        ashby: _config.ashby.boards.length,
        adzuna: _config.adzuna.boards.length,
        remotive: _config.remotive.boards.length,
        coresignal: _config.coresignal.boards.length,
        brightdata: _config.brightdata.boards.length,
        serpapi: _config.serpapi.boards.length,
      },
      'Providers config loaded',
    );
    return _config;
  } catch (err) {
    log.fatal({ err }, 'Failed to load providers config');
    process.exit(1);
  }
}
