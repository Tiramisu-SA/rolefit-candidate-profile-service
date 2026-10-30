import { PDFParse } from 'pdf-parse';
import WordExtractor from 'word-extractor';
import { UnreadableResumeError } from '../../utils/errors';
import type { ParseResumeInput } from './ai.types';

/**
 * Pulls the plain text out of a resume file, one line per line of the
 * document. Both resume parsers start from this text.
 *
 * ProfileService has already checked the content type, so anything that is
 * not a PDF is a Word document (.doc or .docx; word-extractor reads both).
 */
export async function extractResumeText(file: ParseResumeInput): Promise<string> {
  let text: string;
  try {
    text = file.contentType === 'application/pdf' ? await readPdf(file.content) : await readWord(file.content);
  } catch {
    throw new UnreadableResumeError();
  }
  if (text.trim() === '') throw new UnreadableResumeError();
  return text;
}

async function readPdf(content: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(content) });
  try {
    // No "-- 1 of 2 --" page markers: they are noise to both parsers.
    return (await parser.getText({ pageJoiner: '' })).text;
  } finally {
    await parser.destroy();
  }
}

async function readWord(content: Buffer): Promise<string> {
  const doc = await new WordExtractor().extract(content);
  return doc.getBody();
}
