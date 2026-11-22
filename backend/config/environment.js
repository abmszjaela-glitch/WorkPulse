import dotenv from 'dotenv';
import {ConfigurationError} from './configuration-error.js';
import {readServerKey} from './credentials.js';

const loaded=dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
if(loaded.error&&loaded.error.code!=='ENOENT')throw new ConfigurationError('Unable to read backend/.env; check file access');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigurationError(`Missing required environment variable: ${name}`);
  return value;
}

export const supabaseUrl = required('SUPABASE_URL');
let parsedUrl;
try { parsedUrl = new URL(supabaseUrl); } catch { throw new ConfigurationError('SUPABASE_URL must be a valid HTTP(S) URL'); }
if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
  throw new ConfigurationError('SUPABASE_URL must be an HTTP(S) URL without embedded credentials');
}
// Auth/RPC persistence requires server privileges. No publishable-key fallback.
export const supabaseKey = readServerKey(process.env);
export const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigurationError('PORT must be an integer between 1 and 65535');

export const corsOrigin = process.env.CORS_ORIGIN?.split(',').map(origin=>origin.trim()).filter(Boolean) || false;
