import { createHash } from 'node:crypto';
import isUUID from 'validator/lib/isUUID.js';
import { ApiError } from '../utils/api-error.js';

const invalid = (message='Invalid aggregate activity record') => { throw new ApiError(400,message); };
const object = value => value !== null && typeof value==='object' && !Array.isArray(value);
function keys(value, allowed, required=[]) {
  if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))invalid();
}
const seconds = value => {if(typeof value!=='number'||!Number.isFinite(value)||value<0)invalid('Durations must be finite non-negative numbers');return value;};
const signals=['mouse_movements','mouse_clicks','key_presses'];

// Preserve the queue's microsecond precision, including timezone-offset equivalence.
export function utcTimestamp(value) {
  if(typeof value!=='string')invalid('Timezone-aware ISO timestamps are required');
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!parts)invalid('Timezone-aware ISO timestamps are required');
  const [year,month,day,hour,minute,second]=parts.slice(1,7).map(Number);
  if(year<1970||month<1||month>12||hour>23||minute>59||second>59)invalid('Invalid timestamp');
  const local=Date.UTC(year,month-1,day,hour,minute,second);
  const check=new Date(local);
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)invalid('Invalid timestamp');
  const zone=parts[8];let offset=0;
  if(zone!=='Z'){
    const h=Number(zone.slice(1,3)),m=Number(zone.slice(4,6));if(h>23||m>59)invalid('Invalid timestamp offset');
    offset=(h*60+m)*(zone[0]==='-'?-1:1);
  }
  const micros=BigInt(local)*1000n+BigInt((parts[7]||'').padEnd(6,'0'))-BigInt(offset)*60000000n;
  if(micros<0n||micros>BigInt(Number.MAX_SAFE_INTEGER))invalid('Timestamp outside supported range');
  return { micros, value:new Date(Number(micros/1000n)).toISOString().slice(0,19)+'.'+String(micros%1000000n).padStart(6,'0')+'Z' };
}

export function processName(name) {
  if(typeof name!=='string'||!name.trim()||[...name].length>255||/[\x00-\x1f<>:"/\\|?*]/.test(name))invalid('Only application process names are allowed');
  return name.toLowerCase();
}
function applications(value) {
  if(!object(value)||Object.keys(value).length>256)invalid('Application usage must be a bounded process-name mapping');
  const result=Object.create(null);
  for(const [name,duration]of Object.entries(value)) {
    const normalized=processName(name);
    if(Object.hasOwn(result,normalized))invalid('Duplicate application process name');
    result[normalized]=seconds(duration);
  }
  return result;
}
const sorted = value => object(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])) : value;
const requiredSummary=['interval_seconds','counts','active_seconds','idle_seconds','application_usage_seconds'];
const allowedSummary=[...requiredSummary,'configured_interval_seconds','status','activity_score','score_type',
  'score_is_productivity_or_performance','score_weights','reference_counts_per_minute','cumulative_application_usage_seconds'];

export function validateMonitoringRecord(input, actor, config) {
  keys(input,['record_id','employee_id','interval_start','interval_end','summary','sync_status'],
    ['record_id','employee_id','interval_start','interval_end','summary']);
  if(typeof input.record_id!=='string'||!isUUID(input.record_id))invalid('record_id must be a UUID');
  if(typeof input.employee_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}$/.test(input.employee_id))invalid('Invalid employee_id');
  if(input.sync_status!==undefined&&!['pending','synced'].includes(input.sync_status))invalid('Invalid local synchronization status');
  if(Buffer.byteLength(JSON.stringify(input))>config.maxRecordBytes)throw new ApiError(413,'Activity record is too large');
  const start=utcTimestamp(input.interval_start),end=utcTimestamp(input.interval_end);
  if(end.micros<start.micros)invalid('Interval end precedes interval start');
  const summary=input.summary;keys(summary,allowedSummary,requiredSummary);keys(summary.counts,signals,signals);
  const counts={};for(const key of signals){const value=summary.counts[key];if(!Number.isSafeInteger(value)||value<0)invalid('Invalid aggregate activity counts');counts[key]=value;}
  const elapsed=seconds(summary.interval_seconds),active=seconds(summary.active_seconds),idle=seconds(summary.idle_seconds);
  const tolerance=Math.max(1e-6,elapsed*1e-6);
  if(elapsed>config.maxIntervalSeconds||Math.abs(active+idle-elapsed)>tolerance)invalid('Active and idle durations must total the bounded interval');
  if(Math.abs(Number(end.micros-start.micros)/1e6-elapsed)>config.clockToleranceSeconds)invalid('Interval timestamps and duration differ excessively');
  if(elapsed===0&&Object.values(counts).some(value=>value>0))invalid('A zero-duration interval cannot contain activity');
  const apps=applications(summary.application_usage_seconds);
  if(elapsed===0&&Object.values(apps).some(value=>value>0))invalid('A zero-duration interval cannot contain application usage');
  if(Object.values(apps).reduce((sum,value)=>sum+value,0)>active+config.clockToleranceSeconds)invalid('Application usage exceeds active time');
  const safe={interval_seconds:elapsed,counts,active_seconds:active,idle_seconds:idle,application_usage_seconds:apps};
  if(summary.status!==undefined){if(!['ACTIVE','IDLE'].includes(summary.status))invalid('Invalid interval activity status');safe.status=summary.status;}
  if(summary.activity_score!==undefined){const score=seconds(summary.activity_score);if(score>100)invalid('Invalid activity score');
    safe.activity_score=score;safe.score_type='input_activity_intensity';safe.score_is_productivity_or_performance=false;}
  if(summary.score_type!==undefined&&summary.score_type!=='input_activity_intensity')invalid('Unsupported score type');
  if(summary.score_is_productivity_or_performance!==undefined&&summary.score_is_productivity_or_performance!==false)invalid('Activity scores are not productivity or performance');
  if(summary.configured_interval_seconds!==undefined&&(!seconds(summary.configured_interval_seconds)||summary.configured_interval_seconds>config.maxIntervalSeconds))invalid();
  for(const field of ['score_weights','reference_counts_per_minute'])if(summary[field]!==undefined){
    keys(summary[field],signals,signals);const values=Object.values(summary[field]).map(seconds);
    if(!Number.isFinite(values.reduce((a,b)=>a+b,0))||values.reduce((a,b)=>a+b,0)<=0
      ||(field==='reference_counts_per_minute'&&values.some(value=>value===0)))invalid();
  }
  if(summary.cumulative_application_usage_seconds!==undefined)applications(summary.cumulative_application_usage_seconds);
  const canonical={employee_id:actor.userId,interval_start:start.value,interval_end:end.value,summary:safe};
  return {...canonical,record_id:input.record_id.toLowerCase(),claimed_employee_id:input.employee_id,
    content_hash:createHash('sha256').update(JSON.stringify(sorted(canonical))).digest('hex')};
}
