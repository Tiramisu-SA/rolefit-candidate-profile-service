import { Router } from 'express';
import type { ProfileController } from '../controllers/profile.controller';

/**
 * Public REST routes, mounted under /api/profiles.
 */
export function createProfileRouter(controller: ProfileController): Router {
  const router = Router();

  router.post('/', controller.createProfile);
  router.post('/import-resume', controller.importResume);
  router.post('/:candidateId/confirm', controller.confirmProfile);
  router.put('/:candidateId', controller.updateProfile);
  router.delete('/:candidateId/skills/:skillName', controller.deleteSkill);
  router.get('/:candidateId', controller.getProfile);

  return router;
}
