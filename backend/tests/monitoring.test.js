import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {postgresClient} from './postgres-client.js';
import {createAuthRepository} from '../services/auth-repository.js';
import {createAuthService} from '../services/auth-service.js';
import {hashPassword} from '../services/passwords.js';
import {createCoreRepository} from '../services/core-repository.js';
import {createDeviceService} from '../services/devices.js';
import {createEmployeeService} from '../services/employees.js';
import {createDepartmentService} from '../services/departments.js';
import {createProfileService} from '../services/profile.js';
import {createConsentService} from '../services/consent.js';
import {createMonitoringRepository} from '../services/monitoring-repository.js';
import {createMonitoringService} from '../services/monitoring.js';
import {validateMonitoringRecord,utcTimestamp} from '../services/monitoring-validation.js';
import {createMonitoringRouter} from '../routes/monitoring.js';
import {createCoreRouter} from '../routes/core.js';
import {loadMonitoringConfig} from '../config/monitoring.js';
import {loadAgentPolicy} from '../config/agent-policy.js';
import {errorHandler,notFound} from '../middleware/error-handler.js';

const db=new PGlite(),client=postgresClient(db),config={...loadMonitoringConfig(),requestsPerMinute:6000};
const authConfig={secret:randomBytes(48).toString('base64url'),issuer:'workpulse-api',userAudience:'workpulse-dashboard',agentAudience:'workpulse-agent',
  accessSeconds:900,refreshSeconds:3600,resetSeconds:1800,temporarySeconds:86400,bcryptRounds:10};
const mailer={async sendAccountCreated(){},async sendPasswordChanged(){}};
const auth=createAuthService({repository:createAuthRepository(client),config:authConfig,mailer});
const repository=createMonitoringRepository(client),service=createMonitoringService({repository,config});
const core=createCoreRepository(client),devices=createDeviceService({repository:core,config:authConfig,policy:loadAgentPolicy()});
let server,base,hash,fixture,A,E,D,index=0;
const examples=[];
async function capture(name,path,request,response,requestHeaders={}) {
  examples.push({name,method:'POST',path:'/api/v1'+path,requestHeaders,request:structuredClone(request),
    responseStatus:response.status,response:await response.clone().json()});
}
const anchor=Math.floor((Date.now()-86400000)/1000)*1000;
const stamp=ms=>new Date(ms).toISOString().replace(/\.\d{3}Z$/,'.123456+00:00');
async function seed(role='E') {
  const id=randomUUID(),email=`${id}@example.test`;
  await db.query('insert into wp_auth_users(id,email,password_hash,role) values($1,$2,$3,$4)',[id,email,hash,role]);
  const session=await auth.login(email,'Synthetic-Password-123!');return {id,email,token:session.accessToken,context:await auth.authenticate(session.accessToken)};
}
function record() {
  const result=structuredClone(fixture),start=anchor+(index++)*120000;
  result.record_id=randomUUID();result.employee_id=E.id;result.interval_start=stamp(start);result.interval_end=stamp(start+60000);
  return result;
}
async function call(path,body,expected,token=D.token,headers={}) {
  const response=await fetch(base+'/api/v1'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...headers},body:JSON.stringify(body)});
  if(expected!==undefined)assert.equal(response.status,expected,`${path}: ${await response.clone().text()}`);return response;
}
async function getDevice() {
  const response=await fetch(base+'/api/v1/devices/'+D.deviceId,{headers:{Authorization:`Bearer ${A.token}`}});
  assert.equal(response.status,200);return response.json();
}

before(async()=>{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const file of ['001_auth.proposed.sql','002_core_management.proposed.sql','003_monitoring.proposed.sql'])await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await db.exec('set role service_role');hash=await hashPassword('Synthetic-Password-123!',10);
  fixture=JSON.parse(await readFile(new URL('fixtures/agent-queue-record.json',import.meta.url),'utf8'));
  A=await seed('A');E=await seed();
  await db.query("insert into wp_privacy_policies(version,content,created_by,created_at) values(1,'Synthetic test policy',$1,now()-interval '3 days')",[A.id]);
  await db.query("insert into wp_consent_receipts(user_id,policy_version,accepted_at) values($1,1,now()-interval '3 days')",[E.id]);
  const provisioned=await auth.provisionDevice(A.context,E.id),bootstrap=await auth.loginDevice(provisioned.deviceId,provisioned.credential);
  const registered=await devices.register(await auth.authenticate(bootstrap.accessToken),{name:'Synthetic PC',platform:'Windows',deviceCredential:provisioned.credential});
  D={deviceId:provisioned.deviceId,token:registered.accessToken,credential:registered.deviceCredential};
  const app=express();app.use(express.json({limit:'1mb'}));
  app.use('/api/v1',createCoreRouter({auth,repository:core,devices,employees:createEmployeeService({repository:core,config:authConfig,mailer}),
    departments:createDepartmentService({repository:core}),profile:createProfileService({repository:core}),consent:createConsentService({repository:core})}));
  app.use('/api/v1',createMonitoringRouter({auth,service,config}));app.use(notFound);app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db.close();
  await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
  await writeFile(new URL('../reports/phase4-http-examples.json',import.meta.url),JSON.stringify({
    source:'Actual local integration HTTP responses using synthetic identities and the existing agent serializer fixture. Authorization credentials deliberately omitted.',examples},null,2)+'\n');
});

test('actual agent serializer fixture is accepted and microsecond timestamps are preserved',async()=>{
  const input=record();const response=await call('/activity',input,201);const ack=await response.json();assert.deepEqual(ack.acknowledged_record_ids,[input.record_id]);
  examples.push({name:'Single activity',method:'POST',path:'/api/v1/activity',request:input,responseStatus:response.status,response:ack});
  const stored=(await db.query('select interval_start::text,summary,mouse_movements,employee_id from wp_activity_intervals where device_id=$1 and record_id=$2',[D.deviceId,input.record_id])).rows[0];
  assert.ok(stored.interval_start.includes('.123456'));assert.equal(Number(stored.mouse_movements),120);assert.equal(stored.employee_id,E.id);
  assert.equal(stored.summary.score_is_productivity_or_performance,false);assert.ok(!('sync_status'in stored.summary));
});
test('timezone offset normalization retains microseconds and rejects invalid dates',()=>{
  assert.equal(utcTimestamp('2026-11-20T14:30:00.123456+05:30').value,'2026-11-20T09:00:00.123456Z');
  for(const value of ['2026-11-20T09:00:00','2026-02-31T09:00:00Z','2026-11-20T25:00:00Z'])assert.throws(()=>utcTimestamp(value),{status:400});
});
test('Unicode process-name lengths match the existing Python agent contract',async()=>{
  const input=record(),name='a'.repeat(250)+'😀.exe';assert.equal([...name].length,255);
  input.summary.application_usage_seconds={[name]:45};await call('/app-usage',input,201);
  const row=(await db.query('select application_name from wp_application_usage where device_id=$1 and record_id=$2',[D.deviceId,input.record_id])).rows[0];assert.equal(row.application_name,name);
});
test('duplicate activity and app-usage retries acknowledge once without double counting',async()=>{
  const input=record();await call('/activity',input,201);
  for(const path of ['/activity','/app-usage']){const response=await call(path,input,200);assert.equal((await response.json()).results[0].status,'duplicate');}
  const usage=(await db.query('select duration_seconds from wp_application_usage where device_id=$1 and record_id=$2',[D.deviceId,input.record_id])).rows;
  assert.equal(usage.length,1);assert.equal(usage[0].duration_seconds,45);
  const conflicting=structuredClone(input);conflicting.summary.counts.mouse_clicks++;
  await call('/activity',conflicting,409);
  await call('/activity',{...input,record_id:randomUUID()},409);
});
test('single and batch app usage use the actual queue mapping and interval timestamps',async()=>{
  const input=record();input.summary.application_usage_seconds={'chrome.exe':30,'code.exe':15};
  const single=await call('/app-usage',input,201);await capture('Single application usage','/app-usage',input,single);
  const batch=[record(),record()];const response=await call('/app-usage/batch',batch,200);await capture('Application usage batch','/app-usage/batch',batch,response);
  assert.equal((await response.json()).acknowledged_record_ids.length,2);
  const row=(await db.query('select sum(duration_seconds) as seconds from wp_application_usage where device_id=$1 and record_id=$2',[D.deviceId,input.record_id])).rows[0];assert.equal(row.seconds,45);
});
test('activity batch reports every accepted, invalid, duplicate and conflicting item',async()=>{
  const good=record(),conflict=structuredClone(good),future=record();conflict.summary.counts.key_presses++;
  future.interval_start=stamp(Date.now()+3600000);future.interval_end=stamp(Date.now()+3660000);
  const submitted=[good,{record_id:randomUUID()},good,conflict,future];
  const response=await call('/activity/batch',submitted,207);await capture('Mixed activity batch','/activity/batch',submitted,response);
  const result=await response.json();assert.deepEqual(result.acknowledged_record_ids,[good.record_id]);assert.equal(result.results.length,5);
  assert.deepEqual(result.results.map(item=>item.http_status),[201,400,200,409,400]);assert.deepEqual(result.results.map(item=>item.index),[0,1,2,3,4]);
});
test('empty and oversized batches fail; configured maximum batch synchronizes successfully',async()=>{
  await call('/activity/batch',[],400);await call('/app-usage/batch',{records:[]},400);
  await call('/activity/batch',Array.from({length:config.maxBatchSize+1},()=>record()),413);
  const batch=Array.from({length:config.maxBatchSize},()=>record());const response=await call('/activity/batch',batch,200);
  assert.equal((await response.json()).acknowledged_record_ids.length,config.maxBatchSize);
});
test('unauthenticated, human JWTs and invalid device credentials are rejected on all monitoring paths',async()=>{
  for(const path of ['/activity','/activity/batch','/app-usage','/app-usage/batch','/status']) {
    await call(path,{},401,null);await call(path,{},403,E.token);await call(path,{},401,D.credential);await call(path,{},401,D.token+'tampered');
  }
});
test('pre-provisioned but unregistered devices cannot submit records or status',async()=>{
  const provisioned=await auth.provisionDevice(A.context,E.id),session=await auth.loginDevice(provisioned.deviceId,provisioned.credential);
  await call('/activity',record(),403,session.accessToken);await call('/status',{status:'PAUSED'},403,session.accessToken);
});
test('employee association is trusted; approved employee code aliases remain compatible',async()=>{
  const input=record();input.employee_id=A.id;await call('/activity',input,403);
  await db.query('update wp_employee_profiles set employee_code=$1 where user_id=$2',['WP-SYNTHETIC',E.id]);
  input.employee_id='WP-SYNTHETIC';await call('/activity',input,201);
});
test('invalid, incomplete and privacy-sensitive payloads never persist',async()=>{
  const cases=[x=>{delete x.summary.counts;},x=>{x.summary.counts.key_presses=-1;},x=>{x.summary.counts.key_presses=Number.MAX_SAFE_INTEGER+1;},
    x=>{x.summary.active_seconds=61;},x=>{x.summary.application_usage_seconds={'https://private.example':1};},
    x=>{x.summary.window_title='sensitive';},x=>{x.summary.application_usage_seconds={'code.exe':100};},
    x=>{x.summary.counts.keys=['sensitive'];},x=>{x.interval_start='not-a-date';},x=>{x.summary.status='PAUSED';}];
  const before=(await db.query('select count(*) from wp_activity_intervals')).rows[0].count;
  for(const change of cases){const input=record();change(input);await call('/activity',input,400);}
  assert.equal((await db.query('select count(*) from wp_activity_intervals')).rows[0].count,before);
});
test('old records, future records and overlapping intervals are rejected without overwrite',async()=>{
  const old=record();old.interval_start=stamp(Date.now()-31*86400000);old.interval_end=stamp(Date.now()-31*86400000+60000);await call('/activity',old,400);
  const original=record();await call('/activity',original,201);
  const overlap={...original,record_id:randomUUID(),interval_start:stamp(Date.parse(original.interval_start)+10000),interval_end:stamp(Date.parse(original.interval_end)+10000)};
  await call('/activity',overlap,409);
});
test('offline synchronization retries only server-confirmed IDs after a lost response',async()=>{
  const pending=[record(),record()];await call('/activity/batch',pending,200);
  const retried=await(await call('/activity/batch',pending,200)).json();assert.equal(retried.results.every(x=>x.status==='duplicate'),true);
  assert.deepEqual(retried.acknowledged_record_ids,pending.map(x=>x.record_id));
});
test('status events distinguish ACTIVE, IDLE, PAUSED and OFFLINE with retry protection',async()=>{
  const key=randomUUID();const initial=await call('/status',{status:'ACTIVE'},200,D.token,{'Idempotency-Key':key});
  await capture('Current status','/status',{status:'ACTIVE'},initial,{'Idempotency-Key':key});
  for(const status of ['IDLE','PAUSED','OFFLINE'])assert.equal((await(await call('/status',{status},200)).json()).status,status);
  const retry=await(await call('/status',{status:'ACTIVE'},200,D.token,{'Idempotency-Key':key})).json();assert.equal(retry.duplicate,true);assert.equal(retry.reportedStatus,'OFFLINE');
  await call('/status',{status:'IDLE'},409,D.token,{'Idempotency-Key':key});
  await call('/status',{status:'PAUSED',employee_id:A.id},400);await call('/status',{status:'unknown'},400);
});
test('heartbeat timeout derives OFFLINE and recovers PAUSED without inventing IDLE',async()=>{
  await call('/status',{status:'PAUSED'},200);
  await db.query("update wp_auth_devices set last_seen=now()-interval '301 seconds' where id=$1",[D.deviceId]);
  const offline=await getDevice();assert.equal(offline.connectionState,'OFFLINE');assert.equal(offline.effectiveStatus,'OFFLINE');assert.equal(offline.reportedStatus,'PAUSED');
  const response=await call('/devices/heartbeat',{},200);await capture('Heartbeat after timeout','/devices/heartbeat',{},response);
  const heartbeat=await response.json();assert.equal(heartbeat.connectionState,'ONLINE');assert.equal(heartbeat.effectiveStatus,'PAUSED');
  await call('/activity',record(),201);assert.equal((await getDevice()).reportedStatus,'PAUSED');
});
test('disabled, removed and missing device sessions cannot upload or heartbeat',async()=>{
  const provisioned=await auth.provisionDevice(A.context,E.id),bootstrap=await auth.loginDevice(provisioned.deviceId,provisioned.credential);
  const registered=await devices.register(await auth.authenticate(bootstrap.accessToken),{name:'Other PC',platform:'Windows',deviceCredential:provisioned.credential});
  await core.devices(A.context,'status',provisioned.deviceId,{active:false});
  await call('/activity',record(),401,registered.accessToken);await call('/devices/heartbeat',{},401,registered.accessToken);
  await core.devices(A.context,'status',provisioned.deviceId,{active:true});
  const fresh=await auth.loginDevice(provisioned.deviceId,registered.deviceCredential);
  await core.devices(A.context,'delete',provisioned.deviceId,{});await call('/app-usage',record(),401,fresh.accessToken);
  await assert.rejects(repository.authorize({...E.context,deviceId:randomUUID()}),{status:403});
});
test('new records need collection-time consent while pause/offline remain permitted without consent',async()=>{
  const user=await seed(),provisioned=await auth.provisionDevice(A.context,user.id),bootstrap=await auth.loginDevice(provisioned.deviceId,provisioned.credential);
  const registered=await devices.register(await auth.authenticate(bootstrap.accessToken),{name:'No consent PC',platform:'Windows',deviceCredential:provisioned.credential});
  const input=record();input.employee_id=user.id;
  await call('/activity',input,403,registered.accessToken);await call('/status',{status:'ACTIVE'},403,registered.accessToken);
  await call('/status',{status:'PAUSED'},200,registered.accessToken);await call('/status',{status:'OFFLINE'},200,registered.accessToken);
});
test('unexpected database failures roll back the whole persistence transaction and acknowledge nothing',async()=>{
  await db.exec("reset role;create function public.test_monitoring_failure() returns trigger language plpgsql as $$begin if new.application_name='fail.exe' then raise exception 'private-diagnostic';end if;return new;end$$;create trigger test_monitoring_failure before insert on wp_application_usage for each row execute function test_monitoring_failure();set role service_role;");
  const good=record(),bad=record();bad.summary.application_usage_seconds={'fail.exe':10};
  try{
    const response=await call('/activity/batch',[good,bad],503);const error=await response.json();assert.ok(!JSON.stringify(error).includes('private-diagnostic'));assert.ok(!error.acknowledged_record_ids);
    assert.equal((await db.query('select count(*) from wp_activity_intervals where record_id in ($1,$2)',[good.record_id,bad.record_id])).rows[0].count,0);
  }finally{await db.exec('reset role;drop trigger test_monitoring_failure on wp_application_usage;drop function test_monitoring_failure();set role service_role;');}
  await call('/activity/batch',[good,bad],200);
});
test('RLS and permissions block direct browser access to monitoring data and RPCs',async()=>{
  await db.exec('reset role;set role anon');
  try{for(const table of ['wp_activity_intervals','wp_application_usage','wp_status_events','wp_device_presence'])await assert.rejects(db.query(`select * from ${table}`));
    await assert.rejects(db.query('select wp_monitoring_device_state($1,300)',[D.deviceId]));
  }finally{await db.exec('reset role;set role service_role');}
});
test('calculation metadata and cumulative usage are accepted but never double-counted',async()=>{
  const input=record();input.summary.configured_interval_seconds=60;
  input.summary.score_weights={mouse_movements:0.2,mouse_clicks:0.3,key_presses:0.5};
  input.summary.reference_counts_per_minute={mouse_movements:120,mouse_clicks:30,key_presses:120};
  input.summary.cumulative_application_usage_seconds={'code.exe':10000};
  await call('/activity',input,201);
  const stored=(await db.query('select summary from wp_activity_intervals where device_id=$1 and record_id=$2',[D.deviceId,input.record_id])).rows[0].summary;
  assert.ok(!('cumulative_application_usage_seconds'in stored));assert.ok(!('score_weights'in stored));
  assert.equal(stored.application_usage_seconds['code.exe'],45);
});
test('monitoring rate limiter returns retryable 429 without acknowledging data',async()=>{
  const app=express();app.use(express.json());app.use('/api/v1',createMonitoringRouter({auth,service,config:{...config,requestsPerMinute:1}}));app.use(errorHandler);
  const temporary=app.listen(0,'127.0.0.1');await new Promise(resolve=>temporary.once('listening',resolve));
  try{const url=`http://127.0.0.1:${temporary.address().port}/api/v1/status`;
    const options={method:'POST',headers:{Authorization:`Bearer ${D.token}`,'Content-Type':'application/json'},body:JSON.stringify({status:'PAUSED'})};
    assert.equal((await fetch(url,options)).status,200);const denied=await fetch(url,options);assert.equal(denied.status,429);assert.ok(denied.headers.get('retry-after'));
  }finally{await new Promise(resolve=>temporary.close(resolve));}
});
test('already accepted records remain acknowledgeable after a stricter upload-age policy',async()=>{
  const input=record(),start=Date.now()-2*86400000;input.interval_start=stamp(start);input.interval_end=stamp(start+60000);
  await call('/activity',input,201);
  const stricter=createMonitoringService({repository,config:{...config,maxAgeDays:1}});
  const result=await stricter.single(await auth.authenticate(D.token),'activity',input);
  assert.equal(result.httpStatus,200);assert.equal(result.body.results[0].status,'duplicate');
});
test('concurrent duplicate uploads persist one record and return reliable acknowledgments',async()=>{
  const input=record();const responses=await Promise.all([call('/activity',input),call('/activity',input)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
  assert.equal((await db.query('select count(*) from wp_activity_intervals where device_id=$1 and record_id=$2',[D.deviceId,input.record_id])).rows[0].count,1);
});
test('offline records honor the policy at collection and new-policy data requires renewed consent',async()=>{
  await db.query('update wp_privacy_policies set is_current=false where is_current');
  await db.query("insert into wp_privacy_policies(version,content,created_by,created_at) values(2,'New synthetic policy',$1,now()-interval '12 hours')",[A.id]);
  await call('/activity',record(),201);
  const recent=record();recent.interval_start=stamp(Date.now()-1800000);recent.interval_end=stamp(Date.now()-1740000);
  await call('/activity',recent,403);
  await db.query("insert into wp_consent_receipts(user_id,policy_version,accepted_at) values($1,2,now()-interval '1 hour')",[E.id]);
  await call('/activity',recent,201);
  assert.equal((await db.query('select count(*) from wp_consent_receipts where user_id=$1',[E.id])).rows[0].count,2);
});
