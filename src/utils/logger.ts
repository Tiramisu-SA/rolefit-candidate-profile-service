/**
 * Minimal logger wrapper. Swap for pino/winston later if you want structured logs.
 */
export const logger = {
  info: (...args: unknown[]) => console.log('[candidate-profile]', ...args),
  warn: (...args: unknown[]) => console.warn('[candidate-profile]', ...args),
  error: (...args: unknown[]) => console.error('[candidate-profile]', ...args),
};
