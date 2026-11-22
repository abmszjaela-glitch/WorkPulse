import {ApiError} from '../utils/api-error.js';
import {loadProcessingConfig} from '../config/processing.js';
import {loadMonitoringConfig} from '../config/monitoring.js';

export function createAnalyticsService({client,timezone=loadProcessingConfig().timezone,offlineTimeoutSeconds=loadMonitoringConfig().offlineTimeoutSeconds}){
  return {async query(actor,action,target,input){
    const zone=input.timezone||timezone;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
    const to=input.to||`${parts.year}-${parts.month}-${parts.day}`;
    const from=input.from||(['trend','active-vs-idle','app-trend'].includes(action)?new Date(Date.parse(to)-6*86400000).toISOString().slice(0,10):to);
    if(from>to||(Date.parse(to)-Date.parse(from))/86400000>366||action==='timeline'&&(Date.parse(to)-Date.parse(from))/86400000>30)throw new ApiError(400,'Invalid or excessive analytics date range');
    const {data,error}=await client.rpc('wp_analytics',{p_actor:actor.userId,p_device:actor.deviceId||null,p_session:actor.sessionId,
      p_action:action,p_target:target,p_options:{...input,from,to,timezone:zone,offlineTimeoutSeconds}});
    if(error){if(/^PT(400|401|403|404|413)$/.test(error.code))throw new ApiError(Number(error.code.slice(2)),error.message);
      throw new ApiError(503,'Analytics storage unavailable');}
    return {success:true,message:'Analytics retrieved',...data,meta:{from,to,timezone:zone,productivity_score:null,classification_basis:'current_rules_and_current_department'}};
  }};
}
