/**
 * Structured application errors for VERITAS Learn trusted data operations.
 *
 * Every trusted route should fail with one of these codes so the client receives
 * a predictable, machine-readable error shape instead of an opaque 500.
 */
import type { Response } from "express";

export type AppErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_READ_FAILED"
  | "DATABASE_WRITE_FAILED"
  | "INVALID_QUESTION"
  | "INVALID_ATTEMPT"
  | "COMPLETION_REQUIREMENTS_NOT_MET";

export interface AppError {
  error: true;
  code: AppErrorCode;
  message: string;
  details?: unknown;
}

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  DATABASE_UNAVAILABLE: 503,
  DATABASE_READ_FAILED: 500,
  DATABASE_WRITE_FAILED: 500,
  INVALID_QUESTION: 400,
  INVALID_ATTEMPT: 400,
  COMPLETION_REQUIREMENTS_NOT_MET: 409,
};

/** Error subclass that carries an AppErrorCode so it can be thrown and serialized uniformly. */
export class AppErrorException extends Error {
  code: AppErrorCode;
  details?: unknown;
  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppErrorException";
    this.code = code;
    this.details = details;
  }
}

export function appError(code: AppErrorCode, message: string, details?: unknown): AppErrorException {
  return new AppErrorException(code, message, details);
}

export function toAppError(code: AppErrorCode, message: string, details?: unknown): AppError {
  return { error: true, code, message, ...(details !== undefined ? { details } : {}) };
}

/** Serialize an AppError (or unknown thrown value) to the HTTP response. */
export function sendAppError(res: Response, err: unknown, fallbackCode: AppErrorCode = "DATABASE_WRITE_FAILED"): void {
  if (err instanceof AppErrorException) {
    res.status(STATUS_BY_CODE[err.code]).json(toAppError(err.code, err.message, err.details));
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(STATUS_BY_CODE[fallbackCode]).json(toAppError(fallbackCode, message));
}

/** Convenience for explicitly emitting a code without throwing. */
export function fail(res: Response, code: AppErrorCode, message: string, details?: unknown): void {
  res.status(STATUS_BY_CODE[code]).json(toAppError(code, message, details));
}
