import type { NextFunction, Request, Response } from 'express';
import { UnauthenticatedError } from '../utils/errors';
import { isUuid } from '../validation/profile.validation';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The caller's user id, set by `identify`. */
      userId?: string;
    }
  }
}

/**
 * Mock identity: trusts the `X-User-Id` header (a UUID) because real auth is
 * not wired yet. When it is, only this middleware changes: verify the JWT and
 * set `req.userId` from its subject.
 */
export function identify(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.get('x-user-id');
  if (!isUuid(userId)) throw new UnauthenticatedError();
  req.userId = userId;
  next();
}
