/**
 * Typed application error. Carries an HTTP status and a stable, client-safe
 * `code`. The global error handler maps these directly; everything unrecognised
 * becomes a generic 500 (see src/plugins/error-handler.ts).
 */
export interface AppErrorOptions {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  /** Whether `message`/`details` are safe to send to the client. Defaults to true for 4xx. */
  expose?: boolean;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(opts: AppErrorOptions) {
    super(opts.message);
    this.name = "AppError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.details = opts.details;
    this.expose = opts.expose ?? opts.statusCode < 500;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError({ statusCode: 400, code: "BAD_REQUEST", message, details });

export const unauthorized = (message = "Unauthorized"): AppError =>
  new AppError({ statusCode: 401, code: "UNAUTHORIZED", message });

export const forbidden = (message = "Forbidden"): AppError =>
  new AppError({ statusCode: 403, code: "FORBIDDEN", message });

export const notFound = (message = "Not found"): AppError =>
  new AppError({ statusCode: 404, code: "NOT_FOUND", message });

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError({ statusCode: 409, code: "CONFLICT", message, details });
