import express, { type Express } from 'express';
import type { ProfileController } from './controllers/profile.controller';
import { createProfileRouter } from './routes/profile.routes';
import { cors } from './middleware/cors.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

export interface AppDependencies {
  profileController: ProfileController;
  /** The web frontend origin allowed by CORS, e.g. http://localhost:3000. */
  corsOrigin: string;
}

/**
 * Builds the Express app (REST API). Does not listen on a port, which keeps it
 * easy to test.
 */
export function createApp({ profileController, corsOrigin }: AppDependencies): Express {
  const app = express();

  app.use(cors(corsOrigin));
  // A confirmed profile with many bullets can exceed the 100 kb default.
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'candidate-profile-service' });
  });

  app.use('/api/profiles', createProfileRouter(profileController));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
