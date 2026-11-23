import isEmail from 'validator/lib/isEmail.js';
import isUUID from 'validator/lib/isUUID.js';
import { ApiError } from '../utils/api-error.js';

const invalid = () => { throw new ApiError(400, 'Invalid request fields'); };
export const required = (parse) => ({ parse, required: true });
export const text = (max, min = 0) => (value) => {
  if (typeof value !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) invalid();
  const normalized=value.trim().normalize('NFC');
  if ([...normalized].length < min || [...normalized].length > max) invalid();
  return normalized;
};
export const uuid = (value) => { if (typeof value !== 'string' || !isUUID(value)) invalid(); return value; };
export const nullableUuid = (value) => value === null ? null : uuid(value);
export const boolean = (value) => { if (typeof value !== 'boolean') invalid(); return value; };
export const choice = (...values) => (value) => { if (!values.includes(value)) invalid(); return value; };
export const integer = (min, max) => (value) => {
  if (!['number','string'].includes(typeof value) || !/^\d+$/.test(String(value))) invalid();
  const number = Number(value); if (!Number.isSafeInteger(number) || number < min || number > max) invalid(); return number;
};
export const email = (value) => { const normalized = text(254, 3)(value).toLowerCase(); if (!isEmail(normalized)) invalid(); return normalized; };
export const ids = (value) => {
  if (!Array.isArray(value) || !value.length || value.length > 100 || new Set(value).size !== value.length) invalid();
  return value.map(uuid);
};
export const timezone = (value) => {
  const zone = text(100, 1)(value);
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { invalid(); } return zone;
};
export const pagination = { page: integer(1, 100000), pageSize: integer(1, 100) };
export const filters = { ...pagination, search: text(100), status: choice('active','inactive') };

// Explicit allowlists prevent mass assignment (role/profile/employee ownership).
export function validateCore(schema, { nonEmptyBody = false } = {}) {
  return (req, res, next) => {
    req.input = {};
    for (const source of ['body','query','params']) {
      const input = req[source] || {}, rules = schema[source] || {};
      if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(rules,key))) invalid();
      req.input[source] = {};
      for (const [key, rule] of Object.entries(rules)) {
        if (input[key] === undefined) { if (rule.required) invalid(); continue; }
        req.input[source][key] = (typeof rule === 'function' ? rule : rule.parse)(input[key]);
      }
    }
    if (nonEmptyBody && !Object.keys(req.input.body).length) invalid();
    next();
  };
}
