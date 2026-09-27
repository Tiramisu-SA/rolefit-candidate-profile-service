import { randomUUID } from 'node:crypto';
import type { ProfileRepository } from '../../src/repositories/profile.repository';
import type {
  CandidateProfile,
  ChildDataMap,
  ChildKind,
  ChildRow,
  Preferences,
  PreferencesData,
  ProfileBasics,
  ProfileDocument,
} from '../../src/types/profile.types';
import { ConflictError } from '../../src/utils/errors';

interface Row extends ProfileBasics {
  id: string;
  verified: boolean;
  totalExperienceMonths: number;
  createdAt: Date;
  updatedAt: Date;
}

type Children = { [K in ChildKind]: (ChildRow<K> & { profileId: string })[] };

/**
 * In-memory ProfileRepository for tests. Mirrors the Postgres behavior that
 * matters to the service: ownership checks, case-insensitive unique skills,
 * row ordering, and updated_at. `transaction` just runs fn (no rollback).
 */
export class InMemoryProfileRepository implements ProfileRepository {
  profiles: Row[] = [];
  children: Children = { skills: [], experience: [], education: [], projects: [] };
  preferences = new Map<string, Preferences>();
  /** Added to the clock so tests can see updatedAt move forward. */
  clockOffsetMs = 0;

  private now(): Date {
    return new Date(Date.now() + this.clockOffsetMs);
  }

  async transaction<T>(fn: (repo: ProfileRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async findById(id: string) {
    const row = this.profiles.find((p) => p.id === id);
    return row ? this.assemble(row) : null;
  }

  async create(id: string, basics: ProfileBasics) {
    if (this.profiles.some((p) => p.id === id)) throw new ConflictError('PROFILE_ALREADY_EXISTS', 'You already have a profile');
    const at = this.now();
    this.profiles.push({ ...basics, id, verified: false, totalExperienceMonths: 0, createdAt: at, updatedAt: at });
  }

  async updateBasics(profileId: string, changes: Partial<ProfileBasics>) {
    const row = this.profiles.find((p) => p.id === profileId)!;
    Object.assign(row, changes, { updatedAt: this.now() });
  }

  async deleteById(profileId: string) {
    this.profiles = this.profiles.filter((p) => p.id !== profileId);
    for (const kind of Object.keys(this.children) as ChildKind[]) {
      (this.children[kind] as { profileId: string }[]) = this.children[kind].filter((c) => c.profileId !== profileId);
    }
    this.preferences.delete(profileId);
  }

  async touch(profileId: string) {
    this.profiles.find((p) => p.id === profileId)!.updatedAt = this.now();
  }

  async setExperienceMonths(profileId: string, months: number) {
    this.profiles.find((p) => p.id === profileId)!.totalExperienceMonths = months;
  }

  async listChildren<K extends ChildKind>(kind: K, profileId: string): Promise<ChildRow<K>[]> {
    const rows = (this.children[kind] as (ChildRow<K> & { profileId: string })[]).filter((c) => c.profileId === profileId);
    return sortChildren(kind, rows.map(({ profileId: _p, ...rest }) => rest as unknown as ChildRow<K>));
  }

  async insertChild<K extends ChildKind>(kind: K, profileId: string, data: ChildDataMap[K]): Promise<ChildRow<K>> {
    if (kind === 'skills') this.assertUniqueSkill(profileId, (data as ChildDataMap['skills']).name, null);
    const row = { ...data, id: randomUUID() } as ChildRow<K>;
    (this.children[kind] as unknown[]).push({ ...row, profileId });
    return row;
  }

  async updateChild<K extends ChildKind>(kind: K, profileId: string, id: string, data: ChildDataMap[K]) {
    const list = this.children[kind] as (ChildRow<K> & { profileId: string })[];
    const row = list.find((c) => c.id === id && c.profileId === profileId);
    if (!row) return null;
    if (kind === 'skills') this.assertUniqueSkill(profileId, (data as ChildDataMap['skills']).name, id);
    Object.assign(row, data);
    const { profileId: _p, ...rest } = row;
    return rest as unknown as ChildRow<K>;
  }

  async deleteChild(kind: ChildKind, profileId: string, id: string) {
    const list = this.children[kind] as { id: string; profileId: string }[];
    const index = list.findIndex((c) => c.id === id && c.profileId === profileId);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }

  async getPreferences(profileId: string) {
    return this.preferences.get(profileId) ?? null;
  }

  async upsertPreferences(profileId: string, data: PreferencesData) {
    this.preferences.set(profileId, { ...data });
    return { ...data };
  }

  async deletePreferences(profileId: string) {
    return this.preferences.delete(profileId);
  }

  async replaceDocument(id: string, doc: ProfileDocument, experienceMonths: number) {
    const { skills, experience, education, projects, preferences, ...basics } = doc;
    let row = this.profiles.find((p) => p.id === id);
    if (!row) {
      await this.create(id, basics);
      row = this.profiles.find((p) => p.id === id)!;
    }
    Object.assign(row, basics, { verified: true, totalExperienceMonths: experienceMonths, updatedAt: this.now() });
    for (const kind of Object.keys(this.children) as ChildKind[]) {
      (this.children[kind] as { profileId: string }[]) = this.children[kind].filter((c) => c.profileId !== id);
    }
    for (const s of skills) await this.insertChild('skills', id, s);
    for (const e of experience) await this.insertChild('experience', id, e);
    for (const e of education) await this.insertChild('education', id, e);
    for (const p of projects) await this.insertChild('projects', id, p);
    if (preferences) this.preferences.set(id, { ...preferences });
    else this.preferences.delete(id);
  }

  private assertUniqueSkill(profileId: string, name: string, exceptId: string | null) {
    const clash = this.children.skills.some(
      (s) => s.profileId === profileId && s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) throw new ConflictError('DUPLICATE_SKILL', `You already have the skill "${name}"`);
  }

  private async assemble(row: Row): Promise<CandidateProfile> {
    return {
      ...row,
      skills: await this.listChildren('skills', row.id),
      experience: await this.listChildren('experience', row.id),
      education: await this.listChildren('education', row.id),
      projects: await this.listChildren('projects', row.id),
      preferences: this.preferences.get(row.id) ?? null,
    };
  }
}

/** Same ordering as the Postgres repository (see the spec's "Ordering"). */
function sortChildren<K extends ChildKind>(kind: K, rows: ChildRow<K>[]): ChildRow<K>[] {
  const desc = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1);
  const byName = (a: { name: string }, b: { name: string }) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  const sorted = [...rows];
  if (kind === 'experience') {
    (sorted as ChildRow<'experience'>[]).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || desc(a.startDate, b.startDate));
  } else if (kind === 'education') {
    (sorted as ChildRow<'education'>[]).sort((a, b) => desc(a.year, b.year));
  } else {
    (sorted as unknown as { name: string }[]).sort(byName);
  }
  return sorted;
}
