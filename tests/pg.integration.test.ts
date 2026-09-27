import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import '../src/config/database'; // registers the DATE type parser
import { PostgresProfileRepository } from '../src/repositories/postgres-profile.repository';
import { ProfileService } from '../src/services/profile.service';
import { PlaceholderAIModelAdapter } from '../src/adapters/ai/ai.adapter';
import { AppError } from '../src/utils/errors';

// Runs only against a real database that has migrations 001-003 applied:
//   TEST_DATABASE_URL=postgresql://... npm test
// Set TEST_DATABASE_SSL=false for a local Postgres without SSL.
const url = process.env.TEST_DATABASE_URL;

test('Postgres repository: profile and child CRUD round trip', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  const pool = new Pool({
    connectionString: url,
    ssl: process.env.TEST_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 2,
  });
  const service = new ProfileService(new PostgresProfileRepository(pool), new PlaceholderAIModelAdapter());
  const user = randomUUID();
  try {
    await service.createProfile(user, { name: 'Integration Test', links: ['https://example.com'] });
    const skill = await service.addChild(user, 'skills', { name: 'Postgres', proficiencyLevel: 'BASIC' });
    await assert.rejects(
      service.addChild(user, 'skills', { name: 'postgres' }),
      (err: unknown) => err instanceof AppError && err.code === 'DUPLICATE_SKILL',
    );
    await service.addChild(user, 'experience', { companyName: 'A', jobTitle: 'Dev', startDate: '2024-01-01', endDate: '2024-12-31' });
    await service.addChild(user, 'education', { institutionName: 'CU', degree: 'B.Eng.', gpa: 3.25, year: '2026' });
    await service.savePreferences(user, { employmentTypes: ['FULL_TIME'], minimumSalary: 30000, salaryCurrency: 'THB' });

    const profile = await service.getProfile(user);
    assert.equal(profile.totalExperienceMonths, 12);
    assert.equal(profile.experience[0].startDate, '2024-01-01');
    assert.equal(profile.education[0].gpa, 3.25);
    assert.equal(profile.preferences?.minimumSalary, 30000);

    await service.updateChild(user, 'skills', skill.id, { name: 'PostgreSQL' });
    const confirmed = await service.confirmProfile(user, (await service.importResume(user, {
      fileName: 'cv.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF'),
    })).profile);
    assert.equal(confirmed.verified, true);
    assert.ok(!confirmed.skills.some((s) => s.name === 'PostgreSQL'));
  } finally {
    await service.deleteProfile(user).catch(() => undefined);
    await pool.end();
  }
});
