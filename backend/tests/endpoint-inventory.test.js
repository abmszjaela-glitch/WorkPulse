import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCoreRouter} from '../routes/core.js';
import {createAuthRouter} from '../routes/auth.js';
import {createAnalyticsRouter} from '../routes/analytics.js';
import {createReportRouter} from '../routes/reports.js';
import {createSystemRouter} from '../routes/system.js';
import {createMonitoringRouter} from '../routes/monitoring.js';
import {createCategoryRouter} from '../routes/categories.js';

// Route inspection only, not a mock success/data test. Existing integration tests
// execute controllers/services/RPCs against isolated PostgreSQL for behavior.
test('all 99 document method/path pairs exist exactly once in actual routers',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../reports/api-document-manifest.json',import.meta.url),'utf8'));
 const implemented=[];
 function walk(router,prefix='',mounts=[]){let index=0;for(const layer of router.stack){
  if(layer.route)for(const method of Object.keys(layer.route.methods))implemented.push(method.toUpperCase()+' '+(prefix+layer.route.path).replace(/\/$/,''));
  else if(layer.handle?.stack)walk(layer.handle,prefix+mounts[index++]);
 }}
 const unused=new Proxy({},{get:()=>()=>{throw new Error('Inventory must not execute handlers');}});
 walk(createAuthRouter(unused),'/auth');
 walk(createCoreRouter({auth:unused,employees:unused,departments:unused,devices:unused,profile:unused,consent:unused}),'',['/employees','/departments','/devices','/profile','/consent']);
 walk(createAnalyticsRouter({auth:unused,service:unused}));walk(createReportRouter({auth:unused,service:unused}),'',['/reports']);
 walk(createSystemRouter({auth:unused,repository:unused,config:{}}));
 walk(createMonitoringRouter({auth:unused,service:unused,config:{requestsPerMinute:120}}));
 walk(createCategoryRouter({auth:unused,service:unused}),'',['/app-categories']);implemented.push('GET /health');
 const documented=manifest.endpoints.map(x=>x.method+' '+x.path);
 assert.equal(documented.length,99);assert.equal(new Set(implemented).size,implemented.length,'Duplicate endpoints');
 // Explicit Agent enrollment extensions reuse the existing authorization model.
 const extensions=['POST /devices/provision','POST /devices/token'];
 assert.deepEqual(implemented.sort(),[...documented,...extensions].sort());
});
