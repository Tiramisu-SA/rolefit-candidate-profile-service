import type { NextFunction, Request, Response } from 'express';
import { AppError, FileTooLargeError, MalformedJsonError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

/** 404 for unknown routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `${req.method} ${req.path} not found` } });
}

/** Errors raised by Express body parsers carry a `type`. */
function fromBodyParser(err: unknown): AppError | null {
  const type = (err as { type?: unknown })?.type;
  if (type === 'entity.parse.failed') return new MalformedJsonError();
  if (type === 'entity.too.large') return new FileTooLargeError();
  return null;
}

/**
 * Converts thrown errors into JSON HTTP responses:
 * `{ error: { code, message, details? } }`. Unknown errors are logged and
 * answered with a generic 500 so internal details never leak.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const appError = err instanceof AppError ? err : fromBodyParser(err);
  if (appError) {
    const details = appError instanceof ValidationError ? { details: appError.details } : {};
    res.status(appError.httpStatus).json({ error: { code: appError.code, message: appError.message, ...details } });
    return;
  }

  logger.error('Unhandled error', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
