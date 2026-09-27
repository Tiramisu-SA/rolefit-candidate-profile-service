import { ValidationError } from './errors';

/** Matches a UUID like 'fcc54871-6c40-4f4f-b427-3e21c4c746bc'. this is standard pattern*/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** true if `value` looks like a UUID. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Throws a ValidationError (400) unless `value` is a UUID. */
export function assertUuid(value: string, fieldName: string): void {
  if (!isUuid(value)) {
    throw new ValidationError(`${fieldName} must be a valid UUID`);
  }
}

/** Throws a ValidationError (400) unless `value` is a string with visible text. */
export function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${fieldName} must be a non-empty string`);
  }
}

/** Throws a ValidationError (400) unless `value` is a plain object ({...}). */
export function assertObject(value: unknown, fieldName: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an object`);
  }
}
