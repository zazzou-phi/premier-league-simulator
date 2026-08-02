import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { MatchLockedError, NotFoundError, ValidationError } from '../db/errors.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: ContentfulStatusCode,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Map domain errors onto HTTP status codes so route handlers can just rethrow. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof NotFoundError) return new ApiError(error.message, 404, error.code);
  if (error instanceof MatchLockedError) return new ApiError(error.message, 409, error.code);
  if (error instanceof ValidationError) return new ApiError(error.message, 400, error.code);
  return new ApiError('Internal server error', 500);
}

export function errorBody(error: unknown): { error: string; code?: string } {
  const apiError = toApiError(error);
  return apiError.code ? { error: apiError.message, code: apiError.code } : { error: apiError.message };
}
