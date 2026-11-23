// Isolated PostgreSQL + production HTTP routers. No live Supabase or real users.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {postgresClient} from './postgres-client.js';
import {createAuthRepository} from '../services/auth-repository.js';
import {createAuthService} from '../services/auth-service.js';
import {createAuthRouter} from '../routes/auth.js';
import {hashPassword} from '../services/passwords.js';
import {createCoreRepository} from '../services/core-repository.js';
import {createDeviceService} from '../services/devices.js';
import {createConsentService} from '../services/consent.js';
import {createCoreRouter} from '../routes/core.js';
import {createAgentSettings} from '../services/agent-settings.js';
import {loadAgentPolicy} from '../config/agent-policy.js';
import {createSystemRepository} from '../services/system-repository.js';
import {createSystemRouter} from '../routes/system.js';
import {loadSystemConfig} from '../config/system.js';
import {createMonitoringRepository} from '../services/monitoring-repository.js';
import {createMonitoringService} from '../services/monitoring.js';
import {createMonitoringRouter} from '../routes/monitoring.js';
import {loadMonitoringConfig} from '../config/monitoring.js';
import {createAnalyticsService} from '../services/analytics.js';
import {createAnalyticsRouter} from '../routes/analytics.js';
import {createReportService} from '../services/reports.js';
import {createReportRouter} from '../routes/reports.js';
import {errorHandler} from '../middleware/error-handler.js';

const db=new PGlite(), client=postgresClient(db);
const config={secret:randomBytes(48).toString('hex'),issuer:'integration',userAudience:'web',agentAudience:'agent',
  accessSeconds:900,refreshSeconds:86400,resetSeconds:1800,temporarySeconds:86400,bcryptRounds:10};
const auth=createAuthService({repository:createAuthRepository(client),config,mailer:{}});
let server,base,admin,employee,other,device,token,record;
async function request(method,path,credential,body){
  return fetch(base+'/api/v1'+path,{method,headers:{...(credential?{Authorization:'Bearer '+credential}:{}),
    ...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function json(method,path,credential,body,status=200){const res=await request(method,path,credential,body);assert.equal(res.status,status,method+' '+path+': '+await res.clone().text());return res.json();}
before(async()=>{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const name of ['001_auth','002_core_management','003_monitoring','004_processing','005_analytics','006_reports','007_system'])
    await db.exec(await readFile(new URL('../migrations/'+name+'.proposed.sql',import.meta.url),'utf8'));
  await db.exec('set role service_role');
  const password='Synthetic-Integration-123!',hash=await hashPassword(password,10);
  async function seed(role){const id=randomUUID();await db.query('insert into wp_auth_users(id,email,password_hash,role) values($1,$2,$3,$4)',[id,id+'@example.test',hash,role]);return {id,token:(await auth.login(id+'@example.test',password)).accessToken};}
  admin=await seed('A');employee=await seed('E');other=await seed('E');
  const repository=createCoreRepository(client), monitoringConfig=loadMonitoringConfig();
  const app=express();app.use(express.json());
  app.use('/api/v1/auth',createAuthRouter(auth));
  app.use('/api/v1',createSystemRouter({auth,repository:createSystemRepository(client),config:loadSystemConfig({})}));
  app.use('/api/v1',createCoreRouter({auth,devices:createDeviceService({repository,config,policyProvider:createAgentSettings(loadAgentPolicy())}),consent:createConsentService({repository})}));
  app.use('/api/v1',createAnalyticsRouter({auth,service:createAnalyticsService({client,timezone:'UTC'})}));
  app.use('/api/v1',createReportRouter({auth,service:createReportService({client,timezone:'UTC'})}));
  app.use('/api/v1',createMonitoringRouter({auth,config:monitoringConfig,service:createMonitoringService({repository:createMonitoringRepository(client),config:monitoringConfig})}));
  app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.close();});

test('Admin enrollment, credential rotation and authoritative monitoring policy use actual contracts',async()=>{
  assert.equal((await request('POST','/devices/provision',employee.token,{employeeId:employee.id})).status,403);
  device=await json('POST','/devices/provision',admin.token,{employeeId:employee.id},201);
  token=(await json('POST','/devices/token',null,{deviceId:device.deviceId,deviceCredential:device.credential})).accessToken;
  const me=await json('GET','/auth/me',token);assert.equal(me.role,'Agent');assert.equal(me.user.id,employee.id);
  const registered=await json('POST','/devices/register',token,{name:'Synthetic Agent',platform:'Windows',deviceCredential:device.credential},201);
  assert.notEqual(registered.deviceCredential,device.credential);token=registered.accessToken;
  assert.equal((await request('POST','/devices/token',null,{deviceId:device.deviceId,deviceCredential:device.credential})).status,401);
  const schedule=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=>({day,enabled:true,start:'00:00',end:'23:59'}));
  await json('PUT','/settings/working-hours',admin.token,{timezone:'UTC',schedule});
  await json('PUT','/settings/monitoring',admin.token,{idleMinutes:8,evaluationSeconds:30,syncMinutes:1,trackApplications:true});
  const policy=await json('GET','/devices/agent-config',token);assert.equal(policy.idleThreshold,480);assert.equal(policy.trackingInterval,30);
  assert.equal(policy.syncInterval,60);assert.equal(policy.workingHours.timezone,'UTC');assert.equal(policy.trackApplications,true);assert.equal(policy.consentAccepted,false);
});

test('current consent and device-bound employee ownership gate aggregate uploads',async()=>{
  const policy=await json('PUT','/consent/policy',admin.token,{content:'Synthetic integration privacy notice: anonymous aggregate counts and process names only.'},201);
  const now=Date.now();record={record_id:randomUUID(),employee_id:employee.id,interval_start:new Date(now-60000).toISOString(),interval_end:new Date(now).toISOString(),
    summary:{interval_seconds:60,counts:{mouse_movements:120,mouse_clicks:6,key_presses:45},active_seconds:45,idle_seconds:15,
      application_usage_seconds:{'code.exe':30,'chrome.exe':15},status:'ACTIVE',activity_score:30,score_type:'input_activity_intensity',score_is_productivity_or_performance:false},sync_status:'pending'};
  assert.equal((await request('POST','/activity',employee.token,record)).status,403);
  const denied=await json('POST','/activity/batch',token,[record],207);assert.deepEqual(denied.acknowledged_record_ids,[]);
  await json('POST','/consent/accept',token,{policyVersion:policy.version});
  // Fixture authorization predates the synthetic historical interval. Never executed on live DB.
  await db.query("update wp_consent_receipts set accepted_at=now()-interval '1 hour' where user_id=$1",[employee.id]);
  const wrong={...record,record_id:randomUUID(),employee_id:other.id};
  const uploaded=await json('POST','/activity/batch',token,[record,wrong],207);
  assert.deepEqual(uploaded.acknowledged_record_ids,[record.record_id]);assert.equal(uploaded.results[1].status,'rejected');
  const replay=await json('POST','/activity/batch',token,[record]);assert.equal(replay.results[0].status,'duplicate');
  assert.equal((await db.query('select count(*) from wp_activity_intervals')).rows[0].count,1);
  assert.equal((await db.query('select count(*) from wp_application_usage')).rows[0].count,2);
});

test('stored Agent data appears in dashboard, employee activity, application and report APIs',async()=>{
  await json('POST','/devices/heartbeat',token);
  await json('POST','/status',token,{status:'ACTIVE'});
  const date=record.interval_end.slice(0,10),q=`?from=${date}&to=${date}&timezone=UTC`;
  const stats=(await json('GET','/dashboard/stats'+q,admin.token)).data;assert.equal(stats.active,1);
  const live=(await json('GET','/dashboard/live-status'+q,admin.token)).data;assert.equal(live.find(row=>row.id===employee.id).status,'ACTIVE');
  const summary=(await json('GET',`/activity/employee/${employee.id}/summary${q}`,admin.token)).data;
  assert.equal(summary.active_seconds,45);assert.equal(summary.idle_seconds,15);assert.equal(summary.productivity_score,null);
  const log=(await json('GET',`/activity/employee/${employee.id}/log${q}`,admin.token)).data;assert.equal(log[0].mouse_clicks,6);assert.equal(log[0].key_presses,45);
  const apps=(await json('GET','/app-usage'+q,admin.token)).data;assert.equal(apps.find(app=>app.application_name==='code.exe').seconds,30);
  const reports=(await json('GET','/reports/daily'+q,admin.token)).data;assert.equal(reports.find(row=>row.employee_id===employee.id).total_monitored_seconds,60);
  const csv=await request('GET','/reports/export/csv'+q+'&reportType=activity',admin.token);assert.equal(csv.status,200);assert.ok((await csv.text()).includes('Record ID'));
  await json('POST','/status',token,{status:'PAUSED'});
  const paused=(await json('GET','/dashboard/stats'+q,admin.token)).data;assert.equal(paused.paused,1);assert.equal(paused.idle,0);
  await json('PATCH','/devices/'+device.deviceId+'/status',admin.token,{active:false});
  assert.equal((await request('POST','/activity/batch',token,[record])).status,401);
});
