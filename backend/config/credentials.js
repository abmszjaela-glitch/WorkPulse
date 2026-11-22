import {ConfigurationError} from './configuration-error.js';

export function readJwtSecret(env){
  const primary=env.AUTH_JWT_SECRET?.trim(),legacy=env.JWT_SECRET?.trim();
  if(primary&&legacy&&primary!==legacy)throw new ConfigurationError('AUTH_JWT_SECRET and JWT_SECRET conflict; configure only one signing secret');
  const secret=primary||legacy;
  if(!secret)throw new ConfigurationError('Missing AUTH_JWT_SECRET (JWT_SECRET is also supported)');
  if(Buffer.byteLength(secret)<32)throw new ConfigurationError('AUTH_JWT_SECRET / JWT_SECRET must contain at least 32 bytes');
  return secret;
}

export function readServerKey(env){
  const key=env.SUPABASE_SECRET_KEY?.trim();
  if(!key)throw new ConfigurationError('Missing SUPABASE_SECRET_KEY; a server-only Supabase key is required');
  // Classification is a guard against accidentally using a public key, not
  // cryptographic validation. Supabase validates the supplied credential itself.
  let serviceRole=false;
  if(key.split('.').length===3){
    try{serviceRole=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='service_role';}catch{}
  }
  if(!key.startsWith('sb_secret_')&&!serviceRole)throw new ConfigurationError('SUPABASE_SECRET_KEY must be a server secret key or legacy service_role key; publishable/anon keys are not permitted');
  return key;
}
