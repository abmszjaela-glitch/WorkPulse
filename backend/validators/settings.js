import {boolean,choice,integer,text} from '../middleware/core-validation.js';
import {ApiError} from '../utils/api-error.js';

// Shared allowlists use the existing dashboard settings field names.
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const schedule=value=>{
  if(!Array.isArray(value)||value.length!==7)throw new ApiError(400,'A seven-day schedule is required');
  return value.map((row,index)=>{
    if(!row||typeof row!=='object'||Object.keys(row).some(key=>!['day','enabled','start','end'].includes(key))
      ||row.day!==days[index]||typeof row.enabled!=='boolean'||![row.start,row.end].every(time=>typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      ||row.start===row.end)throw new ApiError(400,'Invalid working-hours schedule');
    return {day:row.day,enabled:row.enabled,start:row.start,end:row.end};
  });
};
const strictInteger=(min,max)=>value=>{if(typeof value!=='number')throw new ApiError(400,'Invalid settings value');return integer(min,max)(value);};
export const monitoringSettings={idleMinutes:strictInteger(1,30),evaluationSeconds:choice(30,60,120,300),syncMinutes:choice(1,5,15,30),
  offlineDays:strictInteger(1,30),trackApplications:boolean,trackKeyboardCounts:boolean,trackMouseCounts:boolean,pauseOutsideHours:boolean};
export const workingHoursSettings={schedule};
export const retentionSettings={retentionDays:choice(30,60,90,180,365),requireConsent:boolean};
export const notificationSettings={notifyIdle:boolean,notifyAgentOffline:boolean,weeklyDigest:boolean};
export const securitySettings={sessionMinutes:choice(15,30,60,120),requireMfa:boolean};
export const policySettings={policy:text(50000,1)};
