import {ApiError} from '../utils/api-error.js';

export function createProcessingRepository(client) {
  async function rpc(name,args){
    const {data,error}=await client.rpc(name,args);
    if(error){
      if(/^PT(400|401|403|404|409)$/.test(error.code))throw new ApiError(Number(error.code.slice(2)),error.message);
      if(error.code==='23505')throw new ApiError(409,'Duplicate application category rule');
      if(['23503','23514','22P02'].includes(error.code))throw new ApiError(400,'Invalid processing fields or relationship');
      throw new ApiError(503,'Processing storage unavailable');
    }
    return data;
  }
  return {
    categories:(actor,action,id=null,data={})=>rpc('wp_category_rules',{p_actor:actor.userId,p_device:actor.deviceId||null,p_session:actor.sessionId,
      p_action:action,p_id:id,p_data:data}),
    recalculate:(employeeId,date,timezone,force=true)=>rpc('wp_summary_recalculate',{p_employee:employeeId,p_date:date,p_zone:timezone,p_force:force}),
    enqueue:config=>rpc('wp_summary_enqueue',{p_zone:config.timezone,p_start:config.startDate,p_lookback:config.lookbackDays,p_catchup:config.catchupDays,p_delay:config.delayMinutes}),
    process:config=>rpc('wp_summary_process',{p_zone:config.timezone,p_limit:config.maxJobsPerRun,p_delay:config.delayMinutes}),
  };
}
