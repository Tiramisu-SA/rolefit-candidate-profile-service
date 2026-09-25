import type { Pool } from 'pg';
import { NotImplementedError } from '../utils/errors';
import type {
  CandidateProfile,
  ConfirmProfileInput,
  UpdateProfileInput,
} from '../types/profile.types';
import type { ParsedResume } from '../adapters/ai/ai.types';

/**
 * Data access for candidate profiles.
 *
 * This is the ONLY place in the whole RoleFit system that talks to the
 * candidate profile database. The service layer depends on the interface,
 * which also lets you swap in an in-memory fake for tests.
 */
export interface ProfileRepository {
  findByCandidateId(candidateId: string): Promise<CandidateProfile | null>;
  saveDraft(candidateId: string, parsed: ParsedResume): Promise<CandidateProfile>;
  confirm(input: ConfirmProfileInput): Promise<CandidateProfile>;
  update(candidateId: string, changes: UpdateProfileInput): Promise<CandidateProfile>;
}

export class PostgresProfileRepository implements ProfileRepository {
  constructor(private readonly pool: Pool) {}

  async findByCandidateId(candidateId: string): Promise<CandidateProfile | null> {
    // TODO 5: Query the profile by candidate id and map the row to a
    // CandidateProfile. Return null when no row exists.
    throw new NotImplementedError('ProfileRepository.findByCandidateId');
  }

  async saveDraft(candidateId: string, parsed: ParsedResume): Promise<CandidateProfile> {
    // TODO 6: Persist the AI-extracted data as a draft profile.
    // Think about what happens if the candidate imports a second resume.
    throw new NotImplementedError('ProfileRepository.saveDraft');
  }

  async confirm(input: ConfirmProfileInput): Promise<CandidateProfile> {
    // TODO 7: Store the candidate-reviewed data and mark the profile confirmed.
    throw new NotImplementedError('ProfileRepository.confirm');
  }

  async update(candidateId: string, changes: UpdateProfileInput): Promise<CandidateProfile> {
    // TODO 7: Update only the provided fields and bump updatedAt.
    throw new NotImplementedError('ProfileRepository.update');
  }
}
