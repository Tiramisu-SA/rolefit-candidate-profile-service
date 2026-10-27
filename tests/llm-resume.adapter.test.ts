import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LlmResumeAdapter, type LlmClient } from '../src/adapters/ai/llm-resume.adapter';
import type { ProfileDocument } from '../src/types/profile.types';

const pdf = () => ({ fileName: 'Somchai_CV.pdf', contentType: 'application/pdf', content: fs.readFileSync(path.join(__dirname, 'fixtures', 'resume.pdf')) });

/** Replies with a fixed string and remembers what it was asked. */
function replyingClient(reply: string) {
  const calls: { system: string; user: string }[] = [];
  const client: LlmClient = {
    label: 'fake/model',
    async complete(system, user) {
      calls.push({ system, user });
      return reply;
    },
  };
  return { client, calls };
}

test('llm adapter: sends the resume text and returns the repaired reply', async () => {
  const reply = JSON.stringify({
    name: 'Somchai Jaidee',
    email: 'somchai.jaidee@example.com',
    experience: [{ companyName: 'Lanna Tech', jobTitle: 'Intern', startDate: '2025-06', endDate: 'Present', bullets: ['Built APIs'] }],
  });
  const { client, calls } = replyingClient(reply);
  const out = (await new LlmResumeAdapter(client).parseResume(pdf())) as ProfileDocument;

  assert.equal(calls.length, 1);
  assert.match(calls[0].user, /Somchai Jaidee/);
  assert.match(calls[0].user, /Software Engineer Intern, Lanna Tech/);
  assert.equal(out.name, 'Somchai Jaidee');
  assert.deepEqual(out.experience, [
    { companyName: 'Lanna Tech', jobTitle: 'Intern', startDate: '2025-06-01', endDate: null, isCurrent: true, bullets: ['Built APIs'] },
  ]);
});

test('llm adapter: JSON wrapped in a code fence or surrounded by text is accepted', async () => {
  for (const reply of ['```json\n{"name": "Pim"}\n```', 'Here is the profile:\n{"name": "Pim"}\nDone.']) {
    const out = (await new LlmResumeAdapter(replyingClient(reply).client).parseResume(pdf())) as ProfileDocument;
    assert.equal(out.name, 'Pim');
  }
});

test('llm adapter: a reply without a JSON object is an error (so the fallback can run)', async () => {
  for (const reply of ['Sorry, I cannot help with that.', '[]', '{"name": "Pim"']) {
    await assert.rejects(new LlmResumeAdapter(replyingClient(reply).client).parseResume(pdf()), /JSON object/);
  }
});

test('llm adapter: a missing name falls back to the file name', async () => {
  const out = (await new LlmResumeAdapter(replyingClient('{"name": null}').client).parseResume(pdf())) as ProfileDocument;
  assert.equal(out.name, 'Somchai');
});
