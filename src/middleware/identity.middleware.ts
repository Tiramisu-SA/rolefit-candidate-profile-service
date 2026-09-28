import type { NextFunction, Request, Response } from 'express';
import type { ClaimsVerifier } from '../auth/supabase';
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
 * AUTH_MODE=mock only (local testing while the frontend still sends mock ids):
 * trusts the `X-User-Id` header (a UUID). Never enable this in production.
 */
export function identifyFromHeader(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.get('x-user-id');
  if (!isUuid(userId)) {
    next(new UnauthenticatedError('Missing or invalid X-User-Id header'));
    return;
  }
  req.userId = userId;
  next();
}

/** Verify the bearer token and derive profile ownership from its signed subject. */
export function identify(verifyClaims: ClaimsVerifier) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authorization = req.get('authorization') ?? '';
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!match) {
      next(new UnauthenticatedError());
      return;
    }

    try {
      const claims = await verifyClaims(match[1]);
      if (!claims || typeof claims.sub !== 'string' || !isUuid(claims.sub)) {
        next(new UnauthenticatedError());
        return;
      }
      req.userId = claims.sub;
      next();
    } catch {
      next(new UnauthenticatedError());
    }
  };
}
