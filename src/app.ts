import express, { type Express } from 'express';
import cors from 'cors';
import { env } from './config/env';
import type { ProfileController } from './controllers/profile.controller';
import { createProfileRouter } from './routes/profile.routes';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

export interface AppDependencies {
  profileController: ProfileController;
}

/**
 * Builds the Express app (REST API). Does not listen on a port, which keeps it
 * easy to test.
 */
export function createApp({ profileController }: AppDependencies): Express {
  const app = express();

  // Allow the web frontend (a different origin) to call this API from the browser.
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'candidate-profile-service' });
  });

  app.use('/api/profiles', createProfileRouter(profileController));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
