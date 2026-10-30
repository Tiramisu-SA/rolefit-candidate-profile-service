import type { AIModelAdapter } from './ai.adapter';
import type { ParseResumeInput, ParsedResume } from './ai.types';
import { nameFromFileName, repairDocument } from './repair-document';
import { extractResumeText } from './resume-text';

/**
 * One request to a language model: instructions plus the user's text, the
 * reply as plain text. Each provider gets a small class in ./clients; this
 * is the only thing the adapter knows about them.
 */
export interface LlmClient {
  /** "provider/model", for logs. */
  readonly label: string;
  complete(system: string, user: string): Promise<string>;
}

/**
 * Resume parser backed by a language model. The model only sees the
 * extracted text, so every provider gets the same input, and its reply is
 * repaired like any other parser output before ProfileService validates it.
 */
export class LlmResumeAdapter implements AIModelAdapter {
  constructor(private readonly client: LlmClient) {}

  async parseResume(input: ParseResumeInput): Promise<ParsedResume> {
    const text = await extractResumeText(input);
    const reply = await this.client.complete(RESUME_INSTRUCTIONS, `<resume>\n${text}\n</resume>`);
    return repairDocument(parseJsonObject(reply), nameFromFileName(input.fileName));
  }
}

/** Takes the outermost {...} so code fences or a sentence around it don't matter. */
function parseJsonObject(reply: string): Record<string, unknown> {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const value: unknown = JSON.parse(reply.slice(start, end + 1));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // fall through to the error below
    }
  }
  throw new Error(`The AI reply did not contain a JSON object: ${reply.slice(0, 200)}`);
}

const RESUME_INSTRUCTIONS = `You read resumes and turn them into structured profile data for a job-matching site. The candidate reviews and corrects your output before it is saved, so leave a field empty rather than guess.

Reply with one JSON object and nothing else, in exactly this shape:
{
  "name": string,
  "headline": string | null,
  "summary": string | null,
  "email": string | null,
  "location": string | null,
  "links": string[],
  "skills": [{ "name": string, "proficiencyLevel": "BASIC" | "INTERMEDIATE" | "ADVANCED" | null }],
  "experience": [{ "companyName": string, "jobTitle": string, "startDate": "YYYY-MM-DD" | null, "endDate": "YYYY-MM-DD" | null, "isCurrent": boolean, "bullets": string[] }],
  "education": [{ "institutionName": string, "degree": string, "fieldOfStudy": string | null, "gpa": number | null, "year": "YYYY" | null }],
  "projects": [{ "name": string, "tech": string[], "bullets": string[] }],
  "preferences": null
}

Rules:
- Use only what the resume says. Missing information is null or an empty list.
- headline is the candidate's own title line (for example "Frontend Developer"), not a past job.
- Dates: with only a month and year, use the 1st of that month; with only a year, use January 1st. An ongoing role has "isCurrent": true and "endDate": null.
- gpa only when it is on a 0-4 scale, otherwise null. year is the graduation year.
- links are full URLs starting with https:// (add it if the resume leaves it out).
- proficiencyLevel only when the resume states a level, otherwise null.
- Copy bullets as written, one per achievement or duty. Keep the resume's language.
- preferences is always null: the candidate sets them separately.`;
