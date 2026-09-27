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
 * A profile's id is its owner's user id (candidate_profile has no separate
 * user_id column), so "the caller's profile" is simply findById(userId).
 * Child methods always take the owning profile id, so a row can only be
 * read or changed through its own profile.
 */
export interface ProfileRepository {
  /** Runs fn inside one transaction; fn gets a repository bound to it. */
  transaction<T>(fn: (repo: ProfileRepository) => Promise<T>): Promise<T>;

  findById(id: string): Promise<CandidateProfile | null>;
  /** Creates the profile with the given id (the user's id). Throws ConflictError('PROFILE_ALREADY_EXISTS') if it exists. */
  create(id: string, basics: ProfileBasics): Promise<void>;
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
   * Creates or fully replaces the profile with this id (basics and every child
   * row), and sets verified = true and the given experience months.
   */
  replaceDocument(id: string, doc: ProfileDocument, experienceMonths: number): Promise<void>;
}
