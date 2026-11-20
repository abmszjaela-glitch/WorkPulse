import { loadAuthConfig } from './auth.js';
import supabase from './supabase.js';
import { createAuthRepository } from '../services/auth-repository.js';
import { createAuthService } from '../services/auth-service.js';
import { createEmailService } from '../services/email-service.js';

export function createConfiguredAuthService() {
  return createAuthService({ repository: createAuthRepository(supabase), config: loadAuthConfig(), mailer: createEmailService() });
}
