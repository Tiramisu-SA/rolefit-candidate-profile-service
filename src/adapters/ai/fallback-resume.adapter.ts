import { logger } from '../../utils/logger';
import type { AIModelAdapter } from './ai.adapter';
import type { ParseResumeInput, ParsedResume } from './ai.types';

/**
 * Tries the AI parser first and switches to the basic parser when the AI
 * call fails (timeout, rate limit, unusable reply), so an upload never fails
 * just because the provider is down. The log says which one handled it.
 */
export class FallbackResumeAdapter implements AIModelAdapter {
  constructor(
    private readonly primary: AIModelAdapter,
    private readonly fallback: AIModelAdapter,
    private readonly primaryLabel: string,
    private readonly log: Pick<typeof logger, 'info' | 'warn'> = logger,
  ) {}

  async parseResume(input: ParseResumeInput): Promise<ParsedResume> {
    try {
      const parsed = await this.primary.parseResume(input);
      this.log.info(`Resume "${input.fileName}" parsed by ${this.primaryLabel}`);
      return parsed;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn(`${this.primaryLabel} could not parse "${input.fileName}" (${reason}); using the basic parser`);
      return this.fallback.parseResume(input);
    }
  }
}
