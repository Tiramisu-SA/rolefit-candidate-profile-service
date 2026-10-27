import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameFromFileName, repairDocument } from '../src/adapters/ai/repair-document';

const EMPTY = { headline: null, summary: null, email: null, location: null, links: [], skills: [], experience: [], education: [], projects: [], preferences: null };

const job = (extra: Record<string, unknown>) => ({ companyName: 'Lanna Tech', jobTitle: 'Intern', ...extra });

test('repair: a valid document comes back unchanged', () => {
  const doc = {
    name: 'Somchai Jaidee',
    headline: 'Backend Developer',
    summary: null,
    email: 'somchai@example.com',
    location: 'Chiang Mai',
    links: ['https://github.com/somchaij'],
    skills: [{ name: 'Go', proficiencyLevel: 'BASIC' }],
    experience: [{ companyName: 'Lanna Tech', jobTitle: 'Intern', startDate: '2025-06-01', endDate: '2025-12-01', isCurrent: false, bullets: ['Built APIs'] }],
    education: [{ institutionName: 'CMU', degree: 'B.Eng.', fieldOfStudy: null, gpa: 3.51, year: '2026' }],
    projects: [{ name: 'Campus Market', tech: ['React'], bullets: [] }],
    preferences: null,
  };
  assert.deepEqual(repairDocument(doc, 'Fallback'), doc);
});

test('repair: something that is not an object becomes an empty profile with the fallback name', () => {
  assert.deepEqual(repairDocument('not json', 'Fallback'), { name: 'Fallback', ...EMPTY });
  assert.deepEqual(repairDocument({ name: '  ' }, 'Fallback'), { name: 'Fallback', ...EMPTY });
});

test('repair: month-only, year-only and month-name dates become the first day', () => {
  const out = repairDocument({ name: 'A', experience: [job({ startDate: '2024-06', endDate: 'Dec 2025' }), job({ startDate: '2023' })] }, 'F');
  assert.equal(out.experience[0].startDate, '2024-06-01');
  assert.equal(out.experience[0].endDate, '2025-12-01');
  assert.equal(out.experience[1].startDate, '2023-01-01');
});

test('repair: an end date of "Present" marks the role as current', () => {
  const out = repairDocument({ name: 'A', experience: [job({ startDate: '2025-01-01', endDate: 'Present' })] }, 'F');
  assert.equal(out.experience[0].endDate, null);
  assert.equal(out.experience[0].isCurrent, true);
});

test('repair: impossible date combinations lose the bad date', () => {
  const out = repairDocument(
    {
      name: 'A',
      experience: [
        job({ startDate: '2025-01-01', endDate: '2025-06-01', isCurrent: true }),
        job({ startDate: '2025-06-01', endDate: '2025-01-01' }),
        job({ startDate: '2999-01-01' }),
        job({ startDate: '2025-13' }),
      ],
    },
    'F',
  );
  assert.deepEqual(
    out.experience.map((e) => [e.startDate, e.endDate]),
    [['2025-01-01', null], ['2025-06-01', null], [null, null], [null, null]],
  );
});

test('repair: entries missing a required field are dropped, the rest are kept', () => {
  const out = repairDocument(
    {
      name: 'A',
      skills: [{ name: '' }, { name: 'Go' }],
      experience: [{ jobTitle: 'No company' }, job({})],
      education: [{ institutionName: 'CMU' }],
      projects: [{ tech: ['React'] }, { name: 'Kept' }],
    },
    'F',
  );
  assert.deepEqual(out.skills, [{ name: 'Go', proficiencyLevel: null }]);
  assert.deepEqual(out.experience.map((e) => e.companyName), ['Lanna Tech']);
  assert.deepEqual(out.education, []);
  assert.deepEqual(out.projects.map((p) => p.name), ['Kept']);
});

test('repair: skills given as plain strings become skill entries', () => {
  const out = repairDocument({ name: 'A', skills: ['TypeScript', 'Go'] }, 'F');
  assert.deepEqual(out.skills, [{ name: 'TypeScript', proficiencyLevel: null }, { name: 'Go', proficiencyLevel: null }]);
});

test('repair: fixable values are fixed and unfixable ones become empty', () => {
  const out = repairDocument(
    {
      name: 'A',
      email: 'not-an-email',
      links: ['github.com/somchaij', 'https://ok.example', 'mailto:x@y.z', 42],
      skills: [{ name: 'Go', proficiencyLevel: 'intermediate' }, { name: 'Rust', proficiencyLevel: 'expert' }],
      education: [
        { institutionName: 'CMU', degree: 'B.Eng.', gpa: '3.51 / 4.00', year: 'Class of 2026' },
        { institutionName: 'KU', degree: 'M.Sc.', gpa: 85, year: 'soon' },
      ],
    },
    'F',
  );
  assert.equal(out.email, null);
  assert.deepEqual(out.links, ['https://github.com/somchaij', 'https://ok.example']);
  assert.deepEqual(out.skills.map((s) => s.proficiencyLevel), ['INTERMEDIATE', null]);
  assert.deepEqual(out.education.map((e) => [e.gpa, e.year]), [[3.51, '2026'], [null, null]]);
});

test('repair: text over the limit is cut, and lists over the limit keep their first items', () => {
  const out = repairDocument(
    { name: 'A', summary: 'x'.repeat(6000), skills: Array.from({ length: 120 }, (_, i) => ({ name: `Skill ${i}` })) },
    'F',
  );
  assert.equal(out.summary?.length, 5000);
  assert.equal(out.skills.length, 100);
  assert.equal(out.skills[99].name, 'Skill 99');
});

test('repair: preferences with any problem are dropped (the candidate sets them on review)', () => {
  assert.equal(repairDocument({ name: 'A', preferences: { preferredRoles: ['Dev'] } }, 'F').preferences, null);
  const kept = repairDocument({ name: 'A', preferences: { employmentTypes: ['FULL_TIME'] } }, 'F').preferences;
  assert.deepEqual(kept?.employmentTypes, ['FULL_TIME']);
});

test('nameFromFileName: uses the file name without resume words, or a prompt to fill it in', () => {
  assert.equal(nameFromFileName('Somchai_Jaidee_Resume_2026.pdf'), 'Somchai Jaidee');
  assert.equal(nameFromFileName('pim-srisuk-cv.final.docx'), 'Pim Srisuk');
  assert.equal(nameFromFileName('resume.pdf'), 'Your name');
});
