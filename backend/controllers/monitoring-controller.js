export const createMonitoringController = service => ({
  activity:async(req,res)=>{const result=await service.single(req.auth,'activity',req.body);res.status(result.httpStatus).json(result.body);},
  activityBatch:async(req,res)=>{const result=await service.batch(req.auth,'activity',req.body);res.status(result.httpStatus).json(result.body);},
  appUsage:async(req,res)=>{const result=await service.single(req.auth,'app-usage',req.body);res.status(result.httpStatus).json(result.body);},
  appUsageBatch:async(req,res)=>{const result=await service.batch(req.auth,'app-usage',req.body);res.status(result.httpStatus).json(result.body);},
  status:async(req,res)=>res.json(await service.status(req.auth,req.body,req.get('Idempotency-Key'))),
});
