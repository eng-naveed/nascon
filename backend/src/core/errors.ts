export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details: Record<string, unknown> = {},
    public headers: Record<string, string> = {},
  ) {
    super(message ?? code);
  }
}

export const validation = (fields: string[], message = 'Request validation failed.') =>
  new AppError(400, 'VALIDATION_ERROR', message, { fields });
export const notFound = (code: string, message: string, details: Record<string, unknown> = {}) =>
  new AppError(404, code, message, details);
export const conflict = (code: string, message: string, details: Record<string, unknown> = {}) =>
  new AppError(409, code, message, details);
export const forbidden = (message = 'You are not allowed to do this.') =>
  new AppError(403, 'FORBIDDEN', message);
export const unauthenticated = (message = 'Missing or invalid token.') =>
  new AppError(401, 'UNAUTHENTICATED', message);
