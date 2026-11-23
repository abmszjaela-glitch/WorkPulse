import { ApiError } from '../utils/api-error.js';

export function createMonitoringRepository(client) {
  async function rpc(name,args) {
    const {data,error}=await client.rpc(name,args);
    if(error){
      if(/^PT(400|401|403|404|409|413)$/.test(error.code))throw new ApiError(Number(error.code.slice(2)),error.message);
      throw new ApiError(503,'Monitoring storage unavailable; retain pending records');
    }
    return data;
  }
  const identity=actor=>({p_actor:actor.userId,p_device:actor.deviceId,p_session:actor.sessionId});
  return {
    authorize:actor=>rpc('wp_monitoring_authorize',identity(actor)),
    batch:(actor,kind,records,policy)=>rpc('wp_monitoring_batch',{...identity(actor),p_kind:kind,p_records:records,p_policy:policy}),
    status:(actor,status,id,policy)=>rpc('wp_monitoring_status',{...identity(actor),p_status:status,p_id:id,p_policy:policy}),
  };
}
