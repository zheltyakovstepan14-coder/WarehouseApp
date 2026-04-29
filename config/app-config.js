const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_ENV_FILES = ['.env', '.env.local', '.env.example'];

function parseEnvFile(content) {
  const result = {};

  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value.replace(/\\n/g, '\n');
  }

  return result;
}

function loadEnvFiles() {
  for (const fileName of DEFAULT_ENV_FILES) {
    const filePath = path.join(projectRoot, fileName);
    if (!fs.existsSync(filePath)) continue;

    const values = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function getBooleanEnv(name, defaultValue = false) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(rawValue).trim().toLowerCase());
}

function getNumberEnv(name, defaultValue) {
  const rawValue = process.env[name];
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

loadEnvFiles();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const databaseUrl = process.env.DATABASE_URL ? String(process.env.DATABASE_URL).trim() : '';
const rawJwtSecret = process.env.JWT_SECRET ? String(process.env.JWT_SECRET).trim() : '';
const jwtSecret = rawJwtSecret || (isProduction ? '' : 'dev-only-insecure-jwt-secret');

if (!rawJwtSecret && !isProduction) {
  console.warn('[config] JWT_SECRET is not set. Using an insecure development fallback secret.');
}

const config = {
  nodeEnv,
  isProduction,
  port: getNumberEnv('PORT', 3002),
  auth: {
    jwtSecret,
    tokenExpiresIn: process.env.JWT_EXPIRES_IN || '1h'
  },
  db: {
    connectionString: databaseUrl || undefined,
    max: getNumberEnv('PG_POOL_MAX', 10),
    idleTimeoutMillis: getNumberEnv('PG_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: getNumberEnv('PG_CONNECTION_TIMEOUT_MS', 5000),
    statementTimeoutMs: getNumberEnv('PG_STATEMENT_TIMEOUT_MS', 12000)
  },
  startup: {
    autoCreateSchema: getBooleanEnv('AUTO_CREATE_SCHEMA', true),
    autoSeed: getBooleanEnv('AUTO_SEED_DATA', false)
  }
};

module.exports = {
  config,
  parseEnvFile,
  getBooleanEnv,
  getNumberEnv
};
