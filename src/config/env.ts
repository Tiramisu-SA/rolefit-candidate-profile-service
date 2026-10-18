import fs from 'node:fs';
import dotenv from 'dotenv';

// .env.local wins over .env (dotenv never overrides a variable that is already set).
dotenv.config({ path: ['.env.local', '.env'], quiet: true });

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
  /** Web frontend origin allowed by CORS. */
  corsOrigin: string;
  /** Supabase Auth project URL used to verify access tokens. */
  supabaseUrl: string;
  /** Supabase publishable key used for Auth verification; never a service role key. */
  supabasePublishableKey: string;
  /**
   * 'jwt' (default): verify Supabase tokens. 'mock': trust the X-User-Id header,
   * for local testing while the frontend still sends mock ids. Not allowed in production.
   */
  authMode: 'jwt' | 'mock';
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
    supabaseUrl: process.env.SUPABASE_URL?.trim() ?? '',
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? '',
    authMode: process.env.AUTH_MODE?.trim() === 'mock' ? 'mock' : 'jwt',
  };

  const rawAuthMode = process.env.AUTH_MODE?.trim();
  if (rawAuthMode && rawAuthMode !== 'jwt' && rawAuthMode !== 'mock') {
    errors.push(`AUTH_MODE must be "jwt" or "mock" (got "${rawAuthMode}")`);
  }
  if (config.authMode === 'mock' && config.nodeEnv === 'production') {
    errors.push('AUTH_MODE=mock is not allowed when NODE_ENV=production');
  }

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
