export class AppError extends Error {
  constructor(message, status) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

export class AuthError extends AppError {
  constructor(message = 'Login dulu') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Akses ditolak') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(message, 404);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Terlalu banyak percobaan. Tunggu beberapa menit.') {
    super(message, 429);
  }
}
