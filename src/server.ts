import { env } from './config/env';
import { createClaimsVerifier } from './auth/supabase';
import { checkDatabaseConnection, createDatabasePool } from './config/database';
import { PostgresProfileRepository } from './repositories/postgres-profile.repository';
import { PlaceholderAIModelAdapter } from './adapters/ai/ai.adapter';
import { ProfileService } from './services/profile.service';
import { ProfileController } from './controllers/profile.controller';
import { createApp } from './app';
import { createGrpcServer, startGrpcServer } from './grpc/grpc.server';
import { logger } from './utils/logger';

/**
 * Composition root: the only place where concrete classes are wired together.
 * REST and gRPC receive the SAME ProfileService instance.
 */
async function main(): Promise<void> {
  // AUTH_MODE=mock skips token verification and trusts X-User-Id (local testing only).
  const verifyClaims =
    env.authMode === 'jwt' ? createClaimsVerifier(env.supabaseUrl, env.supabasePublishableKey) : undefined;
  if (!verifyClaims) {
    logger.warn('AUTH_MODE=mock: trusting the X-User-Id header. Do not use this outside local development.');
  }

  // Infrastructure
  const pool = createDatabasePool();
  // Fail fast: without its database this service can't do anything useful, so
  // don't start the REST/gRPC servers. A process manager (Docker restart
  // policy, Kubernetes) can then restart it until the database is reachable.
  await checkDatabaseConnection(pool);

  const profileRepository = new PostgresProfileRepository(pool);
  const aiModelAdapter = new PlaceholderAIModelAdapter();

  // Business layer (shared)
  const profileService = new ProfileService(profileRepository, aiModelAdapter);

  // REST API (public, for the web frontend)
  const app = createApp({
    profileController: new ProfileController(profileService),
    corsOrigin: env.corsOrigin,
    verifyClaims,
  });
  const httpServer = app.listen(env.restPort, () => {
    logger.info(`REST API listening on http://localhost:${env.restPort}`);
  });

  // gRPC API (internal, for other RoleFit services)
  const grpcServer = createGrpcServer(profileService);
  const grpcPort = await startGrpcServer(grpcServer, env.grpcPort);
  logger.info(`gRPC API listening on 0.0.0.0:${grpcPort}`);

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    httpServer.close();
    grpcServer.tryShutdown(() => {
      pool.end().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Failed to start Candidate Profile Service', err);
  process.exit(1);
});
