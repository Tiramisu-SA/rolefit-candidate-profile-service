import * as grpc from '@grpc/grpc-js';
import type { ProfileService } from '../services/profile.service';
import type { CandidateProfile } from '../types/profile.types';
import { AppError, NotImplementedError } from '../utils/errors';
import { logger } from '../utils/logger';

/*
 * gRPC adapter: translates gRPC <-> ProfileService calls.
 *
 * Like the REST controller, it holds no business logic. It reuses the SAME
 * ProfileService instance, so REST and gRPC always behave the same way.
 *
 * Message shapes mirror proto/candidate-profile.proto. The proto loader uses
 * keepCase: true, so field names stay snake_case.
 */

export interface GetProfileRequest {
  candidate_id: string;
}

export interface CandidateProfileMessage {
  candidate_id: string;
  status: string;
  // TODO 16: keep in sync with the proto CandidateProfile message.
}

export interface GetProfileResponse {
  profile: CandidateProfileMessage;
}

/** Converts the domain model into the proto message. */
function toProtoProfile(profile: CandidateProfile): CandidateProfileMessage {
  // TODO 17: Map domain fields to the proto message.
  void profile;
  throw new NotImplementedError('toProtoProfile');
}

/** Converts service errors into gRPC status objects. */
function toGrpcError(err: unknown): grpc.ServerErrorResponse {
  if (err instanceof NotImplementedError) {
    return { name: err.name, message: err.message, code: grpc.status.UNIMPLEMENTED };
  }
  // TODO 17: Map your domain errors (TODO 8) to proper gRPC status codes
  // (think: which code means "not found"? "invalid argument"?).
  if (err instanceof AppError) {
    return { name: err.name, message: err.message, code: grpc.status.UNKNOWN };
  }
  logger.error('Unhandled gRPC error', err);
  return { name: 'InternalError', message: 'Internal error', code: grpc.status.INTERNAL };
}

export function createCandidateProfileHandlers(
  profileService: ProfileService,
): grpc.UntypedServiceImplementation {
  const GetProfile: grpc.handleUnaryCall<GetProfileRequest, GetProfileResponse> = async (call, callback) => {
    try {
      // TODO 17: Validate call.request.candidate_id before calling the service.
      const profile = await profileService.getProfile(call.request.candidate_id);
      callback(null, { profile: toProtoProfile(profile) });
    } catch (err) {
      callback(toGrpcError(err), null);
    }
  };

  return { GetProfile };
}
