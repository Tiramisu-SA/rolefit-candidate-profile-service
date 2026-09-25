import type { ProfileRepository } from '../repositories/profile.repository';
import type { AIModelAdapter } from '../adapters/ai/ai.adapter';
import { NotImplementedError } from '../utils/errors';
import type {
  CandidateProfile,
  ConfirmProfileInput,
  ImportResumeInput,
  UpdateProfileInput,
} from '../types/profile.types';

/**
 * Business layer of the Candidate Profile Service.
 *
 * REST controllers AND gRPC handlers both call this class. All business rules
 * live here, so they are never duplicated between the two APIs. This class
 * must not import Express, gRPC or pg.
 *
 *   REST controller --\
 *                      >-- ProfileService --> ProfileRepository --> PostgreSQL
 *   gRPC handler -----/                  \--> AIModelAdapter    --> (AI provider, later)
 */
export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly aiModelAdapter: AIModelAdapter,
  ) {}

  /** Sends a resume to the AI adapter and stores the result as a draft profile. */
  async importResume(input: ImportResumeInput): Promise<CandidateProfile> {
    // TODO 14
    throw new NotImplementedError('ProfileService.importResume');
  }

  /** The candidate reviews the extracted draft and confirms it. */
  async confirmExtractedProfile(input: ConfirmProfileInput): Promise<CandidateProfile> {
    // TODO 15
    throw new NotImplementedError('ProfileService.confirmExtractedProfile');
  }

  /** The candidate edits an existing profile. */
  async updateProfile(candidateId: string, changes: UpdateProfileInput): Promise<CandidateProfile> {
    // TODO 11
    throw new NotImplementedError('ProfileService.updateProfile');
  }

  /** Returns a profile. Used by REST (frontend) and gRPC (Job Discovery). */
  async getProfile(candidateId: string): Promise<CandidateProfile> {
    // TODO 9
    throw new NotImplementedError('ProfileService.getProfile');
  }
}
