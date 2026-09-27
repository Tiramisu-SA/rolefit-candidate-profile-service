import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createGrpcServer, startGrpcServer } from '../src/grpc/grpc.server';
import { ProfileService } from '../src/services/profile.service';
import { InMemoryProfileRepository } from './fakes/in-memory-profile.repository';
import { fakeAiAdapter } from './fakes/fake-ai.adapter';

const USER = '11111111-1111-4111-8111-111111111111';

type GetProfile = (req: { candidate_id: string }, cb: (err: grpc.ServiceError | null, res?: any) => void) => void;

async function withGrpc(fn: (getProfile: (id: string) => Promise<any>, service: ProfileService) => Promise<void>) {
  const service = new ProfileService(new InMemoryProfileRepository(), fakeAiAdapter);
  const server = createGrpcServer(service);
  const port = await startGrpcServer(server, 0);

  const def = protoLoader.loadSync(path.resolve(__dirname, '../proto/candidate-profile.proto'), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as any;
  const client = new pkg.rolefit.candidateprofile.v1.CandidateProfileService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const getProfile = (id: string) =>
    new Promise((resolve, reject) => (client.GetProfile as GetProfile).call(client, { candidate_id: id }, (err, res) => (err ? reject(err) : resolve(res))));
  try {
    await fn(getProfile, service);
  } finally {
    client.close();
    server.forceShutdown();
  }
}

test('GetProfile maps the profile to the proto message', async () => {
  await withGrpc(async (getProfile, service) => {
    const p = await service.confirmProfile(USER, {
      name: 'Pim',
      location: 'Bangkok',
      skills: [{ name: 'React', proficiencyLevel: 'ADVANCED' }],
      experience: [{ companyName: 'A', jobTitle: 'Dev', startDate: '2024-01-01', endDate: '2024-12-31' }],
      education: [{ institutionName: 'CU', degree: 'B.Eng.', gpa: 3.5, year: '2026' }],
      projects: [{ name: 'X', tech: ['Go'] }],
      preferences: { employmentTypes: ['FULL_TIME'], workArrangements: ['REMOTE'], minimumSalary: 30000, salaryCurrency: 'THB' },
    });
    const { profile } = await getProfile(p.id);
    assert.equal(profile.candidate_id, p.id);
    assert.equal(profile.candidate_id, USER);
    assert.equal('user_id' in profile, false);
    assert.equal(profile.name, 'Pim');
    assert.equal(profile.total_experience_months, 12);
    assert.equal(profile.verified, true);
    assert.deepEqual(profile.skills, [{ name: 'React', proficiency_level: 'ADVANCED' }]);
    assert.equal(profile.experience[0].start_date, '2024-01-01');
    assert.equal(profile.education[0].gpa, 3.5);
    assert.deepEqual(profile.projects[0].tech, ['Go']);
    assert.deepEqual(profile.preferences.work_arrangements, ['REMOTE']);
    assert.equal(profile.preferences.minimum_salary, 30000);
  });
});

test('GetProfile returns NOT_FOUND for an unknown id', async () => {
  await withGrpc(async (getProfile) => {
    await assert.rejects(getProfile('33333333-3333-4333-8333-333333333333'), (err: grpc.ServiceError) => err.code === grpc.status.NOT_FOUND);
  });
});

test('GetProfile returns INVALID_ARGUMENT for a non-UUID id', async () => {
  await withGrpc(async (getProfile) => {
    await assert.rejects(getProfile('abc'), (err: grpc.ServiceError) => err.code === grpc.status.INVALID_ARGUMENT);
  });
});
