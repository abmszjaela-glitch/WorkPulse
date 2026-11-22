import './environment.js';
import {loadMonitoringConfig} from './monitoring.js';
import {timezone} from '../middleware/core-validation.js';
import {date} from '../validators/report-filters.js';

export function loadProcessingConfig() {
  const integer=(key,fallback,min,max)=>{const value=Number(process.env[key]||fallback);
    if(!Number.isInteger(value)||value<min||value>max)throw new Error(`Invalid ${key}`);return value;};
  const enabled=process.env.DAILY_SUMMARY_WORKER_ENABLED||'false';
  if(!['true','false'].includes(enabled))throw new Error('Invalid DAILY_SUMMARY_WORKER_ENABLED');
  return Object.freeze({enabled:enabled==='true',timezone:timezone(process.env.SUMMARY_TIMEZONE||process.env.AGENT_TIMEZONE||'Asia/Colombo'),
    startDate:process.env.SUMMARY_START_DATE?date(process.env.SUMMARY_START_DATE):null,
    lookbackDays:integer('SUMMARY_LOOKBACK_DAYS',loadMonitoringConfig().maxAgeDays,1,366),
    catchupDays:integer('SUMMARY_CATCHUP_DAYS',7,1,31),maxJobsPerRun:integer('SUMMARY_MAX_JOBS_PER_RUN',50,1,1000),
    delayMinutes:integer('SUMMARY_DELAY_MINUTES',5,0,120),pollSeconds:integer('SUMMARY_POLL_SECONDS',60,10,3600)});
}
