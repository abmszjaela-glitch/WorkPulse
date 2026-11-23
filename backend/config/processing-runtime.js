import supabase from './supabase.js';
import {loadProcessingConfig} from './processing.js';
import {createProcessingRepository} from '../services/processing-repository.js';
import {createCategoryService} from '../services/categories.js';
import {createDailySummaryService} from '../services/daily-summaries.js';

export function createConfiguredProcessing(){
  const config=loadProcessingConfig(),repository=createProcessingRepository(supabase);
  if(config.enabled&&!process.env.SUPABASE_SECRET_KEY?.trim())throw new Error('Summary worker requires the server-only Supabase key');
  return {config,categories:createCategoryService({repository}),summaries:createDailySummaryService({repository,config})};
}
