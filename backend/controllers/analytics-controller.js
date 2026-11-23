import {csv} from '../utils/csv.js';
export function createAnalyticsController(service){
  return (action,{own=false,exportCsv=false}={})=>async(req,res)=>{
    const target=own?req.auth.userId:req.input.params.id||null;
    const result=await service.query(req.auth,action,target,req.input.query);
    if(exportCsv)return res.type('text/csv').attachment('application-usage.csv').send(csv(result.data,[['Application','application_name'],['Seconds','seconds'],['Users','users'],['Category','category']]));
    res.json(result);
  };
}
