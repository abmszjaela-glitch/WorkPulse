import {ApiError} from '../utils/api-error.js';

// The database enforces ownership and authorization again inside each RPC.
export function createSystemController({repository,config}){
  const handle=action=>async(req,res)=>{
    if(action==='data-retention'&&req.input.body.requireConsent===false)throw new ApiError(400,'Employee consent cannot be disabled');
    const result=await repository.run(req.auth,action,req.input.params.id||null,{...req.input.query,...req.input.body});
    if(action==='audit-export'){
      const cell=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
      const keys=['id','actor_id','action','resource','resource_id','created_at'];
      res.attachment('WorkPulse-audit.csv').type('text/csv').send('\uFEFF'+[keys,...result.data.map(row=>keys.map(key=>row[key]))].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n');return;
    }
    res.json({success:true,message:'Request completed',...result});
  };
  return {handle,version:(req,res)=>res.json({success:true,data:{version:config.version,minimumAgentVersion:config.minimumAgentVersion}}),latest:async(req,res)=>{
    await repository.run(req.auth,'agent-authorize');
    if(!config.latestAgent)throw new ApiError(503,'Agent installer release is not configured');
    res.json({success:true,data:config.latestAgent});
  }};
}
