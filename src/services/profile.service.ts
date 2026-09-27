import type { ProfileRepository } from '../repositories/profile.repository';
import type { AIModelAdapter } from '../adapters/ai/ai.adapter';
import type {
  CandidateProfile,
  ChildDataMap,
  ChildKind,
  ChildRow,
  Preferences,
  ProfileDocument,
} from '../types/profile.types';
import {
  ConflictError,
  EmptyFileError,
  FileTooLargeError,
  NotFoundError,
  UnsupportedFileTypeError,
  ValidationError,
  profileNotFound,
} from '../utils/errors';
import {
  isUuid,
  validateBasics,
  validateDocument,
  validateEducation,
  validateExperience,
  validatePreferences,
  validateProject,
  validateSkill,
} from '../validation/profile.validation';
import { computeExperienceMonths } from './experience-months';

export const RESUME_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const CHILD_VALIDATORS: { [K in ChildKind]: (body: unknown) => ChildDataMap[K] } = {
  skills: validateSkill,
  experience: validateExperience,
  education: validateEducation,
  projects: validateProject,
};

const CHILD_NOT_FOUND: Record<ChildKind, [code: string, message: string]> = {
  skills: ['SKILL_NOT_FOUND', 'Skill not found'],
  experience: ['EXPERIENCE_NOT_FOUND', 'Experience entry not found'],
  education: ['EDUCATION_NOT_FOUND', 'Education entry not found'],
  projects: ['PROJECT_NOT_FOUND', 'Project not found'],
};

const childNotFound = (kind: ChildKind) => new NotFoundError(...CHILD_NOT_FOUND[kind]);
const preferencesNotFound = () => new NotFoundError('PREFERENCES_NOT_FOUND', 'Job preferences not found');

export interface ResumeFile {
  fileName: string;
  contentType: string;
  content: Buffer;
}

/**
 * Business layer of the Candidate Profile Service.
 *
 * REST controllers AND gRPC handlers both call this class. All business rules
 * live here, so they are never duplicated between the two APIs. This class
 * must not import Express, gRPC or pg.
 *
 * Every public method except getProfileById works on the caller's own
 * profile. A profile's id is its owner's user id (from the identity
 * middleware), so no separate user_id lookup is needed.
 */
export class ProfileService {
  constructor(
    private readonly repo: ProfileRepository,
    private readonly aiModelAdapter: AIModelAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // --- profile ---------------------------------------------------------------

  async getProfile(userId: string): Promise<CandidateProfile> {
    const profile = await this.repo.findById(userId);
    if (!profile) throw profileNotFound();
    return this.withCurrentMonths(profile);
  }

  /** Used by gRPC (other services know the profile id, not the user id). */
  async getProfileById(id: string): Promise<CandidateProfile> {
    if (!isUuid(id)) throw new ValidationError([{ field: 'candidate_id', message: 'Must be a UUID' }]);
    const profile = await this.repo.findById(id);
    if (!profile) throw profileNotFound();
    return this.withCurrentMonths(profile);
  }

  /**
   * The stored total is refreshed on every experience write, but a current role
   * keeps adding months with no write, so the returned value is recalculated
   * from the rows already loaded.
   */
  private withCurrentMonths(profile: CandidateProfile): CandidateProfile {
    return { ...profile, totalExperienceMonths: computeExperienceMonths(profile.experience, this.todayIso()) };
  }

  async createProfile(userId: string, body: unknown): Promise<CandidateProfile> {
    const basics = validateBasics(body);
    if (await this.repo.findById(userId)) {
      throw new ConflictError('PROFILE_ALREADY_EXISTS', 'You already have a profile');
    }
    await this.repo.create(userId, basics);
    return this.getProfile(userId);
  }

  async updateBasics(userId: string, body: unknown): Promise<CandidateProfile> {
    const changes = validateBasics(body, { partial: true });
    const profile = await this.getProfile(userId);
    await this.repo.updateBasics(profile.id, changes);
    return this.getProfile(userId);
  }

  async deleteProfile(userId: string): Promise<void> {
    const profile = await this.getProfile(userId);
    await this.repo.deleteById(profile.id);
  }

  // --- child collections ---------------------------------------------------------

  async listChildren<K extends ChildKind>(userId: string, kind: K): Promise<ChildRow<K>[]> {
    const profile = await this.getProfile(userId);
    return this.repo.listChildren(kind, profile.id);
  }

  async addChild<K extends ChildKind>(userId: string, kind: K, body: unknown): Promise<ChildRow<K>> {
    const data = CHILD_VALIDATORS[kind](body);
    const profile = await this.getProfile(userId);
    return this.repo.transaction(async (tx) => {
      const row = await tx.insertChild(kind, profile.id, data);
      await this.afterChildWrite(tx, kind, profile.id);
      return row;
    });
  }

  async updateChild<K extends ChildKind>(userId: string, kind: K, id: string, body: unknown): Promise<ChildRow<K>> {
    const data = CHILD_VALIDATORS[kind](body);
    const profile = await this.getProfile(userId);
    if (!isUuid(id)) throw childNotFound(kind);
    return this.repo.transaction(async (tx) => {
      const row = await tx.updateChild(kind, profile.id, id, data);
      if (!row) throw childNotFound(kind);
      await this.afterChildWrite(tx, kind, profile.id);
      return row;
    });
  }

  async deleteChild(userId: string, kind: ChildKind, id: string): Promise<void> {
    const profile = await this.getProfile(userId);
    if (!isUuid(id)) throw childNotFound(kind);
    await this.repo.transaction(async (tx) => {
      if (!(await tx.deleteChild(kind, profile.id, id))) throw childNotFound(kind);
      await this.afterChildWrite(tx, kind, profile.id);
    });
  }

  /** Every child write bumps updated_at; experience writes also recalculate the months. */
  private async afterChildWrite(tx: ProfileRepository, kind: ChildKind, profileId: string): Promise<void> {
    if (kind === 'experience') {
      const rows = await tx.listChildren('experience', profileId);
      await tx.setExperienceMonths(profileId, computeExperienceMonths(rows, this.todayIso()));
    }
    await tx.touch(profileId);
  }

  // --- preferences -----------------------------------------------------------------

  async getPreferences(userId: string): Promise<Preferences> {
    const profile = await this.getProfile(userId);
    const prefs = await this.repo.getPreferences(profile.id);
    if (!prefs) throw preferencesNotFound();
    return prefs;
  }

  async savePreferences(userId: string, body: unknown): Promise<Preferences> {
    const data = validatePreferences(body);
    const profile = await this.getProfile(userId);
    return this.repo.transaction(async (tx) => {
      const prefs = await tx.upsertPreferences(profile.id, data);
      await tx.touch(profile.id);
      return prefs;
    });
  }

  async deletePreferences(userId: string): Promise<void> {
    const profile = await this.getProfile(userId);
    await this.repo.transaction(async (tx) => {
      if (!(await tx.deletePreferences(profile.id))) throw preferencesNotFound();
      await tx.touch(profile.id);
    });
  }

  // --- resume import / confirm --------------------------------------------------------

  /** Parses a resume with the AI adapter. Nothing is saved: the candidate reviews it first. */
  async importResume(_userId: string, file: ResumeFile): Promise<{ fileName: string; profile: ProfileDocument }> {
    if (!RESUME_CONTENT_TYPES.includes(file.contentType)) throw new UnsupportedFileTypeError();
    if (file.content.length === 0) throw new EmptyFileError();
    if (file.content.length > MAX_RESUME_BYTES) throw new FileTooLargeError();
    const parsed = await this.aiModelAdapter.parseResume(file);
    // AI output is untrusted: normalize it with the same rules as user input.
    return { fileName: file.fileName, profile: validateDocument(parsed) };
  }

  /** Saves a reviewed profile in one go: replaces basics and every child row, sets verified. */
  async confirmProfile(userId: string, body: unknown): Promise<CandidateProfile> {
    const doc = validateDocument(body);
    const months = computeExperienceMonths(doc.experience, this.todayIso());
    await this.repo.replaceDocument(userId, doc, months);
    return this.getProfile(userId);
  }

  private todayIso(): string {
    return this.now().toISOString().slice(0, 10);
  }
}
