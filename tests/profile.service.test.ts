import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileService } from '../src/services/profile.service';
import { computeExperienceMonths } from '../src/services/experience-months';
import { InMemoryProfileRepository } from './fakes/in-memory-profile.repository';
import { fakeAiAdapter } from './fakes/fake-ai.adapter';
import { AppError, ValidationError } from '../src/utils/errors';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TODAY = new Date('2026-09-27T12:00:00Z');

function makeService() {
  const repo = new InMemoryProfileRepository();
  return { repo, service: new ProfileService(repo, fakeAiAdapter, () => TODAY) };
}

async function rejectsWithCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => err instanceof AppError && err.code === code);
}

// --- experience months -------------------------------------------------------

test('months: one full year counts as 12 months', () => {
  assert.equal(computeExperienceMonths([{ startDate: '2024-01-01', endDate: '2024-12-31', isCurrent: false }], '2026-09-27'), 12);
});

test('months: overlapping jobs are not counted twice', () => {
  const rows = [
    { startDate: '2024-01-01', endDate: '2024-12-31', isCurrent: false },
    { startDate: '2024-07-01', endDate: '2025-06-30', isCurrent: false },
  ];
  assert.equal(computeExperienceMonths(rows, '2026-09-27'), 18);
});

test('months: a current role runs until today, and rows without a start date count as zero', () => {
  const rows = [
    { startDate: '2026-03-27', endDate: null, isCurrent: true },
    { startDate: null, endDate: '2020-01-01', isCurrent: false },
  ];
  assert.equal(computeExperienceMonths(rows, '2026-09-27'), 6);
});

// --- profile ------------------------------------------------------------------

test('getProfile without a profile throws PROFILE_NOT_FOUND', async () => {
  const { service } = makeService();
  await rejectsWithCode(service.getProfile(USER), 'PROFILE_NOT_FOUND');
});

test('createProfile creates an unverified profile; a second create is a conflict', async () => {
  const { service } = makeService();
  const p = await service.createProfile(USER, { name: 'Pim' });
  assert.equal(p.name, 'Pim');
  assert.equal(p.userId, USER);
  assert.equal(p.verified, false);
  await rejectsWithCode(service.createProfile(USER, { name: 'Pim' }), 'PROFILE_ALREADY_EXISTS');
});

test('createProfile validates the body', async () => {
  const { service } = makeService();
  await assert.rejects(service.createProfile(USER, { name: '' }), ValidationError);
});

test('updateBasics changes only the sent fields and keeps verified', async () => {
  const { service } = makeService();
  await service.confirmProfile(USER, { name: 'Pim', headline: 'Dev', skills: [], experience: [], education: [], projects: [], preferences: null });
  const p = await service.updateBasics(USER, { headline: null, location: 'Bangkok' });
  assert.equal(p.name, 'Pim');
  assert.equal(p.headline, null);
  assert.equal(p.location, 'Bangkok');
  assert.equal(p.verified, true);
});

test('deleteProfile removes the profile', async () => {
  const { service } = makeService();
  await service.createProfile(USER, { name: 'Pim' });
  await service.deleteProfile(USER);
  await rejectsWithCode(service.getProfile(USER), 'PROFILE_NOT_FOUND');
  await rejectsWithCode(service.deleteProfile(USER), 'PROFILE_NOT_FOUND');
});

// --- children -------------------------------------------------------------------

test('every child operation needs a profile', async () => {
  const { service } = makeService();
  await rejectsWithCode(service.listChildren(USER, 'skills'), 'PROFILE_NOT_FOUND');
  await rejectsWithCode(service.addChild(USER, 'projects', { name: 'X' }), 'PROFILE_NOT_FOUND');
  await rejectsWithCode(service.savePreferences(USER, { employmentTypes: ['FULL_TIME'] }), 'PROFILE_NOT_FOUND');
});

test('child CRUD round trip, and another user cannot touch the row', async () => {
  const { service } = makeService();
  await service.createProfile(USER, { name: 'Pim' });
  await service.createProfile(OTHER, { name: 'Other' });

  const project = await service.addChild(USER, 'projects', { name: 'RoleFit', tech: ['Next.js'] });
  assert.deepEqual(await service.listChildren(USER, 'projects'), [project]);

  const updated = await service.updateChild(USER, 'projects', project.id, { name: 'RoleFit 2' });
  assert.equal(updated.name, 'RoleFit 2');

  await rejectsWithCode(service.updateChild(OTHER, 'projects', project.id, { name: 'Hijack' }), 'PROJECT_NOT_FOUND');
  await rejectsWithCode(service.deleteChild(OTHER, 'projects', project.id), 'PROJECT_NOT_FOUND');
  await rejectsWithCode(service.deleteChild(USER, 'projects', 'not-a-uuid'), 'PROJECT_NOT_FOUND');

  await service.deleteChild(USER, 'projects', project.id);
  assert.deepEqual(await service.listChildren(USER, 'projects'), []);
});

test('skills are unique ignoring case, on add and on update', async () => {
  const { service } = makeService();
  await service.createProfile(USER, { name: 'Pim' });
  await service.addChild(USER, 'skills', { name: 'React' });
  const go = await service.addChild(USER, 'skills', { name: 'Go' });
  await rejectsWithCode(service.addChild(USER, 'skills', { name: 'react' }), 'DUPLICATE_SKILL');
  await rejectsWithCode(service.updateChild(USER, 'skills', go.id, { name: 'REACT' }), 'DUPLICATE_SKILL');
  // Renaming a skill to itself with different case is fine.
  const renamed = await service.updateChild(USER, 'skills', go.id, { name: 'GO', proficiencyLevel: 'ADVANCED' });
  assert.equal(renamed.name, 'GO');
});

test('experience writes recalculate totalExperienceMonths', async () => {
  const { service } = makeService();
  await service.createProfile(USER, { name: 'Pim' });
  const exp = await service.addChild(USER, 'experience', { companyName: 'A', jobTitle: 'Dev', startDate: '2024-01-01', endDate: '2024-12-31' });
  assert.equal((await service.getProfile(USER)).totalExperienceMonths, 12);
  await service.updateChild(USER, 'experience', exp.id, { companyName: 'A', jobTitle: 'Dev', startDate: '2024-01-01', endDate: '2024-06-30' });
  assert.equal((await service.getProfile(USER)).totalExperienceMonths, 6);
  await service.deleteChild(USER, 'experience', exp.id);
  assert.equal((await service.getProfile(USER)).totalExperienceMonths, 0);
});

test('child writes bump updatedAt', async () => {
  const { service, repo } = makeService();
  const created = await service.createProfile(USER, { name: 'Pim' });
  repo.clockOffsetMs = 60_000;
  await service.addChild(USER, 'skills', { name: 'Go' });
  const after = await service.getProfile(USER);
  assert.ok(after.updatedAt.getTime() > created.updatedAt.getTime());
});

test('preferences: save creates then updates; delete removes; get after delete is not found', async () => {
  const { service } = makeService();
  await service.createProfile(USER, { name: 'Pim' });
  await rejectsWithCode(service.getPreferences(USER), 'PREFERENCES_NOT_FOUND');
  await service.savePreferences(USER, { employmentTypes: ['FULL_TIME'] });
  const updated = await service.savePreferences(USER, { employmentTypes: ['INTERNSHIP'], salaryCurrency: 'THB' });
  assert.deepEqual(updated.employmentTypes, ['INTERNSHIP']);
  assert.deepEqual((await service.getPreferences(USER)).salaryCurrency, 'THB');
  await service.deletePreferences(USER);
  await rejectsWithCode(service.getPreferences(USER), 'PREFERENCES_NOT_FOUND');
  await rejectsWithCode(service.deletePreferences(USER), 'PREFERENCES_NOT_FOUND');
});

// --- import / confirm -------------------------------------------------------------

test('importResume returns the parsed document without saving anything', async () => {
  const { service } = makeService();
  const result = await service.importResume(USER, { fileName: 'cv.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') });
  assert.equal(result.fileName, 'cv.pdf');
  assert.ok(result.profile.name.length > 0);
  await rejectsWithCode(service.getProfile(USER), 'PROFILE_NOT_FOUND');
});

test('importResume rejects empty files and unsupported types', async () => {
  const { service } = makeService();
  await rejectsWithCode(service.importResume(USER, { fileName: 'cv.pdf', contentType: 'application/pdf', content: Buffer.alloc(0) }), 'EMPTY_FILE');
  await rejectsWithCode(service.importResume(USER, { fileName: 'cv.png', contentType: 'image/png', content: Buffer.from('x') }), 'UNSUPPORTED_FILE_TYPE');
});

test('confirmProfile creates a verified profile, and a second confirm replaces children', async () => {
  const { service } = makeService();
  const doc = {
    name: 'Pim',
    skills: [{ name: 'React' }, { name: 'Go' }],
    experience: [{ companyName: 'A', jobTitle: 'Dev', startDate: '2024-01-01', endDate: '2024-12-31' }],
    education: [{ institutionName: 'CU', degree: 'B.Eng.' }],
    projects: [{ name: 'X' }],
    preferences: { employmentTypes: ['FULL_TIME'] },
  };
  const first = await service.confirmProfile(USER, doc);
  assert.equal(first.verified, true);
  assert.equal(first.totalExperienceMonths, 12);
  assert.equal(first.skills.length, 2);

  const second = await service.confirmProfile(USER, { ...doc, skills: [{ name: 'Rust' }], preferences: null });
  assert.equal(second.id, first.id);
  assert.deepEqual(second.skills.map((s) => s.name), ['Rust']);
  assert.equal(second.experience.length, 1);
  assert.equal(second.preferences, null);
});

test('getProfileById rejects a non-UUID id and throws not found for an unknown one', async () => {
  const { service } = makeService();
  await assert.rejects(service.getProfileById('abc'), ValidationError);
  await rejectsWithCode(service.getProfileById('33333333-3333-4333-8333-333333333333'), 'PROFILE_NOT_FOUND');
  const p = await service.createProfile(USER, { name: 'Pim' });
  assert.equal((await service.getProfileById(p.id)).userId, USER);
});

test('totalExperienceMonths for a current role keeps growing without new writes', async () => {
  const repo = new InMemoryProfileRepository();
  let now = new Date('2026-09-27T12:00:00Z');
  const service = new ProfileService(repo, fakeAiAdapter, () => now);
  await service.confirmProfile(USER, {
    name: 'Pim', skills: [], education: [], projects: [], preferences: null,
    experience: [{ companyName: 'A', jobTitle: 'Dev', startDate: '2026-03-27', isCurrent: true }],
  });
  assert.equal((await service.getProfile(USER)).totalExperienceMonths, 6);
  now = new Date('2026-12-27T12:00:00Z');
  const later = await service.getProfile(USER);
  assert.equal(later.totalExperienceMonths, 9);
  assert.equal((await service.getProfileById(later.id)).totalExperienceMonths, 9);
});
