import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FallbackResumeAdapter } from '../src/adapters/ai/fallback-resume.adapter';
import type { AIModelAdapter } from '../src/adapters/ai/ai.adapter';
import { AppError, UnreadableResumeError } from '../src/utils/errors';

const FILE = { fileName: 'cv.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') };
const quiet = { info() {}, warn() {} };

const returning = (name: string): AIModelAdapter => ({ parseResume: async () => ({ name }) });
const failing = (err: Error): AIModelAdapter => ({
  parseResume: async () => {
    throw err;
  },
});

test('fallback adapter: the AI result is used when the AI call works', async () => {
  const adapter = new FallbackResumeAdapter(returning('From AI'), returning('From basic parser'), 'fake/model', quiet);
  assert.deepEqual(await adapter.parseResume(FILE), { name: 'From AI' });
});

test('fallback adapter: the basic parser takes over when the AI call fails', async () => {
  const adapter = new FallbackResumeAdapter(failing(new Error('429 Too Many Requests')), returning('From basic parser'), 'fake/model', quiet);
  assert.deepEqual(await adapter.parseResume(FILE), { name: 'From basic parser' });
});

test('fallback adapter: when neither can read the file, the client gets RESUME_UNREADABLE', async () => {
  const adapter = new FallbackResumeAdapter(failing(new UnreadableResumeError()), failing(new UnreadableResumeError()), 'fake/model', quiet);
  await assert.rejects(adapter.parseResume(FILE), (err: unknown) => err instanceof AppError && err.code === 'RESUME_UNREADABLE');
});
