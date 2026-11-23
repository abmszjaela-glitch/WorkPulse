import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {postgresClient} from './postgres-client.js';
import {createAuthRepository} from '../services/auth-repository.js';
import {createAuthService} from '../services/auth-service.js';
import {hashPassword} from '../services/passwords.js';
import {createAnalyticsService} from '../services/analytics.js';
import {createAnalyticsRouter,analyticsEndpoints} from '../routes/analytics.js';
import {errorHandler,notFound} from '../middleware/error-handler.js';

const db=new PGlite(),client=postgresClient(db),secret=randomBytes(48).toString('hex');
const auth=createAuthService({repository:createAuthRepository(client),mailer:{},config:{secret,issuer:'test',userAudience:'users',agentAudience:'devices',
  accessSeconds:900,refreshSeconds:86400,temporarySeconds:86400,bcryptRounds:10}});
let server,base,A,M,E,O,D,dept,hash;
const examples=[];
const day=new Date(Date.now()-86400000).toISOString().slice(0,10);
async function seed(role){const id=randomUUID(),email=id+'@example.test';await db.query('insert into wp_auth_users(id,email,password_hash,role) values($1,$2,$3,$4)',[id,email,hash,role]);
  const result=await auth.login(email,'Synthetic-password-123!');return{id,token:result.accessToken,context:await auth.authenticate(result.accessToken)};}
async function get(path,actor=A){return fetch(base+'/api/v1'+path,{headers:actor?{Authorization:'Bearer '+actor.token}:{}});}
const dated=path=>path+(path.includes('?')?'&':'?')+`from=${day}&to=${day}&timezone=UTC`;
before(async()=>{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const name of ['001_auth','002_core_management','003_monitoring','004_processing','005_analytics'])await db.exec(await readFile(new URL('../migrations/'+name+'.proposed.sql',import.meta.url),'utf8'));
  await db.exec('set role service_role');hash=await hashPassword('Synthetic-password-123!',10);
  A=await seed('A');M=await seed('M');E=await seed('E');O=await seed('E');dept=randomUUID();
  await db.query('insert into wp_departments(id,name,manager_id) values($1,$2,$3)',[dept,'Synthetic engineering',M.id]);
  await db.query('update wp_employee_profiles set department_id=$1 where user_id=$2',[dept,E.id]);
  const device=await auth.provisionDevice(A.context,E.id);await db.query('update wp_auth_devices set registered_at=now(),last_seen=now() where id=$1',[device.deviceId]);
  D={token:(await auth.loginDevice(device.deviceId,device.credential)).accessToken};
  await db.query("insert into wp_device_presence(device_id,reported_status,status_at) values($1,'ACTIVE',now())",[device.deviceId]);
  const record=randomUUID();await db.query("insert into wp_activity_intervals(device_id,record_id,employee_id,interval_start,interval_end,interval_seconds,active_seconds,idle_seconds,mouse_movements,mouse_clicks,key_presses,summary,content_hash) values($1,$2,$3,$4,$5,3600,2700,900,120,10,50,$6,$7)",
    [device.deviceId,record,E.id,day+'T10:00:00Z',day+'T11:00:00Z','{"status":"ACTIVE"}','a'.repeat(64)]);
  for(const [name,seconds,category]of [['code.exe',1800,'Productive'],['chrome.exe',900,'Neutral'],['unknown.exe',900,null]]){
    await db.query('insert into wp_application_usage(device_id,record_id,application_name,duration_seconds) values($1,$2,$3,$4)',[device.deviceId,record,name,seconds]);
    if(category)await db.query('insert into wp_app_category_rules(id,application_name,category,created_by) values($1,$2,$3,$4)',[randomUUID(),name,category,A.id]);
  }
  const app=express();app.use('/api/v1',createAnalyticsRouter({auth,service:createAnalyticsService({client,timezone:'UTC'})}));app.use(notFound);app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.close();
  await writeFile(new URL('../reports/phase6-http-examples.json',import.meta.url),JSON.stringify({source:'Observed local integration responses with synthetic identities; authorization secrets omitted',examples},null,2)+'\n');});
test('all 19 endpoints authenticate, enforce every denied role and return real integration results',async()=>{
  for(const [template,,roles,own,exportCsv]of analyticsEndpoints){const path=template.replace(':id',E.id);
    assert.equal((await get(path,null)).status,401);
    for(const [role,actor]of [['A',A],['M',M],['E',E],['Agent',D]])if(!roles.includes(role))assert.equal((await get(path,actor)).status,403,template+' '+role);
    const response=await get(dated(path),own?E:A);assert.equal(response.status,200,template+': '+await response.clone().text());
    examples.push({method:'GET',path:dated(path),status:response.status,response:exportCsv?await response.clone().text():await response.clone().json()});
    if(exportCsv)assert.ok((await response.text()).includes('code.exe'));else assert.equal((await response.json()).success,true);
  }
});
test('date/department filters, accurate summary values and empty results',async()=>{
  const data=(await(await get(dated('/activity/employee/'+E.id+'/summary'))).json()).data;
  assert.equal(data.total_monitored_seconds,3600);assert.equal(data.active_seconds,2700);assert.equal(data.idle_seconds,900);assert.equal(data.productivity_score,null);
  const emptyDay=new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
  const empty=(await(await get('/activity/employee/'+E.id+'/summary?from='+emptyDay+'&to='+emptyDay)).json()).data;assert.equal(empty.total_monitored_seconds,0);
  const apps=(await(await get(dated('/app-usage?departmentId='+dept))).json()).data;assert.equal(apps.length,3);
  assert.equal((await get(dated('/app-usage?departmentId='+randomUUID()))).status,404);
});
test('Manager scope and own endpoints prevent cross-employee access',async()=>{
  assert.equal((await get(dated('/activity/employee/'+E.id),M)).status,200);
  assert.equal((await get(dated('/activity/employee/'+O.id),M)).status,404);
  const own=(await(await get(dated('/activity/me'),O)).json()).data;assert.equal(own.length,0);
  assert.equal((await get(dated('/activity/me/summary'),D)).status,200);
});
test('category percentages use all recorded application time including unclassified',async()=>{
  const data=(await(await get(dated('/app-usage/categories-breakdown'))).json()).data;
  assert.equal(data.total_application_seconds,3600);
  assert.equal(data.items.find(x=>x.category==='Productive').percentage,50);
  assert.equal(data.items.find(x=>x.category==='Neutral').percentage,25);
  assert.equal(data.items.find(x=>x.category==='Unclassified').percentage,25);
  const other=(await(await get(dated('/app-usage/employee/'+O.id))).json()).data;assert.equal(other.length,0);
});
test('pagination, seven-day zero-fill and DST-aware hourly timelines',async()=>{
  const paged=await(await get(dated('/app-usage?pageSize=1&page=2'))).json();assert.equal(paged.data.length,1);assert.equal(paged.pagination.total,3);
  const trend=(await(await get('/activity/employee/'+E.id+'/trend?to='+day+'&timezone=UTC')).json()).data;assert.equal(trend.length,7);assert.equal(trend.at(-1).active_seconds,2700);
  const spring=(await(await get('/activity/employee/'+E.id+'/timeline?from=2026-03-08&to=2026-03-08&timezone=America%2FNew_York')).json()).data;assert.equal(spring.length,23);
});
test('dashboard counts derive from employee/device rows and preserve paused/unknown buckets',async()=>{
  const counts=(await(await get(dated('/dashboard/stats'))).json()).data;assert.equal(counts.total_employees,4);assert.equal(counts.active,1);assert.equal(counts.offline,3);
  const scoped=(await(await get(dated('/dashboard/stats'),M)).json()).data;assert.equal(scoped.total_employees,2);
  const departments=(await(await get(dated('/dashboard/department-productivity'))).json()).data;assert.equal(departments[0].active_seconds,2700);assert.equal(departments[0].productivity_score,null);
});
test('invalid dates, fields, excessive ranges and UUIDs fail safely',async()=>{
  for(const path of ['/app-usage?from=bad','/app-usage?unexpected=1','/app-usage?pageSize=1000','/activity/employee/bad/summary',
    '/app-usage?from=2026-11-20&to=2026-11-01'])assert.equal((await get(path)).status,400);
});
test('hourly totals and DST fall-back preserve actual duration rather than fixed chart values',async()=>{
  const timeline=(await(await get(dated('/activity/employee/'+E.id+'/timeline'))).json()).data;
  assert.equal(timeline.reduce((sum,x)=>sum+x.active_seconds,0),2700);
  assert.equal(timeline.find(x=>x.label==='10:00').idle_seconds,900);
  const autumn=(await(await get('/activity/employee/'+E.id+'/timeline?from=2026-11-01&to=2026-11-01&timezone=America%2FNew_York')).json()).data;
  assert.equal(autumn.length,25);
});
test('database failures return safe availability errors without diagnostics',async()=>{
  const service=createAnalyticsService({client:{rpc:async()=>({error:{code:'PGRST205',message:'private details'}})},timezone:'UTC'});
  await assert.rejects(service.query(A.context,'summary',E.id,{from:day,to:day}),{status:503,message:'Analytics storage unavailable'});
});
