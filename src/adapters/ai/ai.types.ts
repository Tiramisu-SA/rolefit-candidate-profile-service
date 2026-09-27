/**
 * Types for the AI Model Adapter.
 *
 * These describe what the adapter RETURNS to the service layer. They must not
 * leak provider-specific shapes (OpenAI/Gemini/Claude response formats).
 */

export interface ParseResumeInput {
  fileName: string;
  contentType: string;
  content: Buffer;
}

/**
 * Structured data extracted from a resume, in the same shape as a confirm
 * request body. ProfileService validates it before returning it, so an
 * adapter may return loosely-typed data.
 */
export type ParsedResume = unknown;
