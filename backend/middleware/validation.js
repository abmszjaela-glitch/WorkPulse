import { body, validationResult } from 'express-validator';
import { ApiError } from '../utils/api-error.js';

export const emailField = () => body('email').isString().bail().trim().isLength({ max: 254 }).isEmail();
export const passwordField = (name) => body(name).isString().bail().isLength({ min: 1, max: 72 })
  .custom(value => Buffer.byteLength(value) <= 72);
export const tokenField = (name) => body(name).isString().bail().matches(/^[A-Za-z0-9_-]{43}$/);
export function validate(req, res, next) {
  if (!validationResult(req).isEmpty()) throw new ApiError(400, 'Invalid request fields');
  next();
}
