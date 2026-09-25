import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { ProfileController } from '../src/controllers/profile.controller';
import { ProfileService } from '../src/services/profile.service';
import type { ProfileRepository } from '../src/repositories/profile.repository';
import type { AIModelAdapter } from '../src/adapters/ai/ai.adapter';

// Smoke test for the scaffold. Add your own tests next to it (TODO 19).

function startTestServer() {
  const service = new ProfileService({} as ProfileRepository, {} as AIModelAdapter);
  const app = createApp({ profileController: new ProfileController(service) });
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://localhost:${port}` };
}

test('GET /health returns ok', async () => {
  const { server, baseUrl } = startTestServer();
  try {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
  } finally {
    server.close();
  }
});
