import './environment.js';
import {readJwtSecret} from './credentials.js';
import {ConfigurationError} from './configuration-error.js';

function seconds(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new ConfigurationError(`Invalid ${name}`);
  return value;
}

// Environment is loaded first; absent/invalid configuration blocks startup.
export function loadAuthConfig() {
  const secret = readJwtSecret(process.env);
  return Object.freeze({
    secret,
    issuer: 'workpulse-api',
    userAudience: 'workpulse-dashboard',
    agentAudience: 'workpulse-agent',
    accessSeconds: seconds('AUTH_ACCESS_SECONDS', 900, 60, 3600),
    refreshSeconds: seconds('AUTH_REFRESH_SECONDS', 604800, 3600, 2592000),
    resetSeconds: seconds('AUTH_RESET_SECONDS', 1800, 60, 3600),
    temporarySeconds: seconds('AUTH_TEMPORARY_SECONDS', 86400, 300, 604800),
    bcryptRounds: seconds('AUTH_BCRYPT_ROUNDS', 12, 10, 15),
  });
}
