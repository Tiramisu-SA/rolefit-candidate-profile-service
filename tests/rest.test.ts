import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { ProfileController } from '../src/controllers/profile.controller';
import { ProfileService } from '../src/services/profile.service';
import { InMemoryProfileRepository } from './fakes/in-memory-profile.repository';
import { fakeAiAdapter } from './fakes/fake-ai.adapter';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'http://localhost:3000';

interface CallOptions {
  body?: unknown;
  raw?: Buffer;
  headers?: Record<string, string>;
  subject?: string | null;
  authorization?: string | null;
}

async function withApi(fn: (call: (method: string, path: string, opts?: CallOptions) => Promise<Response>) => Promise<void>) {
  const service = new ProfileService(new InMemoryProfileRepository(), fakeAiAdapter);
  const app = createApp({
    profileController: new ProfileController(service),
    corsOrigin: ORIGIN,
    verifyClaims: async (token) => token.startsWith('test:') ? { sub: token.slice(5) } : null,
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method: string, path: string, opts: CallOptions = {}) => {
    const headers: Record<string, string> = { ...opts.headers };
    const subject = opts.subject === undefined ? USER : opts.subject;
    const authorization = opts.authorization === undefined && subject ? `Bearer test:${subject}` : opts.authorization;
    if (authorization) headers.Authorization = authorization;
    let body: BodyInit | undefined;
    if (opts.raw) body = new Uint8Array(opts.raw);
    else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    return fetch(base + path, { method, headers, body });
  };
  try {
    await fn(call);
  } finally {
    server.close();
  }
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

test('GET /health returns ok', async () => {
  await withApi(async (call) => {
    const res = await call('GET', '/health', { subject: null });
    assert.equal(res.status, 200);
  });
});

test('profile routes require a verified bearer token and ignore X-User-Id', async () => {
  await withApi(async (call) => {
    let res = await call('GET', '/api/profiles/me', { subject: null });
    assert.equal(res.status, 401);
    assert.equal(await errorCode(res), 'UNAUTHENTICATED');
    res = await call('GET', '/api/profiles/me', { authorization: 'Bearer token with spaces' });
    assert.equal(res.status, 401);
    res = await call('GET', '/api/profiles/me', { authorization: 'Bearer expired-token' });
    assert.equal(res.status, 401);
    res = await call('GET', '/api/profiles/me', { subject: 'not-a-uuid' });
    assert.equal(res.status, 401);
    res = await call('GET', '/api/profiles/me', { subject: null, headers: { 'X-User-Id': USER } });
    assert.equal(res.status, 401);
  });
});

test('CORS preflight is answered with 204 and the allowed origin', async () => {
  await withApi(async (call) => {
    const res = await call('OPTIONS', '/api/profiles/me', {
      subject: null,
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /PATCH/);
    assert.match((res.headers.get('access-control-allow-headers') ?? '').toLowerCase(), /authorization/);
  });
});

test('profile lifecycle: create, read, patch, delete', async () => {
  await withApi(async (call) => {
    assert.equal((await call('GET', '/api/profiles/me')).status, 404);

    let res = await call('POST', '/api/profiles/me', { body: { name: 'Pim', links: ['https://github.com/pim'] } });
    assert.equal(res.status, 201);
    const created = (await res.json()) as { name: string; verified: boolean; skills: unknown[]; preferences: unknown };
    assert.equal(created.name, 'Pim');
    assert.equal(created.verified, false);
    assert.deepEqual(created.skills, []);
    assert.equal(created.preferences, null);

    res = await call('POST', '/api/profiles/me', { body: { name: 'Pim' } });
    assert.equal(res.status, 409);
    assert.equal(await errorCode(res), 'PROFILE_ALREADY_EXISTS');

    res = await call('PATCH', '/api/profiles/me', { body: { headline: 'Frontend dev' } });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { headline: string }).headline, 'Frontend dev');

    assert.equal((await call('DELETE', '/api/profiles/me')).status, 204);
    assert.equal((await call('GET', '/api/profiles/me')).status, 404);
  });
});

test('validation errors are 400 with field details', async () => {
  await withApi(async (call) => {
    const res = await call('POST', '/api/profiles/me', { body: { name: '', email: 'nope' } });
    assert.equal(res.status, 400);
    const json = (await res.json()) as { error: { code: string; details: { field: string }[] } };
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(json.error.details.map((d) => d.field), ['name', 'email']);
  });
});

test('malformed JSON is a 400 MALFORMED_JSON, not a 500', async () => {
  await withApi(async (call) => {
    const res = await call('POST', '/api/profiles/me', { raw: Buffer.from('{"name":'), headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 400);
    assert.equal(await errorCode(res), 'MALFORMED_JSON');
  });
});

const CHILD_CASES = [
  { kind: 'skills', create: { name: 'React' }, update: { name: 'React', proficiencyLevel: 'ADVANCED' }, notFound: 'SKILL_NOT_FOUND' },
  { kind: 'experience', create: { companyName: 'A', jobTitle: 'Dev', startDate: '2024-01-01', isCurrent: true }, update: { companyName: 'B', jobTitle: 'Dev' }, notFound: 'EXPERIENCE_NOT_FOUND' },
  { kind: 'education', create: { institutionName: 'CU', degree: 'B.Eng.' }, update: { institutionName: 'CU', degree: 'M.Eng.', year: '2028' }, notFound: 'EDUCATION_NOT_FOUND' },
  { kind: 'projects', create: { name: 'RoleFit' }, update: { name: 'RoleFit', tech: ['Next.js'] }, notFound: 'PROJECT_NOT_FOUND' },
];

for (const c of CHILD_CASES) {
  test(`${c.kind}: create, list, update, delete; another user gets 404`, async () => {
    await withApi(async (call) => {
      assert.equal(await errorCode(await call('GET', `/api/profiles/me/${c.kind}`)), 'PROFILE_NOT_FOUND');
      await call('POST', '/api/profiles/me', { body: { name: 'Pim' } });
      await call('POST', '/api/profiles/me', { body: { name: 'Other' }, subject: OTHER });

      let res = await call('POST', `/api/profiles/me/${c.kind}`, { body: c.create });
      assert.equal(res.status, 201);
      const { id } = (await res.json()) as { id: string };

      res = await call('GET', `/api/profiles/me/${c.kind}`);
      assert.equal(((await res.json()) as unknown[]).length, 1);

      res = await call('PUT', `/api/profiles/me/${c.kind}/${id}`, { body: c.update });
      assert.equal(res.status, 200);

      res = await call('PUT', `/api/profiles/me/${c.kind}/${id}`, { body: c.update, subject: OTHER });
      assert.equal(res.status, 404);
      assert.equal(await errorCode(res), c.notFound);
      res = await call('DELETE', `/api/profiles/me/${c.kind}/${id}`, { subject: OTHER });
      assert.equal(res.status, 404);

      assert.equal((await call('DELETE', `/api/profiles/me/${c.kind}/${id}`)).status, 204);
      assert.equal((await call('DELETE', `/api/profiles/me/${c.kind}/${id}`)).status, 404);
    });
  });
}

test('duplicate skill is a 409', async () => {
  await withApi(async (call) => {
    await call('POST', '/api/profiles/me', { body: { name: 'Pim' } });
    await call('POST', '/api/profiles/me/skills', { body: { name: 'React' } });
    const res = await call('POST', '/api/profiles/me/skills', { body: { name: 'REACT' } });
    assert.equal(res.status, 409);
    assert.equal(await errorCode(res), 'DUPLICATE_SKILL');
  });
});

test('preferences: PUT creates and updates, GET reads, DELETE removes', async () => {
  await withApi(async (call) => {
    await call('POST', '/api/profiles/me', { body: { name: 'Pim' } });
    assert.equal(await errorCode(await call('GET', '/api/profiles/me/preferences')), 'PREFERENCES_NOT_FOUND');
    let res = await call('PUT', '/api/profiles/me/preferences', { body: { employmentTypes: ['FULL_TIME'] } });
    assert.equal(res.status, 200);
    res = await call('PUT', '/api/profiles/me/preferences', { body: { employmentTypes: ['CONTRACT'], workArrangements: ['REMOTE'] } });
    assert.deepEqual(((await res.json()) as { workArrangements: string[] }).workArrangements, ['REMOTE']);
    res = await call('GET', '/api/profiles/me/preferences');
    assert.deepEqual(((await res.json()) as { employmentTypes: string[] }).employmentTypes, ['CONTRACT']);
    assert.equal((await call('DELETE', '/api/profiles/me/preferences')).status, 204);
    assert.equal((await call('DELETE', '/api/profiles/me/preferences')).status, 404);
  });
});

test('import-resume: 415 for other types, 413 over 5 MB, 200 with the file name', async () => {
  await withApi(async (call) => {
    let res = await call('POST', '/api/profiles/me/import-resume', { raw: Buffer.from('x'), headers: { 'Content-Type': 'image/png' } });
    assert.equal(res.status, 415);
    assert.equal(await errorCode(res), 'UNSUPPORTED_FILE_TYPE');

    res = await call('POST', '/api/profiles/me/import-resume', {
      raw: Buffer.alloc(5 * 1024 * 1024 + 1),
      headers: { 'Content-Type': 'application/pdf' },
    });
    assert.equal(res.status, 413);
    assert.equal(await errorCode(res), 'FILE_TOO_LARGE');

    res = await call('POST', '/api/profiles/me/import-resume', {
      raw: Buffer.from('%PDF-1.7'),
      headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('ประวัติ.pdf') },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { fileName: string; profile: { name: string } };
    assert.equal(json.fileName, 'ประวัติ.pdf');
    assert.equal(json.profile.name, 'Parsed Person');
  });
});

test('confirm saves the whole document as a verified profile', async () => {
  await withApi(async (call) => {
    const res = await call('POST', '/api/profiles/me/confirm', {
      body: { name: 'Pim', skills: [{ name: 'Go' }], experience: [], education: [], projects: [], preferences: null },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { verified: boolean; skills: { name: string }[] };
    assert.equal(json.verified, true);
    assert.deepEqual(json.skills.map((s) => s.name), ['Go']);
  });
});

test('unknown routes return 404 ROUTE_NOT_FOUND', async () => {
  await withApi(async (call) => {
    const res = await call('GET', '/api/profiles/me/nope');
    assert.equal(res.status, 404);
    assert.equal(await errorCode(res), 'ROUTE_NOT_FOUND');
  });
});
