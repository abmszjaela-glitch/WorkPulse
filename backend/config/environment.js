import dotenv from 'dotenv';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const supabaseUrl = required('SUPABASE_URL');
let parsedUrl;
try { parsedUrl = new URL(supabaseUrl); } catch { throw new Error('SUPABASE_URL must be a valid HTTP(S) URL'); }
if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
  throw new Error('SUPABASE_URL must be an HTTP(S) URL without embedded credentials');
}
// Prefer the server-only secret. Never expose this client to frontend code.
export const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim() || required('SUPABASE_PUBLISHABLE_KEY');
export const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');

export const corsOrigin = process.env.CORS_ORIGIN?.trim() || false;
