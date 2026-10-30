import type { ProfileDocument } from '../../types/profile.types';
import { ValidationError } from '../../utils/errors';
import { validateDocument } from '../../validation/profile.validation';

/**
 * Turns whatever a resume parser produced into a document that passes
 * validateDocument, keeping as much as possible.
 *
 * A model or a heuristic gets details wrong ("2024-06" instead of a full
 * date, a GPA out of 100, a link without https://). Rejecting the whole
 * import for that would be worse than showing the candidate a slightly
 * emptier review form, so each reported field is fixed or emptied and the
 * document is validated again. The rules themselves stay in
 * profile.validation.ts: this file only reacts to the errors it reports.
 */
export function repairDocument(raw: unknown, fallbackName: string): ProfileDocument {
  let doc: Node = isObject(raw) ? structuredClone(raw) : {};
  for (let round = 1; ; round++) {
    try {
      return validateDocument(doc);
    } catch (err) {
      if (!(err instanceof ValidationError) || round === MAX_ROUNDS) throw err;
      for (const { field, message } of err.details) fix(doc, parsePath(field), message, fallbackName);
      doc = compact(doc) as Node;
    }
  }
}

/** A name to start from when the resume has none: "Somchai_Jaidee_CV.pdf" -> "Somchai Jaidee". */
export function nameFromFileName(fileName: string): string {
  const words = fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[\s_.-]+/)
    .filter((w) => w !== '' && !/^(resume|cv|curriculum|vitae|final|updated|latest|draft|v?\d+)$/i.test(w));
  if (words.length === 0) return 'Your name';
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** "2024-06", "2024", "Jun 2024", "June 2024" or "06/2024" -> YYYY-MM-DD (first day). Null if not a date. */
export function toIsoDate(value: string): string | null {
  const s = value.trim();
  let year: string | undefined;
  let month = 1;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return isRealDate(s) ? s : null;
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) [year, month] = [m[1], Number(m[2])];
  else if ((m = /^(\d{1,2})\/(\d{4})$/.exec(s))) [year, month] = [m[2], Number(m[1])];
  else if ((m = /^(\d{4})$/.exec(s))) year = m[1];
  else if ((m = /^([a-z]{3,9})\.?,?\s+(\d{4})$/i.exec(s))) {
    const index = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (index === -1) return null;
    [year, month] = [m[2], index + 1];
  }
  if (!year) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-01`;
  return isRealDate(iso) ? iso : null;
}

/** "Present", "Current", "Now" (or Thai "ปัจจุบัน") as an end date. */
export function isPresent(value: string): boolean {
  return /^(present|current|now|today|ปัจจุบัน)$/i.test(value.trim());
}

// ---------------------------------------------------------------------------

type Node = Record<string, unknown>;
type Path = (string | number)[];

const MAX_ROUNDS = 5;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Marks a list item for removal; removed by compact() once a round of fixes is done. */
const DROP = Symbol('drop');

function fix(doc: Node, path: Path, message: string, fallbackName: string): void {
  // Resumes rarely state job preferences; the candidate fills them in on review.
  if (path[0] === 'preferences') {
    doc.preferences = null;
    return;
  }
  const key = path[path.length - 1];
  const parent = getAt(doc, path.slice(0, -1));
  if (!isContainer(parent)) return; // already dropped this round
  const value = parent[key as keyof typeof parent] as unknown;
  const set = (v: unknown) => ((parent as Node)[key as string] = v);
  const inList = typeof key === 'number';
  let m: RegExpExecArray | null;

  if (message === 'Is required') {
    // An earlier fix this round may have filled it in (a skill string -> { name }).
    if (typeof value === 'string' && value.trim() !== '') return;
    if (path.length === 1) set(fallbackName);
    else dropItem(doc, path.slice(0, -1));
  } else if ((m = /^Must be at most (\d+) characters$/.exec(message)) && typeof value === 'string') {
    set(value.trim().slice(0, Number(m[1])).trim());
  } else if ((m = /^At most (\d+) items$/.exec(message)) && Array.isArray(value)) {
    set(value.slice(0, Number(m[1])));
  } else if (message === 'Must be a date in YYYY-MM-DD format' && typeof value === 'string') {
    if (key === 'endDate' && isPresent(value)) {
      set(null);
      (parent as Node).isCurrent = true;
    } else set(toIsoDate(value));
  } else if (message === 'Must be a number' && typeof value === 'string') {
    const n = parseFloat(value.replace(/,/g, ''));
    set(Number.isFinite(n) ? n : null);
  } else if (message.startsWith('Must be one of') && typeof value === 'string') {
    const coerced = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
    set(coerced !== value ? coerced : null);
  } else if (message === 'Must be an http or https URL' && typeof value === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(value.trim())) {
    set(`https://${value.trim()}`);
  } else if (message === 'Must be a 4-digit year' && typeof value === 'string') {
    set(/\b(19|20)\d{2}\b/.exec(value)?.[0] ?? null);
  } else if (message === 'Must be an object' && path[0] === 'skills' && typeof value === 'string') {
    set({ name: value });
  } else {
    set(inList ? DROP : null);
  }
}

function dropItem(doc: Node, itemPath: Path): void {
  const list = getAt(doc, itemPath.slice(0, -1));
  if (Array.isArray(list)) list[itemPath[itemPath.length - 1] as number] = DROP;
}

/** "experience[2].bullets[1]" -> ["experience", 2, "bullets", 1] */
function parsePath(field: string): Path {
  return field.split('.').flatMap((part) => {
    const name = part.replace(/\[\d+\]/g, '');
    const indexes = [...part.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
    return name ? [name, ...indexes] : indexes;
  });
}

function getAt(doc: Node, path: Path): unknown {
  let node: unknown = doc;
  for (const key of path) {
    if (!isContainer(node)) return undefined;
    node = (node as Node)[key as string];
  }
  return node;
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== DROP).map(compact);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compact(v)]));
  return value;
}

function isObject(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContainer(value: unknown): value is Node | unknown[] {
  return typeof value === 'object' && value !== null;
}

function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}
