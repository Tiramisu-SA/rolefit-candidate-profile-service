import fs from 'node:fs';
import { Pool, types, type PoolConfig } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

// Return DATE columns as 'YYYY-MM-DD' strings. The default parses them into a
// JS Date at local midnight, which shifts the day in non-UTC timezones.
types.setTypeParser(types.builtins.DATE, (value) => value);

/**
 * Creates the PostgreSQL connection pool for the Supabase database.
 *
 * Supabase is plain PostgreSQL, so we connect with `pg` using the connection
 * string from the Supabase dashboard (not with supabase-js).
 *
 * pg.Pool connects lazily, so creating it does NOT open a connection. That is
 * why server.ts calls checkDatabaseConnection() right after creating it.
 *
 * Only this service's repositories may use this pool. No other RoleFit service
 * may connect to this database. They must go through the gRPC API instead.
 */
export function createDatabasePool(): Pool {
  const pool = new Pool({
    connectionString: env.databaseUrl,
    ssl: buildSslConfig(),
    // Supabase limits connections per project (the free plan's pooler allows
    // only a few per client), so keep this small. 5 is plenty for this service.
    max: 5,
    // Close connections that have been unused for 30 s.
    idleTimeoutMillis: 30_000,
    // Give up if a new connection can't be opened within 10 s, instead of
    // hanging a request forever when Supabase is unreachable.
    connectionTimeoutMillis: 10_000,
  });

  // An idle connection can break (network drop, Supabase restart). pg reports
  // that as an 'error' event on the pool; without a listener Node would crash
  // the whole process. The pool drops the broken connection and opens a new
  // one on the next query, so logging is enough here.
  pool.on('error', (err) => {
    logger.error('Idle database connection error', err.message);
  });

  return pool;
}

function buildSslConfig(): PoolConfig['ssl'] {
  if (!env.databaseSsl) return false;

  if (env.databaseSslCaPath) {
    // Full verification against Supabase's CA certificate.
    return { ca: fs.readFileSync(env.databaseSslCaPath, 'utf8') };
  }

  // Encrypted, but the server certificate is not verified. Supabase signs its
  // certificates with its own CA, which Node does not trust by default.
  logger.warn('DATABASE_SSL_CA_PATH not set: database certificate will not be verified');
  return { rejectUnauthorized: false };
}

/**
 * Verifies that the database is reachable. Call it once on startup.
 */
export async function checkDatabaseConnection(pool: Pool): Promise<void> {
  try {
    const result = await pool.query<{ database: string; version: string }>(
      'SELECT current_database() AS database, version() AS version',
    );
    const { database, version } = result.rows[0];
    logger.info(`Connected to database "${database}" (${version.split(',')[0]})`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot connect to the database: ${reason}`);
  }
}
