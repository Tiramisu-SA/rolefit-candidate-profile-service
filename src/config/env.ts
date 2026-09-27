import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export interface EnvConfig {
  nodeEnv: string;
  /** Port for the public REST API (web frontend). */
  restPort: number;
  /** Port for the internal gRPC API (other RoleFit services). */
  grpcPort: number;
  /** PostgreSQL (Supabase) connection string. Only this service may use it. */
  databaseUrl: string;
  /** Use SSL for the database connection (required by Supabase). */
  databaseSsl: boolean;
  /** Optional path to the Supabase CA certificate, used to verify the server. */
  databaseSslCaPath: string;
  /** Web frontend origin allowed to call the REST API from the browser (CORS). */
  corsOrigin: string;
}

/** Every problem found while reading the environment, reported together. */
const errors: string[] = [];

function readPort(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`${name} must be a whole number between 1 and 65535 (got "${raw}")`);
  }
  return port;
}

function readRequired(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value === '') errors.push(`${name} is required`);
  return value;
}

function readBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  errors.push(`${name} must be "true" or "false" (got "${raw}")`);
  return defaultValue;
}

function loadEnv(): EnvConfig {
  const config: EnvConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    restPort: readPort('REST_PORT', 3001),
    grpcPort: readPort('GRPC_PORT', 50051),
    databaseUrl: readRequired('DATABASE_URL'),
    databaseSsl: readBoolean('DATABASE_SSL', true),
    databaseSslCaPath: process.env.DATABASE_SSL_CA_PATH?.trim() ?? '',
    corsOrigin: process.env.CORS_ORIGIN?.trim() || 'http://localhost:3000',
  };

  if (config.databaseUrl && !/^postgres(ql)?:\/\//.test(config.databaseUrl)) {
    errors.push('DATABASE_URL must start with postgres:// or postgresql://');
  }
  if (config.restPort === config.grpcPort) {
    errors.push('REST_PORT and GRPC_PORT must be different');
  }
  if (config.databaseSslCaPath && !fs.existsSync(config.databaseSslCaPath)) {
    errors.push(`DATABASE_SSL_CA_PATH file not found: ${config.databaseSslCaPath}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}

/** Validated configuration. Importing this module fails fast on bad config. */
export const env: EnvConfig = loadEnv();
