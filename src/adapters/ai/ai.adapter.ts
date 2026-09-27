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
 * Placeholder used until a real provider is connected: returns the same
 * sample resume for any file, so the import -> review -> confirm flow works
 * end to end. A real adapter goes in its own class (TODO 20).
 */
export class PlaceholderAIModelAdapter implements AIModelAdapter {
  async parseResume(_input: ParseResumeInput): Promise<ParsedResume> {
    return {
      name: 'Pimchanok Srisuk',
      headline: 'Frontend Developer · Bangkok, Thailand',
      email: 'pimchanok.srisuk@example.com',
      location: 'Bangkok, Thailand',
      links: ['https://github.com/pimchanoks', 'https://linkedin.com/in/pimchanok-srisuk'],
      summary:
        'Frontend developer with one year of internship experience building React and TypeScript dashboards. ' +
        'Focused on accessible, well-tested components and clear data presentation.',
      skills: [
        { name: 'React', proficiencyLevel: 'INTERMEDIATE' },
        { name: 'TypeScript', proficiencyLevel: 'INTERMEDIATE' },
        { name: 'Next.js', proficiencyLevel: 'BASIC' },
        { name: 'Tailwind CSS', proficiencyLevel: 'INTERMEDIATE' },
        { name: 'REST APIs', proficiencyLevel: 'INTERMEDIATE' },
        { name: 'Git', proficiencyLevel: 'INTERMEDIATE' },
        { name: 'Jest', proficiencyLevel: 'BASIC' },
        { name: 'Figma', proficiencyLevel: 'BASIC' },
      ],
      experience: [
        {
          companyName: 'Webcraft Agency',
          jobTitle: 'Frontend Intern',
          startDate: '2025-06-01',
          endDate: '2026-05-31',
          isCurrent: false,
          bullets: [
            'Built 12 reusable React + TypeScript components for a client analytics dashboard',
            'Integrated REST APIs and added loading and error states across 6 pages',
            'Took part in weekly code reviews and sprint planning',
          ],
        },
      ],
      education: [
        { institutionName: 'Chulalongkorn University', degree: 'B.Eng.', fieldOfStudy: 'Computer Engineering', gpa: 3.42, year: '2026' },
      ],
      projects: [
        { name: 'RoleFit Dashboard', tech: ['Next.js', 'Tailwind CSS'], bullets: ['Designed and built a job-matching dashboard with filters and charts'] },
        { name: 'Campus Events App', tech: ['React', 'Firebase'], bullets: ['Event discovery app used by student clubs to publish and manage events'] },
      ],
      preferences: {
        employmentTypes: ['FULL_TIME', 'INTERNSHIP'],
        preferredRoles: ['Frontend Developer'],
        workArrangements: ['HYBRID', 'REMOTE'],
        preferredLocations: ['Bangkok'],
        minimumSalary: 30000,
        salaryCurrency: 'THB',
      },
    };
  }
}
