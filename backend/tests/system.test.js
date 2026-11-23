import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import express from 'express';
import {io} from 'socket.io-client';
import {PGlite} from '@electric-sql/pglite';
import {postgresClient} from './postgres-client.js';
import {createAuthService} from '../services/auth-service.js';
import {createAuthRepository} from '../services/auth-repository.js';
import {hashPassword} from '../services/passwords.js';
import {createSystemRepository} from '../services/system-repository.js';
import {loadSystemConfig} from '../config/system.js';
import {createSystemRouter,systemEndpoints} from '../routes/system.js';
import {attachRealtime} from '../services/realtime.js';
import {errorHandler} from '../middleware/error-handler.js';
import {logFailure} from '../utils/server-logger.js';
import {createCoreRouter} from '../routes/core.js';
import {createCoreRepository} from '../services/core-repository.js';
import {createEmployeeService} from '../services/employees.js';
import {createDepartmentService} from '../services/departments.js';
import {createDeviceService} from '../services/devices.js';
import {createProfileService} from '../services/profile.js';
import {createConsentService} from '../services/consent.js';
const db=new PGlite(),client=postgresClient(db),repository=createSystemRepository(client);
const config=loadSystemConfig({CORS_ORIGIN:'https://dashboard.example.test'});
const auth=createAuthService({repository:createAuthRepository(client),mailer:{},config:{secret:randomBytes(48).toString('hex'),issuer:'test',userAudience:'users',agentAudience:'devices',accessSeconds:900,refreshSeconds:86400,bcryptRounds:10}});
let A,M,E,O,D,device,server,base,realtime,hash;const sockets=[];
async function seed(role){const id=randomUUID(),email=id+'@example.test';await db.query('insert into wp_auth_users(id,email,password_hash,role) values($1,$2,$3,$4)',[id,email,hash,role]);const session=await auth.login(email,'Synthetic-password-123!');return {id,token:session.accessToken,context:await auth.authenticate(session.accessToken)};}
async function request(path,actor=A,method='GET',body){return fetch(base+'/api/v1'+path,{method,headers:{...(actor?{Authorization:'Bearer '+actor.token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
function socket(credentials,options={}){const s=io(base,{auth:credentials,transports:['websocket'],reconnection:false,...options});sockets.push(s);return s;}
function connected(s){return new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});}
function event(s,name){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Event timeout: '+name)),2500);s.once(name,data=>{clearTimeout(timer);resolve(data);});});}
before(async()=>{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const n of ['001_auth','002_core_management','003_monitoring','004_processing','005_analytics','006_reports','007_system'])await db.exec(await readFile(new URL('../migrations/'+n+'.proposed.sql',import.meta.url),'utf8'));
 await db.exec('set role service_role');hash=await hashPassword('Synthetic-password-123!',10);A=await seed('A');M=await seed('M');E=await seed('E');O=await seed('E');
 await db.query('insert into wp_auth_manager_assignments(manager_id,employee_id) values($1,$2)',[M.id,E.id]);
 device=await auth.provisionDevice(A.context,E.id);await db.query('update wp_auth_devices set registered_at=now(),last_seen=now() where id=$1',[device.deviceId]);
 const login=await auth.loginDevice(device.deviceId,device.credential);D={token:login.accessToken,context:await auth.authenticate(login.accessToken)};
 const core=createCoreRepository(client),mailer={async sendAccountCreated(){},async sendPasswordChanged(){}};
 const services={auth,employees:createEmployeeService({repository:core,config:{bcryptRounds:10,temporarySeconds:3600},mailer}),departments:createDepartmentService({repository:core}),
   devices:createDeviceService({repository:core,config:{},policy:{}}),profile:createProfileService({repository:core}),consent:createConsentService({repository:core})};
 const app=express();app.use(express.json());app.get('/api/v1/health',(req,res)=>res.json({status:'ok'}));app.use('/api/v1',createSystemRouter({auth,repository,config}));app.use('/api/v1',createCoreRouter(services));app.use(errorHandler);
 server=createServer(app);realtime=attachRealtime(server,{auth,repository,config,log:{error(){},warn(){}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{for(const s of sockets)s.disconnect();await realtime.stop();await db.close();});
test('settings enforce Admin roles, validate fields and persist without allowing consent bypass',async()=>{
 assert.equal((await request('/settings',null)).status,401);assert.equal((await request('/settings',M)).status,403);
 for(const [method,path,roles,action]of systemEndpoints){if(method==='get'&&!path.includes(':id'))assert.equal((await request(path,E)).status,roles.includes('E')?200:403,action);}
 assert.equal((await request('/settings/monitoring',A,'PUT',{idleMinutes:8,trackApplications:false})).status,200);
 const body=await(await request('/settings')).json();assert.equal(body.data.monitoring.idleMinutes,8);assert.equal(body.data.monitoring.trackApplications,false);
 assert.equal((await request('/settings/monitoring',A,'PUT',{idleMinutes:0})).status,400);
 assert.equal((await request('/settings/monitoring',A,'PUT',{password:'bad'})).status,400);
 assert.equal((await request('/settings/data-retention',A,'PUT',{requireConsent:false})).status,400);
 assert.equal((await request('/settings/notifications',A,'PUT',{notifyIdle:false,weeklyDigest:true})).status,200);
 assert.equal((await request('/settings/data-retention',A,'PUT',{retentionDays:180})).status,200);
});
test('working-hours require explicit IANA timezone and weekly schedule; registered Agent can read only',async()=>{
 const schedule=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day,i)=>({day,enabled:i<5,start:'09:00',end:'17:30'}));
 assert.equal((await request('/settings/working-hours',A,'PUT',{schedule})).status,400);
 assert.equal((await request('/settings/working-hours',A,'PUT',{schedule,timezone:'Asia/Colombo'})).status,200);
 assert.equal((await(await request('/settings/working-hours',D)).json()).data.timezone,'Asia/Colombo');
 assert.equal((await request('/settings',D)).status,403);
 const result=await client.rpc('wp_core_devices',{p_actor:D.context.userId,p_device:D.context.deviceId,p_action:'agent-config',p_id:null,p_data:{offlineTimeoutSeconds:300}});
 assert.equal(result.error,null);assert.equal(result.data.idleThreshold,480);assert.equal(result.data.workingHoursPolicy.timezone,'Asia/Colombo');
});
test('notifications enforce owner scope, read/read-all and soft deletion',async()=>{
 const all=await(await request('/notifications')).json();assert.ok(all.data.length>=1);const id=all.data[0].id;
 assert.equal((await request('/notifications/'+id+'/read',E,'PATCH')).status,404);
 assert.equal((await request('/notifications/'+id+'/read',A,'PATCH')).status,200);
 assert.equal((await request('/notifications/read-all',A,'PATCH')).status,200);
 assert.equal((await request('/notifications/'+id,A,'DELETE')).status,200);
 assert.ok(!(await(await request('/notifications')).json()).data.some(x=>x.id===id));
});
test('audit is Admin-only, records actor/resource without credentials, supports CSV and filters',async()=>{
 const data=await(await request('/audit-logs?action=settings.update')).json();assert.ok(data.data.length>=3);assert.ok(data.data.every(x=>x.actor_id===A.id));
 assert.equal((await request('/audit-logs',M)).status,403);assert.equal((await request('/audit-logs?actorId=bad')).status,400);
 const csv=await request('/audit-logs/export');assert.equal(csv.status,200);const text=await csv.text();assert.ok(text.includes('settings.update'));assert.ok(!text.includes(device.credential));
 assert.equal((await request('/audit-logs?from=2026-11-23T00:00:00Z&to=2026-11-22T00:00:00Z')).status,400);
 assert.equal((await request('/audit-logs?from=2026-02-30T00:00:00Z')).status,400);
});
test('health/version are public; release metadata is fail-closed and Agent-only',async()=>{
 assert.equal((await request('/health',null)).status,200);assert.equal((await(await request('/version',null)).json()).data.version,'1.0.0');
 assert.equal((await request('/agent/latest',A)).status,403);assert.equal((await request('/agent/latest',D)).status,503);
 config.latestAgent={version:'1.0.0',url:'https://downloads.example.test/WorkPulseAgentSetup.exe',sha256:'a'.repeat(64),bytes:12345};
 assert.deepEqual((await(await request('/agent/latest',D)).json()).data,config.latestAgent);config.latestAgent=null;
 assert.throws(()=>loadSystemConfig({AGENT_INSTALLER_URL:'http://bad.test'}));assert.throws(()=>loadSystemConfig({AGENT_MIN_VERSION:'no'}));
});
test('socket handshake rejects invalid tokens and unauthorized Origins',async()=>{
 await assert.rejects(connected(socket({token:'invalid'})),/Authentication failed/);
 await assert.rejects(connected(socket({token:A.token},{extraHeaders:{Origin:'https://evil.example.test'}})));
});
test('valid human and device sockets connect; raw device credentials reuse device login',async()=>{
 const a=socket({token:A.token});await connected(a);const d=socket({token:D.token});await connected(d);
 const raw=socket({deviceId:device.deviceId,deviceCredential:device.credential});await connected(raw);
 const denied=await new Promise(r=>a.emit('join','organization:all',r));assert.equal(denied.success,false);
 assert.equal(realtime.io.sockets.sockets.get(a.id).handshake.auth.token,undefined);
});
test('committed activity/status events and actual scoped dashboard stats reach authorized dashboards only',async()=>{
 const a=socket({token:A.token}),m=socket({token:M.token}),e=socket({token:E.token});await Promise.all([connected(a),connected(m),connected(e)]);
 await realtime.poll();let leaked=false;e.on('activity:update',()=>{leaked=true;});
 const ap=event(a,'activity:update'),mp=event(m,'activity:update');
 const rid=randomUUID(),start=new Date(Date.now()-60000).toISOString(),end=new Date().toISOString();
 await db.query('insert into wp_activity_intervals(device_id,record_id,employee_id,interval_start,interval_end,interval_seconds,active_seconds,idle_seconds,mouse_movements,mouse_clicks,key_presses,summary,content_hash) values($1,$2,$3,$4,$5,60,50,10,1,1,1,$6,$7)',[device.deviceId,rid,E.id,start,end,'{}','a'.repeat(64)]);
 await realtime.poll();assert.equal((await ap).record_id,rid);assert.equal((await mp).employee_id,E.id);assert.equal(leaked,false);
 const status=event(a,'employee:status'),stats=event(m,'dashboard:stats');
 await db.query("insert into wp_status_events(device_id,record_id,employee_id,status) values($1,$2,$3,'PAUSED')",[device.deviceId,randomUUID(),E.id]);
 await realtime.poll();assert.equal((await status).status,'PAUSED');assert.ok(Number.isInteger((await stats).total_employees));
 await db.query('delete from wp_auth_manager_assignments where manager_id=$1',[M.id]);
 assert.equal(await repository.visible(M.context,{event_name:'activity:update',employee_id:E.id}),false);
});
test('settings notifications target owner; settings events target valid registered Agents',async()=>{
 const a=socket({token:A.token}),d=socket({token:D.token}),e=socket({token:E.token});await Promise.all([connected(a),connected(d),connected(e)]);let leaked=false;e.on('notification:new',()=>{leaked=true;});
 const notice=event(a,'notification:new'),settings=event(d,'settings:updated');
 assert.equal((await request('/settings/monitoring',A,'PUT',{idleMinutes:9})).status,200);await realtime.poll();
 assert.equal((await notice).type,'settings');assert.equal((await settings).section,'monitoring');assert.equal(leaked,false);
});
test('rolled back writes and no-op settings produce no live events or notifications',async()=>{
 const before=Number((await db.query('select count(*) as n from wp_realtime_events')).rows[0].n);
 await db.exec('begin');await db.query("insert into wp_notifications(user_id,type,message) values($1,'settings','Synthetic rolled-back notice')",[A.id]);await db.exec('rollback');
 assert.equal(Number((await db.query('select count(*) as n from wp_realtime_events')).rows[0].n),before);
 assert.equal((await request('/settings/monitoring',A,'PUT',{idleMinutes:9})).status,200);
 assert.equal(Number((await db.query('select count(*) as n from wp_realtime_events')).rows[0].n),before);
});
test('administrative RPCs record actor and affected resource transactionally',async()=>{
 const id=randomUUID();let result=await client.rpc('wp_core_department_write',{p_actor:A.id,p_action:'create',p_id:id,p_data:{name:'Synthetic department',description:'test'}});assert.equal(result.error,null);
 const rows=await db.query("select * from wp_audit_logs where resource='department' and resource_id=$1",[id]);assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].actor_id,A.id);
 result=await client.rpc('wp_core_department_write',{p_actor:E.id,p_action:'create',p_id:randomUUID(),p_data:{name:'Forbidden'}});assert.ok(result.error);
 assert.equal((await db.query("select count(*) as n from wp_audit_logs where resource='department'")).rows[0].n,1);
});
test('storage failures fail closed and logs never serialize exception text or credentials',async()=>{
 const broken=createSystemRepository({rpc:async()=>({error:{code:'XX000',message:'secret-value'}})});
 await assert.rejects(broken.run(A.context,'settings'),{status:503,safeMessage:'System storage unavailable'});
 const output=[];logFailure('test.failure',new Error('JWT secret-value'),value=>output.push(value));assert.ok(!output[0].includes('secret-value'));
 assert.doesNotThrow(()=>logFailure('test.failure',new Error(),()=>{throw new Error();}));
});
test('core HTTP CRUD remains functional with all seven migrations composed',async()=>{
 const department=await request('/departments',A,'POST',{name:'Phase 9 composed schema',description:'Synthetic fixture'});assert.equal(department.status,201);const dept=await department.json();
 const created=await request('/employees',A,'POST',{firstName:'Synthetic',lastName:'Final review',email:randomUUID()+'@example.test',password:'Synthetic-password-123!',temporary:false,departmentId:dept.id});assert.equal(created.status,201);const employee=await created.json();
 assert.equal((await request('/employees/'+employee.id)).status,200);
 assert.equal((await request('/employees/'+employee.id,A,'PUT',{firstName:'Updated'})).status,200);
 assert.equal((await request('/departments/'+dept.id,A,'DELETE')).status,409);
 assert.equal((await request('/employees/'+employee.id+'/department',A,'PATCH',{departmentId:null})).status,200);
 assert.equal((await request('/employees/'+employee.id+'/status',A,'PATCH',{active:false})).status,200);
 assert.equal((await request('/employees/'+employee.id,A,'DELETE')).status,204);
 assert.equal((await request('/departments/'+dept.id,A,'DELETE')).status,204);
 const audit=await(await request('/audit-logs?resource=employee&actorId='+A.id)).json();assert.ok(audit.data.some(row=>row.resource_id===employee.id&&row.action==='employee.create'));
});
test('heartbeat expiry emits offline then renewed presence emits online without marking pause idle',async()=>{
 const a=socket({token:A.token});await connected(a);const off=event(a,'device:offline');
 await db.query("update wp_auth_devices set last_seen=now()-interval '10 minutes' where id=$1",[device.deviceId]);await realtime.poll();assert.equal((await off).connectionState,'OFFLINE');
 const on=event(a,'device:online');await db.query('update wp_auth_devices set last_seen=now() where id=$1',[device.deviceId]);await realtime.poll();assert.equal((await on).connectionState,'ONLINE');
});
test('revoked sessions and disabled devices disconnect and cannot reconnect',async()=>{
 const user=await seed('E'),s=socket({token:user.token});await connected(s);const disconnected=event(s,'disconnect');await auth.logout(user.context);await realtime.revalidate();await disconnected;
 await assert.rejects(connected(socket({token:user.token})),/Authentication failed/);
 const d=socket({token:D.token});await connected(d);const gone=event(d,'disconnect');await db.query('update wp_auth_devices set is_active=false where id=$1',[device.deviceId]);await realtime.revalidate();await gone;
 await assert.rejects(connected(socket({token:D.token})),/Authentication failed/);
});
test('new tables deny browser roles and no secrets are copied into outbox/audit',async()=>{
 const rows=await db.query('select payload from wp_realtime_events');assert.ok(!JSON.stringify(rows.rows).includes(device.credential));
 await db.exec('set role anon');try{await assert.rejects(db.query('select * from wp_notifications'));await assert.rejects(db.query('select wp_system(null,null,null,\'settings\',null,\'{}\')'));}finally{await db.exec('set role service_role');}
});
test('socket authentication attempts are rate-limited before credential verification',async()=>{
 const http=createServer(),limited=attachRealtime(http,{auth,repository,config:{...config,authAttempts:1}});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${http.address().port}`,first=io(url,{auth:{token:A.token},transports:['websocket'],reconnection:false}),second=io(url,{auth:{token:A.token},transports:['websocket'],reconnection:false,autoConnect:false});
 try{await connected(first);const denied=connected(second);second.connect();await assert.rejects(denied,/Authentication failed/);}
 finally{first.disconnect();second.disconnect();await limited.stop();}
});
