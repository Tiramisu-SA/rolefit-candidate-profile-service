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

export interface FieldError {
  /** Path of the invalid field, e.g. `experience[2].endDate`. */
  field: string;
  message: string;
}

export class ValidationError extends AppError {
  constructor(
    public readonly details: FieldError[],
    message = 'Some fields are invalid',
  ) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class MalformedJsonError extends AppError {
  constructor() {
    super('The request body is not valid JSON', 400, 'MALFORMED_JSON');
  }
}

export class EmptyFileError extends AppError {
  constructor() {
    super('The uploaded file is empty', 400, 'EMPTY_FILE');
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Missing or invalid bearer token') {
    super(message, 401, 'UNAUTHENTICATED');
  }
}

/** 404 with a resource-specific code such as PROFILE_NOT_FOUND. */
export class NotFoundError extends AppError {
  constructor(code: string, message: string) {
    super(message, 404, code);
  }
}

/** 409 with a specific code such as DUPLICATE_SKILL. */
export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(message, 409, code);
  }
}

export class FileTooLargeError extends AppError {
  constructor() {
    super('The file is larger than 5 MB', 413, 'FILE_TOO_LARGE');
  }
}

export class UnsupportedFileTypeError extends AppError {
  constructor() {
    super('Upload a PDF or Word document (.pdf, .doc, .docx)', 415, 'UNSUPPORTED_FILE_TYPE');
  }
}

export const profileNotFound = () => new NotFoundError('PROFILE_NOT_FOUND', 'Profile not found');
