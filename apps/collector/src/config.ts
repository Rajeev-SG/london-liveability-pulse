import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AjvImport from 'ajv';
import addFormatsImport from 'ajv-formats';
import YAML from 'yaml';

import type { LiveabilityConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

export function getRepoRoot(): string {
  return repoRoot;
}

export function getDefaultConfigPath(): string {
  return path.join(repoRoot, 'config', 'liveability.yaml');
}

export async function parseConfigYaml(configPath: string): Promise<unknown> {
  const raw = await readFile(configPath, 'utf8');
  return YAML.parse(raw);
}

export async function loadConfigSchema(): Promise<object> {
  const schemaPath = path.join(repoRoot, 'config', 'liveability.schema.json');
  const raw = await readFile(schemaPath, 'utf8');
  return JSON.parse(raw) as object;
}

export async function validateConfigObject(config: unknown): Promise<LiveabilityConfig> {
  const schema = await loadConfigSchema();
  const AjvCtor: any = (AjvImport as any).default ?? AjvImport;
  const addFormats: any = (addFormatsImport as any).default ?? addFormatsImport;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(config)) {
    const details = (validate.errors ?? [])
      .map((e: { instancePath?: string; message?: string }) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    throw new Error(`Config schema validation failed: ${details}`);
  }

  const typed = config as LiveabilityConfig;
  const enabledCount = [
    typed.sources.tfl.enabled,
    typed.sources.openMeteo.enabled,
    typed.sources.ergAirQuality.enabled,
    typed.sources.fhrs.enabled
  ].filter(Boolean).length;
  if (enabledCount < 1) {
    throw new Error('Config semantic validation failed: at least 1 source must be enabled');
  }

  const weights = Object.values(typed.scoring.weights);
  if (weights.some((value) => value < 0)) {
    throw new Error('Config semantic validation failed: weights must be non-negative');
  }
  if (!weights.some((value) => value > 0)) {
    throw new Error('Config semantic validation failed: at least one weight must be > 0');
  }

  const retention = typed.project.historyRetentionDays;
  if (retention < 1 || retention > 30) {
    throw new Error('Config semantic validation failed: historyRetentionDays must be between 1 and 30');
  }

  if (typed.project.collectionIntervalMinutes < 5) {
    throw new Error('Config semantic validation failed: collectionIntervalMinutes must be >= 5 minutes');
  }

  return typed;
}

export async function loadValidatedConfig(configPath = getDefaultConfigPath()): Promise<LiveabilityConfig> {
  const parsed = await parseConfigYaml(configPath);
  return validateConfigObject(parsed);
}
