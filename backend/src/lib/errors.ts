export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, message, 'BAD_REQUEST', details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, message, 'FORBIDDEN');
export const notFound = (what = 'Resource') => new AppError(404, `${what} not found`, 'NOT_FOUND');
export const conflict = (message: string) => new AppError(409, message, 'CONFLICT');
export const gone = (message: string, code = 'GONE') => new AppError(410, message, code);
export const tooManyRequests = (message: string) => new AppError(429, message, 'RATE_LIMITED');
export const serviceUnavailable = (message: string, code = 'SERVICE_UNAVAILABLE') => new AppError(503, message, code);
