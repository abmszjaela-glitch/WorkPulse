import supabase from './supabase.js';
import { loadAuthConfig } from './auth.js';
import { loadAgentPolicy } from './agent-policy.js';
import { createEmailService } from '../services/email-service.js';
import { createCoreRepository } from '../services/core-repository.js';
import { createEmployeeService } from '../services/employees.js';
import { createDepartmentService } from '../services/departments.js';
import { createDeviceService } from '../services/devices.js';
import { createProfileService } from '../services/profile.js';
import { createConsentService } from '../services/consent.js';

export function createConfiguredCore(auth) {
  const repository=createCoreRepository(supabase), config=loadAuthConfig();
  return { auth,repository,employees:createEmployeeService({repository,config,mailer:createEmailService()}),
    departments:createDepartmentService({repository}),devices:createDeviceService({repository,config,policy:loadAgentPolicy()}),
    profile:createProfileService({repository}),consent:createConsentService({repository}) };
}
