import {ApiError} from '../utils/api-error.js';

export function createSystemRepository(client){
  async function rpc(name,args){
    const {data,error}=await client.rpc(name,args);
    if(error){
      const status=/^PT(400|401|403|404|409|413)$/.test(error.code)?Number(error.code.slice(2)):503;
      throw new ApiError(status,({400:'Invalid system request',401:'Session expired',403:'Forbidden',404:'Record not found',409:'Conflicting update',413:'Result too large'})[status]||'System storage unavailable');
    }
    return data;
  }
  return {
    run:(actor,action,id=null,data={})=>rpc('wp_system',{p_actor:actor.userId,p_device:actor.deviceId||null,p_session:actor.sessionId,p_action:action,p_id:id,p_data:data}),
    events:(after=null,timeout=300)=>rpc('wp_system_events',{p_after:after,p_timeout:timeout}),
    visible:(actor,event)=>rpc('wp_system_event_visible',{p_actor:actor.userId,p_device:actor.deviceId||null,p_session:actor.sessionId,p_event:event}),
    stats:async(actor,offlineTimeoutSeconds)=>{const date=new Date().toISOString().slice(0,10);return rpc('wp_analytics',{p_actor:actor.userId,p_device:null,p_session:actor.sessionId,p_action:'stats',p_target:null,p_options:{from:date,to:date,timezone:'UTC',offlineTimeoutSeconds}});},
  };
}
