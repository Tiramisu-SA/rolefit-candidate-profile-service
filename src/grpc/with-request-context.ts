import * as grpc from '@grpc/grpc-js';
import { logger } from '../utils/logger';
import { REQUEST_ID_KEY, resolveRequestId, runWithRequestId } from '../utils/request-context';

/**
 * Wraps a unary handler: takes the request id from the caller's metadata (or
 * creates one), makes it the current id while the handler runs, and logs one
 * line when the call ends.
 */
export function withRequestContext<Req, Res>(rpc: string, handler: grpc.handleUnaryCall<Req, Res>): grpc.handleUnaryCall<Req, Res> {
  return (call, callback) => {
    const requestId = resolveRequestId(call.metadata.get(REQUEST_ID_KEY)[0]);
    const start = process.hrtime.bigint();
    runWithRequestId(requestId, () =>
      handler(call, (error, value, trailer, flags) => {
        const code = error ? (error.code ?? grpc.status.UNKNOWN) : grpc.status.OK;
        logger.info('rpc completed', {
          requestId,
          rpc,
          grpcStatus: grpc.status[code],
          durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10,
        });
        callback(error, value, trailer, flags);
      }),
    );
  };
}
