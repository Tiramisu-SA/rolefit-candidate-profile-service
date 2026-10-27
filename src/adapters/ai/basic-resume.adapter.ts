import type { AIModelAdapter } from './ai.adapter';
import type { ParseResumeInput, ParsedResume } from './ai.types';
import { isPresent, nameFromFileName, repairDocument, toIsoDate } from './repair-document';
import { extractResumeText } from './resume-text';

/**
 * Library-only resume parser: no AI model involved. It reads the file's text
 * and splits it by the usual resume headings (Skills, Experience, ...).
 *
 * Rough by design: unusual layouts lose detail, and the candidate corrects
 * the result on the review screen. Used when no AI provider is configured,
 * and as the fallback when the AI call fails.
 */
export class BasicResumeAdapter implements AIModelAdapter {
  async parseResume(input: ParseResumeInput): Promise<ParsedResume> {
    const text = await extractResumeText(input);
    return repairDocument(parseResumeText(text), nameFromFileName(input.fileName));
  }
}

/** Resume text -> a loosely-filled profile document (repairDocument cleans it up). */
export function parseResumeText(text: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
  const { header, sections } = splitSections(lines);
  return {
    ...parseHeader(header),
    email: EMAIL_RE.exec(text)?.[0] ?? null,
    summary: sections.summary.join(' ') || null,
    skills: parseSkills(sections.skills),
    experience: parseExperience(sections.experience),
    education: parseEducation(sections.education),
    projects: parseProjects(sections.projects),
    preferences: null,
  };
}

// ---------------------------------------------------------------------------

type Section = 'summary' | 'skills' | 'experience' | 'education' | 'projects' | 'other';

const HEADINGS: [Section, RegExp][] = [
  ['summary', /^(professional\s+)?(summary|profile|about(\s+me)?|objective|career\s+objective)$/i],
  ['skills', /^((technical|core|key)\s+)?skills(\s*(&|and)\s*tools)?$|^(technologies|tech\s+stack|tools)$/i],
  ['experience', /^((work|professional|relevant)\s+)?experience$|^(employment(\s+history)?|work\s+history|internships?)$/i],
  ['education', /^(education|academic\s+background)$/i],
  ['projects', /^((personal|selected|academic)\s+)?projects$/i],
  // Known sections this parser skips, so their lines don't leak into the one above.
  ['other', /^(certifications?|certificates|awards|honou?rs|languages|interests|hobbies|activities|references|volunteering|publications|achievements)$/i],
];

const EMAIL_RE = /[^\s@|,;<>()]+@[^\s@|,;<>()]+\.[a-z]{2,}/i;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s|,;<>()]+|\b(?:github|gitlab|linkedin|behance|dribbble)\.com\/[^\s|,;<>()]+/gi;
const LOCATION_RE = /^[\p{L} .'-]+,\s*[\p{L} .'-]+$/u;
const BULLET_RE = /^[-•*▪●◦–]\s*/;
const DATE = String.raw`(?:[A-Za-z]{3,9}\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4}-\d{1,2}|\d{4})`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|—|to)\\s*(${DATE}|present|current|now)`, 'i');
const GPA_RE = /\bGPA\s*:?\s*([0-4](?:\.\d{1,2})?)(?:\s*\/\s*4(?:\.0+)?)?/i;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const INSTITUTION_RE = /\b(university|college|institute|school|academy|polytechnic)\b|มหาวิทยาลัย/i;
/** Separators trimmed from the ends of a line once dates or GPA are cut out. */
const EDGE_SEPARATORS = /^[\s|,·•–—-]+|[\s|,·•–—-]+$/g;

function splitSections(lines: string[]) {
  const header: string[] = [];
  const sections: Record<Section, string[]> = { summary: [], skills: [], experience: [], education: [], projects: [], other: [] };
  let current = header;
  for (const line of lines) {
    const title = line.replace(/:$/, '').trim();
    const heading = HEADINGS.find(([, re]) => re.test(title))?.[0];
    if (heading) current = sections[heading];
    else if (line !== '') current.push(line);
  }
  return { header, sections };
}

/** A line that could be a name or a headline: no contact details or numbers. */
function isPlain(line: string): boolean {
  return !EMAIL_RE.test(line) && !line.match(URL_RE) && !/\d/.test(line) && line.length <= 80 && line.split(' ').length <= 8;
}

function parseHeader(header: string[]) {
  const nameIndex = header.findIndex((l) => isPlain(l) && l.split(' ').length <= 6);
  const next = nameIndex === -1 ? undefined : header[nameIndex + 1];
  const segments = header.flatMap((l) => l.split(/\s*[|•·]\s*/));
  return {
    name: nameIndex === -1 ? null : header[nameIndex],
    headline: next && isPlain(next) && !LOCATION_RE.test(next) ? next : null,
    location: segments.find((s) => LOCATION_RE.test(s)) ?? null,
    links: [...new Set(header.flatMap((l) => l.match(URL_RE) ?? []).map((u) => u.replace(/[.]+$/, '')))],
  };
}

const isBullet = (line: string) => BULLET_RE.test(line) && line.length > 2;
const stripBullet = (line: string) => line.replace(BULLET_RE, '').trim();
const splitList = (s: string) => s.split(/\s*[,•·|;]\s*/).map((x) => x.trim()).filter((x) => x !== '');

function parseSkills(lines: string[]) {
  return lines
    .flatMap((line) => splitList(stripBullet(line).replace(/^[\p{L} &/]{2,30}:\s*/u, '')))
    .map((name) => ({ name }));
}

/** Finds "Jun 2025 - Present" style ranges; `rest` is the line without them. */
function parseRange(line: string) {
  const m = RANGE_RE.exec(line);
  if (!m) return null;
  const current = isPresent(m[2]);
  return {
    dates: { startDate: toIsoDate(m[1]), endDate: current ? null : toIsoDate(m[2]), isCurrent: current },
    rest: line.replace(m[0], '').replace(EDGE_SEPARATORS, ''),
  };
}

/** "Intern, Lanna Tech", "Developer at Webcraft", "Intern — Lanna Tech" -> title and company. */
function splitTitle(line: string) {
  for (const sep of [/\s+at\s+/i, /\s+@\s+/, /\s+[—–|]\s+/, /\s+-\s+/, /,\s+/]) {
    const m = sep.exec(line);
    if (m) return { jobTitle: line.slice(0, m.index).trim(), companyName: line.slice(m.index + m[0].length).trim() };
  }
  return { jobTitle: line, companyName: '' };
}

function parseExperience(lines: string[]) {
  type Job = ReturnType<typeof splitTitle> & { startDate: string | null; endDate: string | null; isCurrent: boolean; bullets: string[] };
  const jobs: Job[] = [];
  let job: Job | undefined;
  for (const line of lines) {
    if (isBullet(line)) {
      job?.bullets.push(stripBullet(line));
      continue;
    }
    const range = parseRange(line);
    const rest = range ? range.rest : line;
    if (rest === '') {
      if (job && range) Object.assign(job, range.dates);
    } else if (job && !job.companyName && job.bullets.length === 0 && !range) {
      job.companyName = rest; // a title line followed by the company on its own line
    } else {
      job = { ...splitTitle(rest), startDate: null, endDate: null, isCurrent: false, bullets: [], ...range?.dates };
      jobs.push(job);
    }
  }
  return jobs;
}

/** "Bachelor of Science in X" or "B.Eng. X" -> degree and field of study. */
function splitDegree(text: string) {
  let m = /^((?:bachelor|master|doctor|associate)(?:'?s)?\b.*?)\s+in\s+(.+)$/i.exec(text);
  if (m) return { degree: m[1].trim(), fieldOfStudy: m[2].trim() };
  m = /^((?:B|M|Ph|D)\.?\s?[A-Z][A-Za-z]{0,4}\.?)\s+(?:in\s+)?(.+)$/.exec(text);
  if (m) return { degree: m[1], fieldOfStudy: m[2].trim() };
  return { degree: text, fieldOfStudy: null };
}

function parseEducation(lines: string[]) {
  type School = { institutionName: string; degree: string; fieldOfStudy: string | null; gpa: number | null; year: string | null };
  const schools: School[] = [];
  let school: School | undefined;
  for (const raw of lines) {
    const line = stripBullet(raw);
    const gpa = GPA_RE.exec(line);
    const years = line.match(YEAR_RE);
    const parts = line
      .replace(GPA_RE, '')
      .replace(YEAR_RE, '')
      .split(/\s*[,|–—]\s*/)
      .map((p) => p.replace(EDGE_SEPARATORS, ''))
      .filter((p) => p !== '');
    const institution = parts.find((p) => INSTITUTION_RE.test(p));
    const degree = parts.find((p) => !INSTITUTION_RE.test(p));

    if (!school || (institution && school.institutionName)) {
      school = { institutionName: '', degree: '', fieldOfStudy: null, gpa: null, year: null };
      schools.push(school);
    }
    if (institution) school.institutionName = institution;
    if (degree && !school.degree) Object.assign(school, splitDegree(degree));
    if (gpa) school.gpa = Number(gpa[1]);
    if (years) school.year = years[years.length - 1];
  }
  return schools;
}

function parseProjects(lines: string[]) {
  type Project = { name: string; tech: string[]; bullets: string[] };
  const projects: Project[] = [];
  let project: Project | undefined;
  for (const line of lines) {
    const tech = /^(?:tech(?:nologies)?|stack|built with)\s*:\s*(.+)$/i.exec(line);
    if (project && (isBullet(line) || line.endsWith('.'))) {
      project.bullets.push(stripBullet(line));
    } else if (project && tech) {
      project.tech.push(...splitList(tech[1]));
    } else {
      const rest = parseRange(line)?.rest ?? line;
      const m = /^(.*?)\s*\(([^)]*)\)$/.exec(rest);
      project = { name: (m ? m[1] : rest).replace(EDGE_SEPARATORS, ''), tech: m ? splitList(m[2]) : [], bullets: [] };
      projects.push(project);
    }
  }
  return projects;
}
