import {Router} from 'express';
import {authenticate,authorize} from '../middleware/auth.js';
import {validateCore,uuid,pagination,text,timezone} from '../middleware/core-validation.js';
import {monitoringSettings,workingHoursSettings,retentionSettings,notificationSettings} from '../validators/settings.js';
import {createSystemController} from '../controllers/system-controller.js';
import {utcTimestamp} from '../services/monitoring-validation.js';

const date=value=>utcTimestamp(value).value;
export const systemEndpoints=[
  ['get','/settings',['A'],'settings'],['put','/settings/monitoring',['A'],'monitoring',monitoringSettings],
  ['get','/settings/working-hours',['A','Agent'],'working-hours'],['put','/settings/working-hours',['A'],'working-hours-write',{...workingHoursSettings,timezone}],
  ['put','/settings/data-retention',['A'],'data-retention',retentionSettings],['put','/settings/notifications',['A'],'notification-settings',notificationSettings],
  ['get','/settings/roles',['A'],'roles'],['get','/notifications',['A','M','E'],'notifications'],
  ['patch','/notifications/read-all',['A','M','E'],'read-all'],['patch','/notifications/:id/read',['A','M','E'],'read'],
  ['delete','/notifications/:id',['A','M','E'],'delete-notification'],['get','/audit-logs/export',['A'],'audit-export'],['get','/audit-logs',['A'],'audit'],
];
export function createSystemRouter({auth,repository,config}){
  const router=Router(),controller=createSystemController({repository,config});
  router.get('/version',controller.version);
  const protect=[authenticate(auth),(req,res,next)=>{req.analytics=true;res.set('Cache-Control','no-store');next();}];
  for(const [method,path,roles,action,body]of systemEndpoints){
    const query=action==='notifications'?pagination:action.startsWith('audit')?{...pagination,from:date,to:date,actorId:uuid,action:text(80),resource:text(80)}:{};
    router[method](path,...protect,authorize(...roles),validateCore({params:path.includes(':id')?{id:uuid}:{},query,body:body||{}},{nonEmptyBody:method==='put'}),controller.handle(action));
  }
  router.get('/agent/latest',...protect,authorize('Agent'),validateCore({}),controller.latest);
  return router;
}
