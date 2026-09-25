import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { ProfileService } from '../services/profile.service';
import { createCandidateProfileHandlers } from './candidate-profile.grpc';

// Works from both src/grpc (tsx) and dist/grpc (compiled).
const PROTO_PATH = path.resolve(__dirname, '../../proto/candidate-profile.proto');

function loadCandidateProfileService(): grpc.ServiceDefinition {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition);
  const rolefit = loaded.rolefit as grpc.GrpcObject;
  const pkg = (rolefit.candidateprofile as grpc.GrpcObject).v1 as grpc.GrpcObject;
  return (pkg.CandidateProfileService as grpc.ServiceClientConstructor).service;
}

export function createGrpcServer(profileService: ProfileService): grpc.Server {
  const server = new grpc.Server();
  server.addService(loadCandidateProfileService(), createCandidateProfileHandlers(profileService));
  return server;
}

/**
 * Binds and starts the gRPC server. Resolves with the bound port.
 *
 * Uses insecure credentials: fine for internal traffic in local development.
 * For production you would add TLS/mTLS between services.
 */
export function startGrpcServer(server: grpc.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) return reject(err);
      resolve(boundPort);
    });
  });
}
