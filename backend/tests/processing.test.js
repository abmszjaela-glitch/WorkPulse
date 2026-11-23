import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {postgresClient} from './postgres-client.js';
import {createAuthRepository} from '../services/auth-repository.js';
import {createAuthService} from '../services/auth-service.js';
import {hashPassword} from '../services/passwords.js';
import {createDeviceService} from '../services/devices.js';
import {createCoreRepository} from '../services/core-repository.js';
import {createProcessingRepository} from '../services/processing-repository.js';
import {createCategoryService} from '../services/categories.js';
import {createDailySummaryService} from '../services/daily-summaries.js';
import {createSummaryWorker} from '../services/summary-worker.js';
import {createCategoryRouter} from '../routes/categories.js';
import {loadProcessingConfig} from '../config/processing.js';
import {loadAgentPolicy} from '../config/agent-policy.js';
import {errorHandler} from '../middleware/error-handler.js';

const db=new PGlite(),client=postgresClient(db),repo=createProcessingRepository(client);
const authConfig={secret:randomBytes(48).toString('base64url'),issuer:'workpulse-api',userAudience:'workpulse-dashboard',agentAudience:'workpulse-agent',
  accessSeconds:900,refreshSeconds:3600,resetSeconds:1800,temporarySeconds:86400,bcryptRounds:10};
const auth=createAuthService({repository:createAuthRepository(client),config:authConfig,mailer:{}});
const config={...loadProcessingConfig(),timezone:'UTC',startDate:null,lookbackDays:2,catchupDays:7,delayMinutes:0,maxJobsPerRun:1000};
const summaries=createDailySummaryService({repository:repo,config});
let hash,A,M,E,O,D,department,otherDepartment,server,base;
const day=new Date(Date.now()-86400000).toISOString().slice(0,10);
const start=`${day}T10:00:00Z`;
async function seed(role='E'){
  const id=randomUUID(),email=`${id}@example.test`;
  await db.query("insert into wp_auth_users(id,email,password_hash,role,created_at) values($1,$2,$3,$4,now()-interval '7 days')",[id,email,hash,role]);
  const session=await auth.login(email,'Synthetic-Password-123!');return {id,email,token:session.accessToken,context:await auth.authenticate(session.accessToken)};
}
async function call(method,path,actor=A,body,expected){
  const response=await fetch(base+'/api/v1/app-categories'+path,{method,headers:{...(actor?{Authorization:`Bearer ${actor.token}`} : {}),
    ...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  if(expected!==undefined)assert.equal(response.status,expected,`${method} ${path}: ${await response.clone().text()}`);return response;
}
async function rule(applicationName,category='Productive',departmentId=null){return(await call('POST','',A,{applicationName,category,departmentId},201)).json();}
async function interval(user,device,from,to,active,idle,apps={}){
  const id=randomUUID(),elapsed=active+idle;
  await db.query('insert into wp_activity_intervals(device_id,record_id,employee_id,interval_start,interval_end,interval_seconds,mouse_movements,mouse_clicks,key_presses,active_seconds,idle_seconds,summary,content_hash) values($1,$2,$3,$4,$5,$6,0,0,0,$7,$8,$9,$10)',
    [device,id,user,from,to,elapsed,active,idle,'{}','a'.repeat(64)]);
  for(const [name,duration]of Object.entries(apps))await db.query('insert into wp_application_usage(device_id,record_id,application_name,duration_seconds) values($1,$2,$3,$4)',[device,id,name,duration]);
  return id;
}
async function deviceFor(user){return auth.provisionDevice(A.context,user.id);}
before(async()=>{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const file of ['001_auth.proposed.sql','002_core_management.proposed.sql','003_monitoring.proposed.sql','004_processing.proposed.sql'])await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await db.exec('set role service_role');hash=await hashPassword('Synthetic-Password-123!',10);
  A=await seed('A');M=await seed('M');E=await seed();O=await seed();
  const core=createCoreRepository(client);
  department=await core.departmentWrite(A.context,'create',randomUUID(),{name:'Test scope',managerId:M.id});
  otherDepartment=await core.departmentWrite(A.context,'create',randomUUID(),{name:'Other scope',managerId:A.id});
  await db.query('update wp_employee_profiles set department_id=$1 where user_id=$2',[department.id,E.id]);
  const provisioned=await deviceFor(E),initial=await auth.loginDevice(provisioned.deviceId,provisioned.credential);
  const devices=createDeviceService({repository:core,config:authConfig,policy:loadAgentPolicy()});
  const registered=await devices.register(await auth.authenticate(initial.accessToken),{name:'Synthetic PC',platform:'Windows',deviceCredential:provisioned.credential});
  D={deviceId:provisioned.deviceId,token:registered.accessToken};
  const app=express();app.use(express.json());app.use('/api/v1',createCategoryRouter({auth,service:createCategoryService({repository:repo})}));app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db.close();});

test('all category endpoints authenticate and enforce Admin/Manager/Agent permissions',async()=>{
  for(const [method,path,roles]of [['GET','',['A','M']],['POST','',['A']],['PUT','/'+randomUUID(),['A']],['DELETE','/'+randomUUID(),['A']],['GET','/lookup',['Agent']]]){
    await call(method,path,null,undefined,401);
    for(const [role,actor]of [['A',A],['M',M],['E',E],['Agent',D]])if(!roles.includes(role))await call(method,path,actor,undefined,403);
  }
});
test('category create/list/update/delete normalize names and prevent duplicate live rules',async()=>{
  const created=await rule('Code.EXE');assert.equal(created.application_name,'code.exe');
  await call('POST','',A,{applicationName:'CODE.EXE',category:'Neutral'},409);
  const updated=await(await call('PUT','/'+created.id,A,{category:'Neutral'},200)).json();assert.equal(updated.category,'Neutral');
  const listed=await(await call('GET','?search=code&pageSize=1',M,undefined,200)).json();assert.equal(listed.items.length,1);
  await call('DELETE','/'+created.id,A,undefined,204);assert.ok((await db.query('select deleted_at from wp_app_category_rules where id=$1',[created.id])).rows[0].deleted_at);
  await rule('code.exe');await call('PUT','/'+randomUUID(),A,{category:'Neutral'},404);
});
test('department-specific overrides apply only to the registered employee and Manager scope',async()=>{
  await rule('chrome.exe','Neutral');await rule('chrome.exe','Productive',department.id);
  await rule('restricted.exe','Unproductive',otherDepartment.id);
  const lookup=await(await call('GET','/lookup',D,undefined,200)).json();
  assert.equal(lookup.items.find(x=>x.application_name==='chrome.exe').category,'Productive');
  assert.ok(!lookup.items.some(x=>x.application_name==='restricted.exe'));
  const manager=await(await call('GET','',M,undefined,200)).json();assert.ok(!manager.items.some(x=>x.department_id===otherDepartment.id));
});
test('invalid category data, missing values and unknown fields are rejected',async()=>{
  for(const body of [{},{applicationName:'https://url',category:'Productive'},{applicationName:'a.exe',category:'Unknown'},
    {applicationName:'a.exe',category:'Neutral',role:'A'}])await call('POST','',A,body,400);
  await call('PUT','/invalid',A,{category:'Neutral'},400);
  await call('POST','',A,{applicationName:'a.exe',category:'Neutral',departmentId:randomUUID()},400);
});
test('daily summaries calculate classified durations without inventing a productivity score',async()=>{
  await rule('game.exe','Unproductive');await rule('chat.exe','Neutral');
  await interval(E.id,D.deviceId,start,`${day}T10:01:00Z`,50,10,{'code.exe':20,'chrome.exe':10,'game.exe':5,'chat.exe':5,'unknown.exe':10});
  const result=await summaries.recalculate(E.id,day);
  assert.equal(result.total_monitored_seconds,60);assert.equal(result.active_seconds,50);assert.equal(result.idle_seconds,10);
  assert.equal(result.productive_seconds,30);assert.equal(result.neutral_seconds,5);assert.equal(result.unproductive_seconds,5);assert.equal(result.unclassified_seconds,10);
  assert.equal(result.productivity_score,null);assert.equal(result.productivity_score_status,'unavailable_pending_business_rule');
  const stored=(await db.query('select productive_seconds,productivity_score from wp_daily_summaries where employee_id=$1 and summary_date=$2',[E.id,day])).rows[0];
  assert.equal(stored.productive_seconds,30);assert.equal(stored.productivity_score,null);
});
test('empty activity days return actual zeros and unavailable scores, not zero productivity',async()=>{
  const result=await summaries.recalculate(O.id,day);assert.equal(result.total_monitored_seconds,0);assert.equal(result.has_activity_data,false);
  assert.equal(result.productivity_score,null);assert.deepEqual(result.applications,[]);assert.equal(result.paused_seconds,null);
});
test('closed local days use DST-aware boundaries including 23-hour and 25-hour days',async()=>{
  const spring=await summaries.recalculate(O.id,'2026-03-08','America/New_York');
  const autumn=await summaries.recalculate(O.id,'2026-11-01','America/New_York');
  assert.equal(spring.calendar_day_seconds,23*3600);assert.equal(autumn.calendar_day_seconds,25*3600);
});
test('cross-midnight intervals are explicitly prorated and preserve the total across days',async()=>{
  const user=await seed(),device=await deviceFor(user),next=new Date(Date.parse(day)+86400000).toISOString().slice(0,10);
  // Use an earlier day so both days are closed even when running near midnight.
  const previous=new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
  await interval(user.id,device.deviceId,`${previous}T23:59:30Z`,`${day}T00:00:30Z`,40,20,{'code.exe':40});
  const a=await summaries.recalculate(user.id,previous),b=await summaries.recalculate(user.id,day);
  assert.equal(a.total_monitored_seconds,30);assert.equal(b.total_monitored_seconds,30);
  assert.equal(a.productive_seconds+b.productive_seconds,40);assert.equal(a.contains_prorated_intervals,true);
});
test('multiple employee summaries do not leak or combine time between employees',async()=>{
  const user=await seed(),device=await deviceFor(user);await interval(user.id,device.deviceId,start,`${day}T10:02:00Z`,100,20,{'code.exe':100});
  const result=await summaries.recalculate(user.id,day);assert.equal(result.total_monitored_seconds,120);
  assert.equal((await summaries.recalculate(E.id,day)).total_monitored_seconds,60);
});
test('bounded reported pause transitions are separate from unavailable exact paused duration',async()=>{
  await db.query('insert into wp_status_events(device_id,record_id,employee_id,status,occurred_at) values($1,$2,$3,$4,$5),($1,$6,$3,$7,$8)',
    [D.deviceId,randomUUID(),E.id,'PAUSED',`${day}T11:00:00Z`,randomUUID(),'ACTIVE',`${day}T11:10:00Z`]);
  const result=await summaries.recalculate(E.id,day);assert.equal(result.reported_paused_seconds,600);assert.equal(result.paused_seconds,null);
  assert.equal(result.latest_reported_status_at_day_end.status,'ACTIVE');
});
test('manual recalculation is idempotent and does not rewrite an unchanged summary',async()=>{
  await summaries.recalculate(E.id,day);const before=(await db.query('select computed_at::text from wp_daily_summaries where employee_id=$1 and summary_date=$2 and timezone=$3',[E.id,day,'UTC'])).rows[0].computed_at;
  await summaries.recalculate(E.id,day);const after=(await db.query('select computed_at::text from wp_daily_summaries where employee_id=$1 and summary_date=$2 and timezone=$3',[E.id,day,'UTC'])).rows[0].computed_at;
  assert.equal(after,before);
});
test('scheduled processing persists its cursor and repeated runs skip completed jobs',async()=>{
  const first=await summaries.runScheduled();assert.ok(first.completed>0);assert.equal(first.failed,0);
  const second=await summaries.runScheduled();assert.equal(second.completed,0);assert.equal(second.failed,0);
  const restarted=createDailySummaryService({repository:repo,config});assert.equal((await restarted.runScheduled()).completed,0);
});
test('late uploads invalidate completed jobs and are included on the next scheduled run',async()=>{
  await interval(E.id,D.deviceId,`${day}T12:00:00Z`,`${day}T12:01:00Z`,60,0,{'code.exe':60});
  assert.equal((await db.query('select state from wp_summary_jobs where employee_id=$1 and summary_date=$2 and timezone=$3',[E.id,day,'UTC'])).rows[0].state,'pending');
  await summaries.runScheduled();const data=(await db.query('select data from wp_daily_summaries where employee_id=$1 and summary_date=$2 and timezone=$3',[E.id,day,'UTC'])).rows[0].data;
  assert.equal(data.total_monitored_seconds,120);assert.equal(data.productivity_score,null);
});
test('category changes invalidate history and reclassify totals without changing source data',async()=>{
  const current=(await db.query("select id from wp_app_category_rules where application_name='code.exe' and deleted_at is null and department_id is null")).rows[0];
  await call('PUT','/'+current.id,A,{category:'Neutral'},200);await summaries.runScheduled();
  const result=await summaries.recalculate(E.id,day);assert.equal(result.neutral_seconds,85);assert.equal(result.productive_seconds,10);
  assert.equal(result.productivity_score,null);
});
test('summary failures remain durable and retry after a corrected error',async()=>{
  await db.exec("reset role;create function public.test_summary_failure() returns trigger language plpgsql as $$begin raise exception 'private-failure';end$$;create trigger test_summary_failure before insert or update on wp_daily_summaries for each row execute function public.test_summary_failure();set role service_role;");
  try{
    await assert.rejects(summaries.recalculate(O.id,day),{status:503});
    const job=(await db.query('select state,next_retry_at,last_error_code from wp_summary_jobs where employee_id=$1 and summary_date=$2 and timezone=$3',[O.id,day,'UTC'])).rows[0];
    assert.equal(job.state,'failed');assert.ok(job.next_retry_at);assert.equal(job.last_error_code,'P0001');
  }finally{await db.exec('reset role;drop trigger test_summary_failure on wp_daily_summaries;drop function test_summary_failure();set role service_role;');}
  assert.equal((await summaries.recalculate(O.id,day)).productivity_score,null);
});
test('invalid dates and future days fail without creating a fabricated summary',async()=>{
  await assert.rejects(summaries.recalculate(E.id,'2026-02-31'),{status:400});await assert.rejects(summaries.recalculate(E.id,'2099-01-01'),{status:400});
  await assert.rejects(summaries.recalculate(randomUUID(),day),{status:404});
});
test('processing RLS blocks direct browser access and score constraints enforce unavailability',async()=>{
  await db.exec('reset role;set role anon');
  try{for(const table of ['wp_app_category_rules','wp_daily_summaries','wp_summary_jobs'])await assert.rejects(db.query(`select * from ${table}`));}
  finally{await db.exec('reset role;set role service_role');}
  await assert.rejects(db.query('update wp_daily_summaries set productivity_score=0 where employee_id=$1',[E.id]));
});
test('worker coalesces concurrent runs, stops cleanly and does not expose raw errors',async()=>{
  let calls=0,release;const logs=[];const logger={info:x=>logs.push(x),error:x=>logs.push(x)};
  const worker=createSummaryWorker({config:{...config,enabled:true},logger,service:{runScheduled:()=>{calls++;return new Promise(resolve=>{release=resolve;});}}});
  const one=worker.runOnce(),two=worker.runOnce();assert.equal(one,two);await Promise.resolve();assert.equal(calls,1);
  let stopped=false;const stop=worker.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);
  release({completed:1,failed:0});await one;await stop;assert.equal(stopped,true);
  const failing=createSummaryWorker({config,logger,service:{runScheduled(){throw new Error('private-failure');}}});
  await failing.runOnce();await failing.runOnce();assert.ok(!logs.join(' ').includes('private-failure'));
});
