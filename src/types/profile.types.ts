/**
 * Domain types for candidate profiles.
 *
 * These are shared by REST controllers, gRPC handlers, the service layer and
 * the repository. Keep them independent of Express, gRPC and SQL.
 */

/**
 * Lifecycle of a profile. An imported resume produces a draft that the
 * candidate reviews before it is confirmed.
 * TODO 4: Decide whether you need more states.
 */
export type ProfileStatus = 'draft' | 'confirmed';

export interface CandidateProfile {
  candidateId: string;
  status: ProfileStatus;
  createdAt: Date;
  updatedAt: Date;
  // TODO 4: Add the profile fields you designed in TODO 3
  // (keep them in sync with your SQL schema).
}

/** Input for importResume(). */
export interface ImportResumeInput {
  candidateId: string;
  /**
   * Plain resume text for now.
   * TODO 14 (optional): support file uploads (PDF/DOCX) instead of raw text.
   */
  resumeText: string;
}

/** Input for confirmExtractedProfile(). */
export interface ConfirmProfileInput {
  candidateId: string;
  // TODO 4: What does the candidate send back when confirming?
  // (e.g. the reviewed/corrected version of the extracted fields)
}

/** Input for updateProfile(). */
export interface UpdateProfileInput {
  // TODO 4: Which fields may a candidate change? Should they all be optional?
}
