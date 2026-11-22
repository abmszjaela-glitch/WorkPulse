import {Router} from 'express';
import {authenticate,authorize} from '../middleware/auth.js';
import {validateCore,required,uuid,pagination} from '../middleware/core-validation.js';
import {reportFilters,validateDateRange} from '../validators/report-filters.js';
import {createReportController} from '../controllers/report-controller.js';

export const reportEndpoints=[['/daily','daily','rows'],['/weekly','weekly','rows'],['/monthly','monthly','rows'],
  ['/department/:id','department','rows'],['/employee/:id','employee','rows'],['/kpis','weekly','kpis'],['/charts','weekly','charts'],
  ['/recent-exports','weekly','history'],['/export/csv','weekly','csv'],['/export/pdf','weekly','pdf']];
export function createReportRouter({auth,service}){
  const root=Router(),router=Router(),handler=createReportController(service);
  router.use((req,res,next)=>{req.analytics=true;res.set('Cache-Control','no-store');next();},authenticate(auth),authorize('A','M'));
  for(const [path,kind,action]of reportEndpoints)router.get(path,validateCore({query:action==='history'?pagination:reportFilters,
    params:path.includes(':id')?{id:required(uuid)}:{}}),validateDateRange,handler(kind,action));
  root.use('/reports',router);return root;
}
