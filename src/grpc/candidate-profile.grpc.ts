import * as grpc from '@grpc/grpc-js';
import type { ProfileService } from '../services/profile.service';
import type { CandidateProfile } from '../types/profile.types';
import { AppError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

/*
 * gRPC adapter: translates gRPC <-> ProfileService calls.
 *
 * Like the REST controller, it holds no business logic. It reuses the SAME
 * ProfileService instance, so REST and gRPC always behave the same way.
 *
 * Message shapes mirror proto/candidate-profile.proto. The proto loader uses
 * keepCase: true, so field names stay snake_case. Proto3 has no null, so
 * missing values are sent as "" / 0 / unset.
 */

export interface GetProfileRequest {
  candidate_id: string;
}

export interface CandidateProfileMessage {
  candidate_id: string;
  user_id: string;
  name: string;
  headline: string;
  location: string;
  total_experience_months: number;
  skills: { name: string; proficiency_level: string }[];
  experience: {
    company_name: string;
    job_title: string;
    start_date: string;
    end_date: string;
    is_current: boolean;
    bullets: string[];
  }[];
  education: { institution_name: string; degree: string; field_of_study: string; gpa: number; year: string }[];
  projects: { name: string; tech: string[]; bullets: string[] }[];
  preferences?: {
    employment_types: string[];
    preferred_roles: string[];
    work_arrangements: string[];
    preferred_locations: string[];
    minimum_salary: number;
    salary_currency: string;
  };
  verified: boolean;
  updated_at: string;
}

export interface GetProfileResponse {
  profile: CandidateProfileMessage;
}

/** Converts the domain model into the proto message. */
export function toProtoProfile(p: CandidateProfile): CandidateProfileMessage {
  return {
    candidate_id: p.id,
    user_id: p.userId,
    name: p.name,
    headline: p.headline ?? '',
    location: p.location ?? '',
    total_experience_months: p.totalExperienceMonths,
    skills: p.skills.map((s) => ({ name: s.name, proficiency_level: s.proficiencyLevel ?? '' })),
    experience: p.experience.map((e) => ({
      company_name: e.companyName,
      job_title: e.jobTitle,
      start_date: e.startDate ?? '',
      end_date: e.endDate ?? '',
      is_current: e.isCurrent,
      bullets: e.bullets,
    })),
    education: p.education.map((e) => ({
      institution_name: e.institutionName,
      degree: e.degree,
      field_of_study: e.fieldOfStudy ?? '',
      gpa: e.gpa ?? 0,
      year: e.year ?? '',
    })),
    projects: p.projects.map((pr) => ({ name: pr.name, tech: pr.tech, bullets: pr.bullets })),
    preferences: p.preferences
      ? {
          employment_types: p.preferences.employmentTypes,
          preferred_roles: p.preferences.preferredRoles,
          work_arrangements: p.preferences.workArrangements,
          preferred_locations: p.preferences.preferredLocations,
          minimum_salary: p.preferences.minimumSalary ?? 0,
          salary_currency: p.preferences.salaryCurrency ?? '',
        }
      : undefined,
    verified: p.verified,
    updated_at: p.updatedAt.toISOString(),
  };
}

const STATUS_BY_HTTP: Record<number, grpc.status> = {
  400: grpc.status.INVALID_ARGUMENT,
  401: grpc.status.UNAUTHENTICATED,
  404: grpc.status.NOT_FOUND,
  409: grpc.status.ALREADY_EXISTS,
};

/** Converts service errors into gRPC status objects. */
function toGrpcError(err: unknown): Partial<grpc.ServiceError> {
  if (err instanceof ValidationError) {
    const fields = err.details.map((d) => `${d.field}: ${d.message}`).join('; ');
    return { code: grpc.status.INVALID_ARGUMENT, details: fields || err.message };
  }
  if (err instanceof AppError && STATUS_BY_HTTP[err.httpStatus] !== undefined) {
    return { code: STATUS_BY_HTTP[err.httpStatus], details: err.message };
  }
  logger.error('Unhandled gRPC error', err);
  return { code: grpc.status.INTERNAL, details: 'Internal error' };
}

export function createCandidateProfileHandlers(profileService: ProfileService): grpc.UntypedServiceImplementation {
  const GetProfile: grpc.handleUnaryCall<GetProfileRequest, GetProfileResponse> = async (call, callback) => {
    try {
      const profile = await profileService.getProfileById(call.request.candidate_id);
      callback(null, { profile: toProtoProfile(profile) });
    } catch (err) {
      callback(toGrpcError(err), null);
    }
  };

  return { GetProfile };
}
