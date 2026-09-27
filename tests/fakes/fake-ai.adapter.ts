import type { AIModelAdapter } from '../../src/adapters/ai/ai.adapter';

/** Returns a tiny fixed resume for any file. */
export const fakeAiAdapter: AIModelAdapter = {
  async parseResume() {
    return {
      name: 'Parsed Person',
      skills: [{ name: 'TypeScript' }],
      experience: [],
      education: [],
      projects: [],
      preferences: null,
    };
  },
};
