/**
 * Types for the AI Model Adapter.
 *
 * These describe what the adapter RETURNS to the service layer. They must not
 * leak provider-specific shapes (OpenAI/Gemini/Claude response formats).
 */

export interface ParseResumeInput {
  resumeText: string;
}

/**
 * Structured data extracted from a resume.
 * TODO 12: Define the fields you expect the AI to extract. They will usually
 * map onto (a subset of) your CandidateProfile fields.
 */
export interface ParsedResume {
  // TODO 12
}
