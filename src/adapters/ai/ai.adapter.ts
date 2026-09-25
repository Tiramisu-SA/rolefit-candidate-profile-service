import { NotImplementedError } from '../../utils/errors';
import type { ParseResumeInput, ParsedResume } from './ai.types';

/**
 * AI Model Adapter (port).
 *
 * The service layer depends on this interface only. Concrete implementations
 * hide which external AI/LLM provider is used, so it can be swapped without
 * touching ProfileService.
 *
 * This is a module inside the Candidate Profile Service, not a microservice.
 */
export interface AIModelAdapter {
  parseResume(input: ParseResumeInput): Promise<ParsedResume>;
}

/**
 * Placeholder implementation used until a real provider is connected.
 */
export class PlaceholderAIModelAdapter implements AIModelAdapter {
  async parseResume(input: ParseResumeInput): Promise<ParsedResume> {
    // TODO 13: Return a fake/deterministic ParsedResume so you can build and
    // test importResume() without calling a real AI provider.
    //
    // TODO 20 (later): Create a separate adapter class that calls a real
    // LLM provider and validates its output before returning it.
    void input;
    throw new NotImplementedError('AIModelAdapter.parseResume');
  }
}
