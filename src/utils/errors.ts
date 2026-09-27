/**
 * Base error type for this service.
 *
 * Both the REST error middleware and the gRPC handlers translate AppErrors
 * into protocol-specific responses (HTTP status / gRPC status code), so the
 * service layer never needs to know which protocol called it.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown by every placeholder in the scaffold. Maps to HTTP 501 / gRPC UNIMPLEMENTED. */
export class NotImplementedError extends AppError {
  constructor(what: string) {
    super(`${what} is not implemented yet`, 501, 'NOT_IMPLEMENTED');
  }
}

// TODO 8: Add the domain errors your service needs (for example "profile not
// found" and "invalid input"), each with a suitable HTTP status and code.

/** The requested profile doesn't exist. Maps to HTTP 404. */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND');       // HTTP status for "not found"? code e.g. 'NOT_FOUND'
  }
}

/** The request is malformed (missing field, wrong type...). Maps to HTTP 400. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

