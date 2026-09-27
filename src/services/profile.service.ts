import type { ProfileRepository } from '../repositories/profile.repository';
import type { AIModelAdapter } from '../adapters/ai/ai.adapter';
import {NotFoundError, NotImplementedError,ValidationError} from '../utils/errors';
import type {
  CandidateProfile,
  ConfirmProfileInput,
  CreateProfileInput,
  ExtractedProfile,
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

  /** Creates a new profile when a candidate registers. Returns it with its generated id. */
  async createProfile(input: CreateProfileInput): Promise<CandidateProfile> {
    return this.profileRepository.create(input);
  }

  /**
   * Sends a resume to the AI adapter and returns the extracted data.
   * Nothing is saved: the candidate reviews it first, then confirms it.
   */
  async importResume(input: ImportResumeInput): Promise<ExtractedProfile> {
    // TODO 14
    throw new NotImplementedError('ProfileService.importResume');
  }

  /** Overwrites an existing profile with the reviewed resume data (verified = true). */
  async confirmExtractedProfile(input: ConfirmProfileInput): Promise<CandidateProfile> {
    // Business rule: a confirmed profile must have a name.
    if (input.profile.name.trim() === '') {
      throw new ValidationError('A profile needs a name before it can be confirmed');
    }
    const profile = await this.profileRepository.saveConfirmed(input.candidateId, input.profile);
    if (!profile) {
      throw new NotFoundError(`Profile ${input.candidateId} not found`);
    }
    return profile;
  }

  /** The candidate edits an existing profile. */
  async updateProfile(candidateId: string, changes: UpdateProfileInput): Promise<CandidateProfile> {
    const updatedProfile=await this.profileRepository.update(candidateId,changes);
    if(!updatedProfile){
      throw new NotFoundError(`Profile ${candidateId} not found`);
    }
    return updatedProfile;
  }

  /** Removes one skill from a profile. */
  async deleteSkill(candidateId: string, skillName: string): Promise<void> {
    const deleted = await this.profileRepository.deleteSkill(candidateId, skillName);
    if (!deleted) {
      throw new NotFoundError(`Skill "${skillName}" not found on profile ${candidateId}`);
    }
  }

  /** Returns a profile. Used by REST (frontend) and gRPC (Job Discovery). */
  async getProfile(candidateId: string): Promise<CandidateProfile> {
    const profile=await this.profileRepository.findById(candidateId);
    if(!profile){
      throw new NotFoundError(`Profile ${candidateId} not found`);
    }
    return profile;
  }

}
