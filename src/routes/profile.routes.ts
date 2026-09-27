import express, { Router } from 'express';
import type { ProfileController } from '../controllers/profile.controller';
import { MAX_RESUME_BYTES } from '../services/profile.service';
import type { ChildKind } from '../types/profile.types';

const CHILD_KINDS: ChildKind[] = ['skills', 'experience', 'education', 'projects'];

/**
 * Public REST routes, mounted under /api/profiles. Every route works on the
 * caller's own profile ("me"), identified by the verified JWT subject.
 */
export function createProfileRouter(controller: ProfileController): Router {
  const router = Router();

  router.post('/me', controller.createProfile);
  router.get('/me', controller.getProfile);
  router.patch('/me', controller.updateBasics);
  router.delete('/me', controller.deleteProfile);

  // Raw body for any content type; ProfileService decides which types are allowed.
  router.post('/me/import-resume', express.raw({ type: () => true, limit: MAX_RESUME_BYTES }), controller.importResume);
  router.post('/me/confirm', controller.confirmProfile);

  router.get('/me/preferences', controller.getPreferences);
  router.put('/me/preferences', controller.savePreferences);
  router.delete('/me/preferences', controller.deletePreferences);

  for (const kind of CHILD_KINDS) {
    router.get(`/me/${kind}`, controller.listChildren(kind));
    router.post(`/me/${kind}`, controller.addChild(kind));
    router.put(`/me/${kind}/:id`, controller.updateChild(kind));
    router.delete(`/me/${kind}/:id`, controller.deleteChild(kind));
  }

  return router;
}
