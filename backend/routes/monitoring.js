import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate,authorize } from '../middleware/auth.js';
import { ApiError } from '../utils/api-error.js';
import { createMonitoringController } from '../controllers/monitoring-controller.js';

export function createMonitoringRouter({auth,service,config}) {
  const root=Router(),controller=createMonitoringController(service);
  root.use(['/activity','/app-usage','/status'],authenticate(auth),authorize('Agent'),
    rateLimit({windowMs:60000,limit:config.requestsPerMinute,keyGenerator:req=>req.auth.deviceId,
      standardHeaders:'draft-8',legacyHeaders:false,message:{error:{message:'Too many device uploads; retain pending records'}}}),
    async(req,res,next)=>{res.set('Cache-Control','no-store');await service.assertDevice(req.auth);
      if(Object.keys(req.query).length)throw new ApiError(400,'Query parameters are not accepted');next();});
  root.post('/activity',controller.activity);root.post('/activity/batch',controller.activityBatch);
  root.post('/app-usage',controller.appUsage);root.post('/app-usage/batch',controller.appUsageBatch);
  root.post('/status',controller.status);
  return root;
}
