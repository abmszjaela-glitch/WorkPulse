import {Router} from 'express';
import {authenticate,authorize} from '../middleware/auth.js';
import {validateCore,required,uuid,text,choice,pagination,timezone} from '../middleware/core-validation.js';
import {date} from '../validators/report-filters.js';
import {processName} from '../services/monitoring-validation.js';
import {createAnalyticsController} from '../controllers/analytics-controller.js';

export const analyticsEndpoints=[
  ['/activity/employee/:id','activity',['A','M']],['/activity/employee/:id/timeline','timeline',['A','M']],
  ['/activity/employee/:id/log','log',['A','M']],['/activity/employee/:id/summary','summary',['A','M']],
  ['/activity/employee/:id/trend','trend',['A','M']],['/activity/me','own',['E'],true],['/activity/me/summary','own-summary',['E','Agent'],true],
  ['/app-usage','apps',['A','M']],['/app-usage/top','top',['A','M']],['/app-usage/categories-breakdown','breakdown',['A','M']],
  ['/app-usage/trend','app-trend',['A','M']],['/app-usage/employee/:id','apps',['A','M']],['/app-usage/export','export',['A','M'],false,true],
  ['/dashboard/stats','stats',['A','M']],['/dashboard/active-vs-idle','active-vs-idle',['A','M']],
  ['/dashboard/app-usage-summary','breakdown',['A','M']],['/dashboard/live-status','live',['A','M']],
  ['/dashboard/top-apps','top',['A','M']],['/dashboard/department-productivity','departments',['A','M']],
];
export function createAnalyticsRouter({auth,service}){
  const router=Router(),handler=createAnalyticsController(service);
  for(const [path,action,roles,own,exportCsv]of analyticsEndpoints){
    const query={...pagination,from:date,to:date,timezone,...(!own?{departmentId:uuid}:{})};
    if(['log','activity','own'].includes(action))Object.assign(query,{status:choice('ACTIVE','IDLE'),applicationName:processName});
    if(action==='live')Object.assign(query,{status:choice('ACTIVE','IDLE','PAUSED','OFFLINE','UNKNOWN'),search:text(100)});
    router.get(path,(req,res,next)=>{req.analytics=true;next();},authenticate(auth),authorize(...roles),validateCore({query,params:path.includes(':id')?{id:required(uuid)}:{}}),
      (req,res,next)=>{res.set('Cache-Control','no-store');next();},handler(action,{own,exportCsv}));
  }
  return router;
}
