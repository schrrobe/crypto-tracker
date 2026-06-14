export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }

  static notFound(message = 'Nicht gefunden') {
    return new AppError('NOT_FOUND', 404, message)
  }

  static unauthorized(message = 'Nicht angemeldet') {
    return new AppError('UNAUTHORIZED', 401, message)
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new AppError(code, 400, message, details)
  }

  static conflict(code: string, message: string) {
    return new AppError(code, 409, message)
  }

  // 402 Payment Required — feature requires a Pro subscription
  static upgradeRequired(message = 'Diese Funktion erfordert Crypto Tracker Pro') {
    return new AppError('PLAN_UPGRADE_REQUIRED', 402, message)
  }
}
