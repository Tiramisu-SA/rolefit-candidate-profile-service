import { Router } from 'express';
import type { ProfileController } from '../controllers/profile.controller';

/**
 * Public REST routes, mounted under /api/profiles.
 */
export function createProfileRouter(controller: ProfileController): Router {
  const router = Router();

  router.post('/import-resume', controller.importResume);
  router.post('/confirm', controller.confirmProfile);
  router.put('/:candidateId', controller.updateProfile);
  router.get('/:candidateId', controller.getProfile);

  return router;
}
