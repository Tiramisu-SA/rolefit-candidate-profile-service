import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BasicResumeAdapter, parseResumeText } from '../src/adapters/ai/basic-resume.adapter';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name));

// The same resume as tests/fixtures/resume.pdf and resume.docx.
const SOMCHAI = {
  name: 'Somchai Jaidee',
  headline: 'Backend Developer',
  summary: 'Backend developer who builds Node.js and PostgreSQL services.',
  email: 'somchai.jaidee@example.com',
  location: 'Chiang Mai, Thailand',
  links: ['https://github.com/somchaij', 'https://linkedin.com/in/somchai-jaidee'],
  skills: [
    { name: 'TypeScript', proficiencyLevel: null },
    { name: 'Node.js', proficiencyLevel: null },
    { name: 'PostgreSQL', proficiencyLevel: null },
    { name: 'Docker', proficiencyLevel: null },
  ],
  experience: [
    {
      companyName: 'Lanna Tech',
      jobTitle: 'Software Engineer Intern',
      startDate: '2025-06-01',
      endDate: '2025-12-01',
      isCurrent: false,
      bullets: ['Built REST endpoints for an inventory system', 'Wrote integration tests with Jest'],
    },
  ],
  education: [{ institutionName: 'Chiang Mai University', degree: 'B.Eng.', fieldOfStudy: 'Computer Engineering', gpa: 3.51, year: '2026' }],
  projects: [{ name: 'Campus Market', tech: [], bullets: ['Marketplace app for students'] }],
  preferences: null,
};

test('basic adapter: reads the PDF fixture into a full profile', async () => {
  const out = await new BasicResumeAdapter().parseResume({ fileName: 'cv.pdf', contentType: 'application/pdf', content: fixture('resume.pdf') });
  assert.deepEqual(out, SOMCHAI);
});

test('basic adapter: reads the .docx fixture into the same profile', async () => {
  const out = await new BasicResumeAdapter().parseResume({
    fileName: 'cv.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content: fixture('resume.docx'),
  });
  assert.deepEqual(out, SOMCHAI);
});

test('basic parser: skills split on commas, bullets and "Label:" prefixes', () => {
  const out = parseResumeText('Pim\n\nTechnical Skills:\n- TypeScript\n• Go · Rust\nLanguages: Thai, English') as { skills: { name: string }[] };
  assert.deepEqual(out.skills.map((s) => s.name), ['TypeScript', 'Go', 'Rust', 'Thai', 'English']);
});

test('basic parser: several jobs, "Title at Company", dates on the title line and current roles', () => {
  const text = [
    'Pim',
    'WORK EXPERIENCE',
    'Frontend Developer at Webcraft | Jan 2026 – Present',
    '• Shipped the dashboard',
    'Intern — Lanna Tech',
    '06/2025 - 12/2025',
    '- Wrote tests',
    '- Fixed bugs',
  ].join('\n');
  const out = parseResumeText(text) as { experience: unknown[] };
  assert.deepEqual(out.experience, [
    { jobTitle: 'Frontend Developer', companyName: 'Webcraft', startDate: '2026-01-01', endDate: null, isCurrent: true, bullets: ['Shipped the dashboard'] },
    { jobTitle: 'Intern', companyName: 'Lanna Tech', startDate: '2025-06-01', endDate: '2025-12-01', isCurrent: false, bullets: ['Wrote tests', 'Fixed bugs'] },
  ]);
});

test('basic parser: education with "Bachelor of ... in ..." and the institution on the same line', () => {
  const out = parseResumeText('Pim\nEducation\nBachelor of Science in Computer Science, Kasetsart University, 2024\nGPA: 3.8') as { education: unknown[] };
  assert.deepEqual(out.education, [
    { institutionName: 'Kasetsart University', degree: 'Bachelor of Science', fieldOfStudy: 'Computer Science', gpa: 3.8, year: '2024' },
  ]);
});

test('basic parser: project names carry their tech in brackets', () => {
  const out = parseResumeText('Pim\nProjects\nRoleFit Dashboard (Next.js, Tailwind CSS)\n- Job-matching dashboard\nCampus Events App\n- Event discovery') as { projects: unknown[] };
  assert.deepEqual(out.projects, [
    { name: 'RoleFit Dashboard', tech: ['Next.js', 'Tailwind CSS'], bullets: ['Job-matching dashboard'] },
    { name: 'Campus Events App', tech: [], bullets: ['Event discovery'] },
  ]);
});

test('basic parser: a resume with no headings still gives the name, email and links', () => {
  const out = parseResumeText('  Pim Srisuk  \npim@example.com · github.com/pims\nI like building things.') as Record<string, unknown>;
  assert.equal(out.name, 'Pim Srisuk');
  assert.equal(out.email, 'pim@example.com');
  assert.deepEqual(out.links, ['github.com/pims']);
});
