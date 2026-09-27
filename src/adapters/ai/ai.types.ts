import type { ProfileData } from '../../types/profile.types';

/**
 * Types for the AI Model Adapter.
 *
 * These describe what the adapter RETURNS to the service layer. They must not
 * leak provider-specific shapes (OpenAI/Gemini/Claude response formats).
 */

/** The uploaded resume file. */
export interface ParseResumeInput {
  fileName: string;
  /** e.g. 'application/pdf' */
  mimeType: string;
  content: Buffer;
}

/**
 * Structured data extracted from a resume: the same fields a candidate can
 * fill in. The AI can miss or get things wrong, so an adapter must still
 * return every field (use '' or [] when nothing was found).
 * TODO 12: decide how an adapter should handle missing or invalid values.
 */
export type ParsedResume = ProfileData;
