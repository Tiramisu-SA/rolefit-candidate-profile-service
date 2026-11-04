import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createApp } from '../src/app';
import { ProfileController } from '../src/controllers/profile.controller';
import { createGrpcServer, startGrpcServer } from '../src/grpc/grpc.server';
import { ProfileService } from '../src/services/profile.service';
import { logger } from '../src/utils/logger';
import { withCapturedLogs } from './fakes/capture-logs';
import { fakeAiAdapter } from './fakes/fake-ai.adapter';
import { InMemoryProfileRepository } from './fakes/in-memory-profile.repository';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const auth = { Authorization: `Bearer test:${USER}` };

const newService = () => new ProfileService(new InMemoryProfileRepository(), fakeAiAdapter);
const errorMessage = (line: Record<string, unknown>) => (line.error as { message?: string } | undefined)?.message;

async function withApi(fn: (base: string) => Promise<void>, service = newService()) {
  const app = createApp({
    profileController: new ProfileController(service),
    corsOrigin: 'http://localhost:3000',
    verifyClaims: async (token) => (token.startsWith('test:') ? { sub: token.slice(5) } : null),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

type GetProfile = (id: string, requestId?: string) => Promise<unknown>;

async function withGrpc(fn: (getProfile: GetProfile) => Promise<void>, service = newService()) {
  const server = createGrpcServer(service);
  const port = await startGrpcServer(server, 0);
  const definition = protoLoader.loadSync(path.resolve(__dirname, '../proto/candidate-profile.proto'), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(definition) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const client = new pkg.rolefit.candidateprofile.v1.CandidateProfileService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const getProfile: GetProfile = (id, requestId) =>
    new Promise((resolve, reject) => {
      const metadata = new grpc.Metadata();
      if (requestId) metadata.set('x-request-id', requestId);
      client.GetProfile({ candidate_id: id }, metadata, (err: grpc.ServiceError | null, res: unknown) => (err ? reject(err) : resolve(res)));
    });
  try {
    await fn(getProfile);
  } finally {
    client.close();
    server.forceShutdown();
  }
}

test('a REST request logs one JSON line with its id, method, path without query, status and duration', async () => {
  await withCapturedLogs(async (logs) => {
    await withApi(async (base) => {
      const res = await fetch(`${base}/api/profiles/me?unused=secret`, { headers: { ...auth, 'X-Request-Id': 'req-abc_1.2' } });
      assert.equal(res.status, 404);
      assert.equal(res.headers.get('x-request-id'), 'req-abc_1.2');

      const line = await logs.waitFor((l) => l.requestId === 'req-abc_1.2');
      assert.equal(line.service, 'candidate-profile');
      assert.equal(line.method, 'GET');
      assert.equal(line.path, '/api/profiles/me');
      assert.equal(line.status, 404);
      assert.equal(typeof line.durationMs, 'number');
    });
  });
});

test('a request with an invalid token is still logged with its id', async () => {
  await withCapturedLogs(async (logs) => {
    await withApi(async (base) => {
      const res = await fetch(`${base}/api/profiles/me`, { headers: { Authorization: 'Bearer nope', 'X-Request-Id': 'req-bad-token' } });
      assert.equal(res.status, 401);
      assert.equal((await logs.waitFor((l) => l.requestId === 'req-bad-token')).status, 401);
    });
  });
});

test('a malformed JSON body is logged with the request id', async () => {
  await withCapturedLogs(async (logs) => {
    await withApi(async (base) => {
      const res = await fetch(`${base}/api/profiles/me`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', 'X-Request-Id': 'req-bad-json' },
        body: '{not json',
      });
      assert.equal(res.status, 400);
      assert.equal((await logs.waitFor((l) => l.requestId === 'req-bad-json')).status, 400);
    });
  });
});

test('a missing or unsafe incoming id is replaced with a generated one', async () => {
  await withCapturedLogs(async (logs) => {
    await withApi(async (base) => {
      for (const incoming of [undefined, 'has spaces', 'x'.repeat(129)]) {
        const res = await fetch(`${base}/api/profiles/me`, { headers: { ...auth, ...(incoming ? { 'X-Request-Id': incoming } : {}) } });
        const id = res.headers.get('x-request-id') ?? '';
        assert.match(id, UUID, `incoming: ${incoming}`);
        await logs.waitFor((l) => l.requestId === id);
      }
    });
  });
});

// Body parsers read the request stream, and their callbacks can run outside the async context of the request.
test('an error after a JSON body is parsed is logged with the request id', async () => {
  const service = newService();
  service.createProfile = async () => {
    throw new Error('boom-json');
  };
  await withCapturedLogs(async (logs) => {
    await withApi(async (base) => {
      const res = await fetch(`${base}/api/profiles/me`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', 'X-Request-Id': 'req-json' },
        body: JSON.stringify({ name: 'Pim' }),
      });
      assert.equal(res.status, 500);
      assert.equal((await logs.waitFor((l) => errorMessage(l) === 'boom-json')).requestId, 'req-json');
    }, service);
  });
});

test('an error after a resume upload is read is logged with the request id', async () => {
  const service = newService();
  service.importResume = async () => {
    throw new Error('boom-upload');
  };
  await withCapturedLogs(async (logs) => {
    await withApi(async (base) => {
      const res = await fetch(`${base}/api/profiles/me/import-resume`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/pdf', 'X-File-Name': 'cv.pdf', 'X-Request-Id': 'req-upload' },
        body: new Uint8Array([1, 2, 3]),
      });
      assert.equal(res.status, 500);
      assert.equal((await logs.waitFor((l) => errorMessage(l) === 'boom-upload')).requestId, 'req-upload');
    }, service);
  });
});

test('overlapping REST requests keep their own ids in error logs', async () => {
  const service = newService();
  service.getProfile = async (userId: string) => {
    await new Promise((resolve) => setTimeout(resolve, userId === USER ? 40 : 5));
    throw new Error(`boom-${userId}`);
  };
  await withCapturedLogs(async (logs) => {
    await withApi(async (base) => {
      const get = (user: string, id: string) => fetch(`${base}/api/profiles/me`, { headers: { Authorization: `Bearer test:${user}`, 'X-Request-Id': id } });
      await Promise.all([get(USER, 'req-slow'), get(OTHER, 'req-fast')]);
      assert.equal((await logs.waitFor((l) => errorMessage(l) === `boom-${USER}`)).requestId, 'req-slow');
      assert.equal((await logs.waitFor((l) => errorMessage(l) === `boom-${OTHER}`)).requestId, 'req-fast');
    }, service);
  });
});

test('a gRPC call logs one JSON line with the caller id, the RPC and its status', async () => {
  const service = newService();
  const profile = await service.createProfile(USER, { name: 'Pim' });
  await withCapturedLogs(async (logs) => {
    await withGrpc(async (getProfile) => {
      await getProfile(profile.id, 'req-grpc-ok');
      await assert.rejects(getProfile(OTHER, 'req-grpc-missing'));

      const ok = await logs.waitFor((l) => l.requestId === 'req-grpc-ok');
      assert.equal(ok.rpc, 'GetProfile');
      assert.equal(ok.grpcStatus, 'OK');
      assert.equal(ok.service, 'candidate-profile');
      assert.equal(typeof ok.durationMs, 'number');
      assert.equal((await logs.waitFor((l) => l.requestId === 'req-grpc-missing')).grpcStatus, 'NOT_FOUND');
    }, service);
  });
});

test('a gRPC call without a safe id gets a generated one', async () => {
  await withCapturedLogs(async (logs) => {
    await withGrpc(async (getProfile) => {
      await assert.rejects(getProfile(USER));
      await assert.rejects(getProfile(USER, 'has spaces'));
      await logs.waitFor((l) => l.rpc === 'GetProfile');
      const ids = logs.lines().filter((l) => l.rpc === 'GetProfile').map((l) => l.requestId);
      assert.equal(ids.length, 2);
      for (const id of ids) assert.match(String(id), UUID);
    });
  });
});

test('an unexpected gRPC error is logged with the id', async () => {
  const service = newService();
  service.getProfileById = async () => {
    throw new Error('boom-grpc');
  };
  await withCapturedLogs(async (logs) => {
    await withGrpc(async (getProfile) => {
      await assert.rejects(getProfile(USER, 'req-grpc-boom'));
      assert.equal((await logs.waitFor((l) => errorMessage(l) === 'boom-grpc')).requestId, 'req-grpc-boom');
    }, service);
  });
});

test('health checks are not logged, so polling does not bury real requests', async () => {
  await withCapturedLogs(async (logs) => {
    await withApi(async (base) => {
      await fetch(`${base}/health`);
      await fetch(`${base}/api/profiles/me`, { headers: auth });
      await logs.waitFor((l) => l.path === '/api/profiles/me');
      assert.equal(logs.lines().filter((l) => l.path === '/health').length, 0);
    });
  });
});

test('the logger writes an Error as JSON and survives values JSON cannot represent', async () => {
  await withCapturedLogs(async (logs) => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.error('It failed', new TypeError('bad input'));
    logger.error('Circular detail', circular);
    const error = (await logs.waitFor((l) => l.message === 'It failed')).error as { name: string; message: string };
    assert.equal(error.name, 'TypeError');
    assert.equal(error.message, 'bad input');
    await logs.waitFor((l) => l.message === 'Circular detail');
  });
});
