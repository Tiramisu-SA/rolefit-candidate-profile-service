import {
  EMPLOYMENT_TYPES,
  PROFICIENCY_LEVELS,
  WORK_ARRANGEMENTS,
  type EducationData,
  type ExperienceData,
  type PreferencesData,
  type ProfileBasics,
  type ProfileDocument,
  type ProjectData,
  type SkillData,
} from '../types/profile.types';
import { ValidationError, type FieldError } from '../utils/errors';

/**
 * Input validation shared by REST and gRPC (called from ProfileService).
 *
 * Every validator takes untrusted input and either returns clean data
 * (strings trimmed, empty optional strings -> null, empty list items dropped)
 * or throws a ValidationError listing every invalid field by path.
 */

type Body = Record<string, unknown>;

/** Collects field errors under a path prefix, e.g. `experience[1].`. */
class Checker {
  constructor(
    private readonly errors: FieldError[],
    private readonly prefix = '',
  ) {}

  child(prefix: string): Checker {
    return new Checker(this.errors, this.prefix + prefix);
  }

  fail(field: string, message: string): void {
    const path = field === '' ? this.prefix.replace(/\.$/, '') : this.prefix + field;
    this.errors.push({ field: path, message });
  }

  /** Returns the body as an object, or records an error and returns {}. */
  object(value: unknown, field: string): Body {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Body;
    this.fail(field, 'Must be an object');
    return {};
  }

  requiredString(value: unknown, field: string, max: number): string {
    const s = this.optionalString(value, field, max);
    if (s === null) {
      this.fail(field, 'Is required');
      return '';
    }
    return s;
  }

  optionalString(value: unknown, field: string, max: number): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      this.fail(field, 'Must be text');
      return null;
    }
    const s = value.trim();
    if (s === '') return null;
    if (s.length > max) this.fail(field, `Must be at most ${max} characters`);
    return s;
  }

  stringList(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.fail(field, 'Must be a list');
      return [];
    }
    const out: string[] = [];
    value.forEach((item, i) => {
      if (typeof item !== 'string') {
        this.fail(`${field}[${i}]`, 'Must be text');
        return;
      }
      const s = item.trim();
      if (s === '') return;
      if (s.length > maxLength) this.fail(`${field}[${i}]`, `Must be at most ${maxLength} characters`);
      out.push(s);
    });
    if (out.length > maxItems) this.fail(field, `At most ${maxItems} items`);
    return out;
  }

  enumList<T extends string>(value: unknown, field: string, allowed: readonly T[], maxItems: number): T[] {
    const items = this.stringList(value, field, maxItems, 50);
    const out: T[] = [];
    items.forEach((item, i) => {
      if (!allowed.includes(item as T)) this.fail(`${field}[${i}]`, `Must be one of ${allowed.join(', ')}`);
      else if (!out.includes(item as T)) out.push(item as T);
    });
    return out;
  }

  optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | null {
    const s = this.optionalString(value, field, 50);
    if (s === null) return null;
    if (!allowed.includes(s as T)) {
      this.fail(field, `Must be one of ${allowed.join(', ')}`);
      return null;
    }
    return s as T;
  }

  optionalNumber(value: unknown, field: string, min: number, max: number): number | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(field, 'Must be a number');
      return null;
    }
    if (value < min || value > max) this.fail(field, `Must be between ${min} and ${max}`);
    return value;
  }

  boolean(value: unknown, field: string, fallback: boolean): boolean {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'boolean') {
      this.fail(field, 'Must be true or false');
      return fallback;
    }
    return value;
  }

  /** YYYY-MM-DD that is a real calendar date. */
  optionalDate(value: unknown, field: string): string | null {
    const s = this.optionalString(value, field, 10);
    if (s === null) return null;
    if (!isIsoDate(s)) {
      this.fail(field, 'Must be a date in YYYY-MM-DD format');
      return null;
    }
    return s;
  }
}

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isHttpUrl(s: string): boolean {
  try {
    const url = new URL(s);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Runs a validator over a request body and throws if anything was recorded.
 * A body that is not an object fails straight away with a single `body` error.
 */
function run<T>(body: unknown, fn: (c: Checker, b: Body) => T): T {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError([{ field: 'body', message: 'Must be a JSON object' }]);
  }
  const errors: FieldError[] = [];
  const result = fn(new Checker(errors), body as Body);
  if (errors.length > 0) throw new ValidationError(errors);
  return result;
}

// ---------------------------------------------------------------------------
// Checks per shape (record errors, never throw)
// ---------------------------------------------------------------------------

function checkEmail(c: Checker, value: unknown): string | null {
  const email = c.optionalString(value, 'email', 254);
  if (email !== null && !EMAIL_RE.test(email)) c.fail('email', 'Must be a valid email address');
  return email;
}

function checkLinks(c: Checker, value: unknown): string[] {
  const links = c.stringList(value, 'links', 10, 500);
  links.forEach((link, i) => {
    if (!isHttpUrl(link)) c.fail(`links[${i}]`, 'Must be an http or https URL');
  });
  return links;
}

function checkBasics(c: Checker, b: Body): ProfileBasics {
  return {
    name: c.requiredString(b.name, 'name', 200),
    headline: c.optionalString(b.headline, 'headline', 200),
    summary: c.optionalString(b.summary, 'summary', 5000),
    email: checkEmail(c, b.email),
    location: c.optionalString(b.location, 'location', 200),
    links: checkLinks(c, b.links),
  };
}

function checkSkill(c: Checker, b: Body): SkillData {
  return {
    name: c.requiredString(b.name, 'name', 100),
    proficiencyLevel: c.optionalEnum(b.proficiencyLevel, 'proficiencyLevel', PROFICIENCY_LEVELS),
  };
}

function checkExperience(c: Checker, b: Body): ExperienceData {
  const out: ExperienceData = {
    companyName: c.requiredString(b.companyName, 'companyName', 200),
    jobTitle: c.requiredString(b.jobTitle, 'jobTitle', 200),
    startDate: c.optionalDate(b.startDate, 'startDate'),
    endDate: c.optionalDate(b.endDate, 'endDate'),
    isCurrent: c.boolean(b.isCurrent, 'isCurrent', false),
    bullets: c.stringList(b.bullets, 'bullets', 20, 500),
  };
  if (out.startDate && out.startDate > todayIso()) c.fail('startDate', 'Cannot be in the future');
  if (out.isCurrent && out.endDate) c.fail('endDate', 'Must be empty for a current role');
  else if (out.startDate && out.endDate && out.endDate < out.startDate) c.fail('endDate', 'Cannot be before the start date');
  return out;
}

function checkEducation(c: Checker, b: Body): EducationData {
  const out: EducationData = {
    institutionName: c.requiredString(b.institutionName, 'institutionName', 200),
    degree: c.requiredString(b.degree, 'degree', 200),
    fieldOfStudy: c.optionalString(b.fieldOfStudy, 'fieldOfStudy', 200),
    gpa: c.optionalNumber(b.gpa, 'gpa', 0, 4),
    year: c.optionalString(b.year, 'year', 20),
  };
  if (out.year !== null && !/^\d{4}$/.test(out.year)) c.fail('year', 'Must be a 4-digit year');
  return out;
}

function checkProject(c: Checker, b: Body): ProjectData {
  return {
    name: c.requiredString(b.name, 'name', 200),
    tech: c.stringList(b.tech, 'tech', 30, 100),
    bullets: c.stringList(b.bullets, 'bullets', 20, 500),
  };
}

function checkPreferences(c: Checker, b: Body): PreferencesData {
  const employmentTypes = c.enumList(b.employmentTypes, 'employmentTypes', EMPLOYMENT_TYPES, 20);
  const raw = b.employmentTypes;
  const hasAny = Array.isArray(raw) && raw.some((v) => typeof v === 'string' && v.trim() !== '');
  // A non-list value already has its own "Must be a list" error.
  if (!hasAny && (raw === undefined || raw === null || Array.isArray(raw))) {
    c.fail('employmentTypes', 'Choose at least one employment type');
  }
  const out: PreferencesData = {
    employmentTypes,
    preferredRoles: c.stringList(b.preferredRoles, 'preferredRoles', 20, 200),
    workArrangements: c.enumList(b.workArrangements, 'workArrangements', WORK_ARRANGEMENTS, 20),
    preferredLocations: c.stringList(b.preferredLocations, 'preferredLocations', 20, 200),
    minimumSalary: c.optionalNumber(b.minimumSalary, 'minimumSalary', 0, Number.MAX_SAFE_INTEGER),
    salaryCurrency: c.optionalString(b.salaryCurrency, 'salaryCurrency', 20),
  };
  if (out.salaryCurrency !== null && !/^[A-Z]{3}$/.test(out.salaryCurrency)) {
    c.fail('salaryCurrency', 'Must be a 3-letter currency code, e.g. THB');
  }
  return out;
}

function checkList<T>(c: Checker, value: unknown, field: string, max: number, check: (c: Checker, b: Body) => T): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    c.fail(field, 'Must be a list');
    return [];
  }
  if (value.length > max) c.fail(field, `At most ${max} items`);
  return value.map((item, i) => {
    const itemChecker = c.child(`${field}[${i}].`);
    return check(itemChecker, itemChecker.object(item, ''));
  });
}

function dedupeSkills(skills: SkillData[]): SkillData[] {
  const seen = new Set<string>();
  return skills.filter((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Public validators
// ---------------------------------------------------------------------------

export function validateBasics(body: unknown, opts: { partial: true }): Partial<ProfileBasics>;
export function validateBasics(body: unknown, opts?: { partial?: false }): ProfileBasics;
export function validateBasics(body: unknown, opts: { partial?: boolean } = {}): Partial<ProfileBasics> {
  return run(body, (c, b) => {
    if (!opts.partial) return checkBasics(c, b);

    const out: Partial<ProfileBasics> = {};
    if ('name' in b) out.name = c.requiredString(b.name, 'name', 200);
    if ('headline' in b) out.headline = c.optionalString(b.headline, 'headline', 200);
    if ('summary' in b) out.summary = c.optionalString(b.summary, 'summary', 5000);
    if ('email' in b) out.email = checkEmail(c, b.email);
    if ('location' in b) out.location = c.optionalString(b.location, 'location', 200);
    if ('links' in b) out.links = checkLinks(c, b.links);
    return out;
  });
}

export const validateSkill = (body: unknown): SkillData => run(body, checkSkill);
export const validateExperience = (body: unknown): ExperienceData => run(body, checkExperience);
export const validateEducation = (body: unknown): EducationData => run(body, checkEducation);
export const validateProject = (body: unknown): ProjectData => run(body, checkProject);
export const validatePreferences = (body: unknown): PreferencesData => run(body, checkPreferences);

export function validateDocument(body: unknown): ProfileDocument {
  return run(body, (c, b) => {
    const basics = checkBasics(c, b);
    const skills = dedupeSkills(checkList(c, b.skills, 'skills', 100, checkSkill));
    const experience = checkList(c, b.experience, 'experience', 50, checkExperience);
    const education = checkList(c, b.education, 'education', 20, checkEducation);
    const projects = checkList(c, b.projects, 'projects', 50, checkProject);
    let preferences: PreferencesData | null = null;
    if (b.preferences !== undefined && b.preferences !== null) {
      const pc = c.child('preferences.');
      preferences = checkPreferences(pc, pc.object(b.preferences, ''));
    }
    return { ...basics, skills, experience, education, projects, preferences };
  });
}
