import type {
  CandidateProfile,
  ChildDataMap,
  ChildKind,
  ChildRow,
  Preferences,
  PreferencesData,
  ProfileBasics,
  ProfileDocument,
} from '../types/profile.types';

/**
 * Data access for candidate profiles.
 *
 * This is the ONLY place in the whole RoleFit system that talks to the
 * candidate profile database. The service layer depends on this interface,
 * which also lets tests swap in an in-memory fake.
 *
 * Child methods always take the owning profile id, so a row can only be
 * read or changed through its own profile.
 */
export interface ProfileRepository {
  /** Runs fn inside one transaction; fn gets a repository bound to it. */
  transaction<T>(fn: (repo: ProfileRepository) => Promise<T>): Promise<T>;

  findByUserId(userId: string): Promise<CandidateProfile | null>;
  findById(id: string): Promise<CandidateProfile | null>;
  /** Returns the new profile id. */
  create(userId: string, basics: ProfileBasics): Promise<string>;
  updateBasics(profileId: string, changes: Partial<ProfileBasics>): Promise<void>;
  deleteById(profileId: string): Promise<void>;
  /** Sets updated_at = now() on the profile row. */
  touch(profileId: string): Promise<void>;
  setExperienceMonths(profileId: string, months: number): Promise<void>;

  listChildren<K extends ChildKind>(kind: K, profileId: string): Promise<ChildRow<K>[]>;
  /** Throws ConflictError('DUPLICATE_SKILL') for a skill name that exists (ignoring case). */
  insertChild<K extends ChildKind>(kind: K, profileId: string, data: ChildDataMap[K]): Promise<ChildRow<K>>;
  /** Returns null when the row does not exist or belongs to another profile. */
  updateChild<K extends ChildKind>(kind: K, profileId: string, id: string, data: ChildDataMap[K]): Promise<ChildRow<K> | null>;
  deleteChild(kind: ChildKind, profileId: string, id: string): Promise<boolean>;

  getPreferences(profileId: string): Promise<Preferences | null>;
  upsertPreferences(profileId: string, data: PreferencesData): Promise<Preferences>;
  deletePreferences(profileId: string): Promise<boolean>;

  /**
   * Creates or fully replaces the user's profile (basics and every child row),
   * sets verified = true and the given experience months. Returns the profile id.
   */
  replaceDocument(userId: string, doc: ProfileDocument, experienceMonths: number): Promise<string>;
}
