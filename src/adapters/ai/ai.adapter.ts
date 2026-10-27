import type { ParseResumeInput, ParsedResume } from './ai.types';

/**
 * AI Model Adapter (port).
 *
 * The service layer depends on this interface only. Concrete implementations
 * hide which external AI/LLM provider is used, so it can be swapped without
 * touching ProfileService:
 *   - LlmResumeAdapter: a language model (provider chosen with AI_PROVIDER)
 *   - BasicResumeAdapter: library-only parsing, no AI
 *   - FallbackResumeAdapter: the first, falling back to the second on failure
 *
 * This is a module inside the Candidate Profile Service, not a microservice.
 */
export interface AIModelAdapter {
  parseResume(input: ParseResumeInput): Promise<ParsedResume>;
}
