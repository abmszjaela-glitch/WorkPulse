import './environment.js';

function seconds(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}

// Absent configuration disables authentication; it never selects a default secret.
export function loadAuthConfig() {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('AUTH_JWT_SECRET requires at least 32 bytes');
  if (!process.env.SUPABASE_SECRET_KEY?.trim()) throw new Error('Authentication requires SUPABASE_SECRET_KEY');
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
