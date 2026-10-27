import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractResumeText } from '../src/adapters/ai/resume-text';
import { AppError } from '../src/utils/errors';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name));
const file = (fileName: string, contentType: string, content: Buffer) => ({ fileName, contentType, content });

async function rejectsUnreadable(promise: Promise<unknown>) {
  await assert.rejects(promise, (err: unknown) => err instanceof AppError && err.code === 'RESUME_UNREADABLE' && err.httpStatus === 422);
}

test('resume text: reads a PDF line by line', async () => {
  const text = await extractResumeText(file('cv.pdf', PDF, fixture('resume.pdf')));
  assert.match(text, /^Somchai Jaidee$/m);
  assert.match(text, /^somchai\.jaidee@example\.com \| Chiang Mai, Thailand$/m);
  // The basic parser relies on headings staying on their own line.
  assert.match(text, /^Skills\s*\n\s*TypeScript, Node\.js, PostgreSQL, Docker$/m);
});

test('resume text: reads a .docx line by line', async () => {
  const text = await extractResumeText(file('cv.docx', DOCX, fixture('resume.docx')));
  assert.match(text, /^Somchai Jaidee$/m);
  assert.match(text, /^Skills\s*\n\s*TypeScript, Node\.js, PostgreSQL, Docker$/m);
});

test('resume text: a PDF without any text (e.g. a scan) is RESUME_UNREADABLE', async () => {
  await rejectsUnreadable(extractResumeText(file('scan.pdf', PDF, fixture('blank.pdf'))));
});

test('resume text: a damaged PDF or Word file is RESUME_UNREADABLE', async () => {
  await rejectsUnreadable(extractResumeText(file('cv.pdf', PDF, Buffer.from('not really a pdf'))));
  await rejectsUnreadable(extractResumeText(file('cv.docx', DOCX, Buffer.from('not really a docx'))));
});
