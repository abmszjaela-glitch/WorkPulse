import bcrypt from 'bcrypt';
import { ApiError } from '../utils/api-error.js';

export function validatePassword(password) {
  // bcrypt truncates after 72 bytes; reject rather than silently weakening passwords.
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72
      || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^a-zA-Z0-9]/.test(password)) {
    throw new ApiError(400, 'Password must contain 12 or more characters, uppercase, lowercase, a number and a symbol, within 72 UTF-8 bytes');
  }
}

export const hashPassword = (password, rounds) => bcrypt.hash(password, rounds);
export const comparePassword = (password, hash) => bcrypt.compare(password, hash);
