import supabase from './supabase.js';
import { loadMonitoringConfig } from './monitoring.js';
import { createMonitoringRepository } from '../services/monitoring-repository.js';
import { createMonitoringService } from '../services/monitoring.js';

export function createConfiguredMonitoring(auth) {
  const config=loadMonitoringConfig();
  return {auth,config,service:createMonitoringService({repository:createMonitoringRepository(supabase),config})};
}
