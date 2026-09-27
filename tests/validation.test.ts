import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBasics,
  validateDocument,
  validateEducation,
  validateExperience,
  validatePreferences,
  validateProject,
  validateSkill,
} from '../src/validation/profile.validation';
import { ValidationError } from '../src/utils/errors';

/** Runs fn, expects a ValidationError, returns its field paths. */
function failingFields(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ValidationError, `expected ValidationError, got ${String(err)}`);
    return err.details.map((d) => d.field);
  }
  assert.fail('expected a ValidationError');
}

test('basics: trims strings and turns empty optional strings into null', () => {
  const out = validateBasics({ name: '  Pim  ', headline: '  ', summary: '', email: ' a@b.co ', links: [' https://x.dev ', ''] });
  assert.deepEqual(out, {
    name: 'Pim',
    headline: null,
    summary: null,
    email: 'a@b.co',
    location: null,
    links: ['https://x.dev'],
  });
});

test('basics: name is required and limited to 200 characters', () => {
  assert.deepEqual(failingFields(() => validateBasics({ name: '   ' })), ['name']);
  assert.deepEqual(failingFields(() => validateBasics({ name: 'x'.repeat(201) })), ['name']);
});

test('basics: rejects a bad email and a non-http link', () => {
  assert.deepEqual(
    failingFields(() => validateBasics({ name: 'P', email: 'not-an-email', links: ['ftp://x.dev'] })),
    ['email', 'links[0]'],
  );
});

test('basics: rejects a body that is not an object', () => {
  assert.deepEqual(failingFields(() => validateBasics(['x'])), ['body']);
});

test('basics partial: returns only the fields that were sent, and name cannot be null', () => {
  assert.deepEqual(validateBasics({ headline: 'Dev' }, { partial: true }), { headline: 'Dev' });
  assert.deepEqual(validateBasics({ summary: null }, { partial: true }), { summary: null });
  assert.deepEqual(failingFields(() => validateBasics({ name: null }, { partial: true })), ['name']);
});

test('skill: accepts a known proficiency and rejects an unknown one', () => {
  assert.deepEqual(validateSkill({ name: ' React ', proficiencyLevel: 'ADVANCED' }), { name: 'React', proficiencyLevel: 'ADVANCED' });
  assert.deepEqual(validateSkill({ name: 'Go' }), { name: 'Go', proficiencyLevel: null });
  assert.deepEqual(failingFields(() => validateSkill({ name: 'Go', proficiencyLevel: 'GURU' })), ['proficiencyLevel']);
});

test('experience: isCurrent with an endDate is rejected at endDate', () => {
  const fields = failingFields(() =>
    validateExperience({ companyName: 'A', jobTitle: 'B', startDate: '2024-01-01', endDate: '2024-06-01', isCurrent: true }),
  );
  assert.deepEqual(fields, ['endDate']);
});

test('experience: endDate before startDate is rejected', () => {
  const fields = failingFields(() =>
    validateExperience({ companyName: 'A', jobTitle: 'B', startDate: '2024-06-01', endDate: '2024-01-01', isCurrent: false }),
  );
  assert.deepEqual(fields, ['endDate']);
});

test('experience: a start date in the future or an impossible date is rejected', () => {
  assert.deepEqual(
    failingFields(() => validateExperience({ companyName: 'A', jobTitle: 'B', startDate: '2999-01-01', isCurrent: true })),
    ['startDate'],
  );
  assert.deepEqual(
    failingFields(() => validateExperience({ companyName: 'A', jobTitle: 'B', startDate: '2024-02-30', isCurrent: true })),
    ['startDate'],
  );
});

test('experience: defaults isCurrent to false and bullets to an empty list', () => {
  assert.deepEqual(validateExperience({ companyName: 'A', jobTitle: 'B' }), {
    companyName: 'A',
    jobTitle: 'B',
    startDate: null,
    endDate: null,
    isCurrent: false,
    bullets: [],
  });
});

test('experience: more than 20 bullets is rejected', () => {
  const bullets = Array.from({ length: 21 }, (_, i) => `b${i}`);
  assert.deepEqual(failingFields(() => validateExperience({ companyName: 'A', jobTitle: 'B', bullets })), ['bullets']);
});

test('education: gpa must be 0-4 and year must be 4 digits', () => {
  assert.deepEqual(
    failingFields(() => validateEducation({ institutionName: 'CU', degree: 'B.Eng.', gpa: 5, year: '26' })),
    ['gpa', 'year'],
  );
  assert.deepEqual(validateEducation({ institutionName: 'CU', degree: 'B.Eng.', gpa: 3.5, year: '2026' }), {
    institutionName: 'CU',
    degree: 'B.Eng.',
    fieldOfStudy: null,
    gpa: 3.5,
    year: '2026',
  });
});

test('project: name required, tech items limited to 100 characters', () => {
  assert.deepEqual(failingFields(() => validateProject({ name: '', tech: ['x'.repeat(101)] })), ['name', 'tech[0]']);
});

test('preferences: needs at least one employment type and valid enum values', () => {
  assert.deepEqual(failingFields(() => validatePreferences({ employmentTypes: [] })), ['employmentTypes']);
  assert.deepEqual(
    failingFields(() => validatePreferences({ employmentTypes: ['FULL_TIME'], workArrangements: ['OFFICE'] })),
    ['workArrangements[0]'],
  );
});

test('preferences: salary must be >= 0 and currency 3 uppercase letters', () => {
  assert.deepEqual(
    failingFields(() => validatePreferences({ employmentTypes: ['FULL_TIME'], minimumSalary: -1, salaryCurrency: 'baht' })),
    ['minimumSalary', 'salaryCurrency'],
  );
});

test('document: de-duplicates skills ignoring case (first spelling wins)', () => {
  const doc = validateDocument({
    name: 'P',
    skills: [{ name: 'React' }, { name: 'react', proficiencyLevel: 'BASIC' }, { name: 'Go' }],
    experience: [],
    education: [],
    projects: [],
    preferences: null,
  });
  assert.deepEqual(
    doc.skills.map((s) => s.name),
    ['React', 'Go'],
  );
});

test('document: reports nested field paths', () => {
  const fields = failingFields(() =>
    validateDocument({
      name: 'P',
      skills: [],
      experience: [
        { companyName: 'A', jobTitle: 'B' },
        { companyName: 'A', jobTitle: 'B', startDate: '2024-06-01', endDate: '2024-01-01' },
      ],
      education: [],
      projects: [],
      preferences: { employmentTypes: [] },
    }),
  );
  assert.deepEqual(fields, ['experience[1].endDate', 'preferences.employmentTypes']);
});
