import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes,randomUUID } from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { postgresClient } from './postgres-client.js';
import { createAuthRepository } from '../services/auth-repository.js';
import { createAuthService } from '../services/auth-service.js';
import { createCoreRepository } from '../services/core-repository.js';
import { createEmployeeService } from '../services/employees.js';
import { createDepartmentService } from '../services/departments.js';
import { createDeviceService } from '../services/devices.js';
import { createProfileService } from '../services/profile.js';
import { createConsentService } from '../services/consent.js';
import { hashPassword } from '../services/passwords.js';
import { createCoreRouter } from '../routes/core.js';
import { errorHandler,notFound } from '../middleware/error-handler.js';
import { loadAgentPolicy } from '../config/agent-policy.js';
import { csv } from '../utils/csv.js';

const db=new PGlite(), client=postgresClient(db);
const config={secret:randomBytes(48).toString('base64url'),issuer:'workpulse-api',userAudience:'workpulse-dashboard',agentAudience:'workpulse-agent',
  accessSeconds:900,refreshSeconds:3600,resetSeconds:1800,temporarySeconds:86400,bcryptRounds:10};
const password='Synthetic-Password-123!';let hash,server,base,A,M,E,O,dept,otherDept,device;
const mailer={async sendAccountCreated(){},async sendPasswordChanged(){},assertResetReady(){},async sendPasswordReset(){}};
const auth=createAuthService({repository:createAuthRepository(client),config,mailer});
const repository=createCoreRepository(client);
const services={auth,repository,employees:createEmployeeService({repository,config,mailer}),departments:createDepartmentService({repository}),
  devices:createDeviceService({repository,config,policy:loadAgentPolicy()}),profile:createProfileService({repository}),consent:createConsentService({repository})};
const coverage=new Set();
async function seed(role='E') {
  const id=randomUUID(),email=`${id}@example.test`;
  await db.query('insert into wp_auth_users(id,email,password_hash,role) values($1,$2,$3,$4)',[id,email,hash,role]);
  const session=await auth.login(email,password); return {id,email,token:session.accessToken,context:await auth.authenticate(session.accessToken)};
}
async function call(method,path,actor=A,body,expected,template=path) {
  const response=await fetch(base+'/api/v1'+path,{method,headers:{...(actor?{Authorization:`Bearer ${actor.token}`} : {}),
    ...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  if(expected!==undefined)assert.equal(response.status,expected,`${method} ${path}: ${await response.clone().text()}`);
  if(response.status<300 || response.status===503)coverage.add(`${method} ${template}`);
  return response;
}
async function department(name,managerId=M.id) {return (await call('POST','/departments',A,{name,managerId},201)).json();}
async function employee(data={}) {return (await call('POST','/employees',A,{firstName:'Synthetic',lastName:'Employee',email:`${randomUUID()}@example.test`,password,temporary:false,...data},201)).json();}

const endpoints=[['GET','/employees'],['POST','/employees'],['GET','/employees/:id'],['PUT','/employees/:id'],
 ['PATCH','/employees/:id/status'],['PATCH','/employees/:id/department'],['POST','/employees/bulk-deactivate'],
 ['POST','/employees/:id/reset-password'],['DELETE','/employees/:id'],['GET','/employees/summary'],['GET','/employees/export'],
 ['GET','/departments'],['POST','/departments'],['GET','/departments/:id'],['PUT','/departments/:id'],['DELETE','/departments/:id'],
 ['GET','/departments/:id/employees'],['GET','/departments/:id/productivity'],['GET','/departments/export'],
 ['POST','/devices/register'],['GET','/devices'],['GET','/devices/:id'],['PATCH','/devices/:id/status'],['DELETE','/devices/:id'],
 ['POST','/devices/heartbeat'],['GET','/devices/agent-config'],['GET','/profile'],['PUT','/profile'],['POST','/profile/avatar'],
 ['GET','/profile/login-history'],['GET','/profile/notification-preferences'],['PUT','/profile/notification-preferences'],['POST','/profile/logout-all'],
 ['GET','/consent/policy'],['POST','/consent/accept'],['GET','/consent/status/:employeeId'],['PUT','/consent/policy']];

before(async()=>{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const file of ['001_auth.proposed.sql','002_core_management.proposed.sql']) await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await db.exec('set role service_role');hash=await hashPassword(password,10);
  const app=express();app.use(express.json({limit:'1mb'}));app.use('/api/v1',createCoreRouter(services));app.use(notFound);app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
  A=await seed('A');M=await seed('M');E=await seed();O=await seed();
  dept=await department('Engineering');otherDept=await department('Restricted',A.id);
  await db.query('update wp_employee_profiles set department_id=$1 where user_id=$2',[dept.id,E.id]);
  device=await auth.provisionDevice(A.context,E.id);const session=await auth.loginDevice(device.deviceId,device.credential);
  device.token=session.accessToken;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db.close();});

test('all 37 documented management endpoints require authentication',async()=>{
  for(const [method,template]of endpoints){const path=template.replace(':employeeId',E.id).replace(':id',E.id);await call(method,path,null,undefined,401);}
});
test('role permissions reject employee management, manager writes, device/profile misuse',async()=>{
  for(const [method,path,actor]of [['GET','/employees',E],['POST','/employees',M],['PUT','/employees/'+E.id,M],
    ['POST','/departments',M],['GET','/departments/export',M],['POST','/devices/register',E],['POST','/devices/heartbeat',A],
    ['GET','/devices/agent-config',M],['GET','/profile',device],['POST','/consent/accept',A],['GET','/consent/status/'+E.id,M]]) {
    await call(method,path,actor,undefined,403);
  }
});
test('employee create/get/list/update support search, filters and pagination without credential leakage',async()=>{
  const user=await employee({firstName:'UniqueName',departmentId:dept.id,employeeCode:'CSV-100'});
  assert.equal(user.department_id,dept.id);assert.equal(user.role,'E');assert.ok(!JSON.stringify(user).includes('password'));
  const got=await(await call('GET','/employees/'+user.id,A,undefined,200,'/employees/:id')).json();assert.equal(got.id,user.id);
  const filtered=await(await call('GET',`/employees?search=UniqueName&departmentId=${dept.id}&role=E&status=active&page=1&pageSize=1`,A,undefined,200,'/employees')).json();
  assert.equal(filtered.total,1);assert.equal(filtered.items.length,1);assert.equal(filtered.pageSize,1);
  const updated=await(await call('PUT','/employees/'+user.id,A,{firstName:'Renamed',phone:'+94 123'},200,'/employees/:id')).json();assert.equal(updated.first_name,'Renamed');
});
test('duplicate email and employee codes are rejected atomically',async()=>{
  const user=await employee({employeeCode:'DUPLICATE-CODE'});
  const body={firstName:'Test',lastName:'Duplicate',email:user.email,password};
  await call('POST','/employees',A,body,409);
  await call('POST','/employees',A,{...body,email:`${randomUUID()}@example.test`,employeeCode:'DUPLICATE-CODE'},409);
  assert.equal((await db.query('select count(*) from wp_auth_users where email=$1',[body.email])).rows[0].count,1);
});
test('manager can read only assigned employees/departments and scoped CSV',async()=>{
  const data=await(await call('GET','/employees',M,undefined,200)).json();assert.ok(data.items.some(x=>x.id===E.id));assert.ok(!data.items.some(x=>x.id===O.id));
  await call('GET','/employees/'+O.id,M,undefined,404);
  await call('GET','/departments/'+otherDept.id,M,undefined,404);
  const exportData=await(await call('GET','/employees/export',M,undefined,200)).text();assert.ok(exportData.includes(E.email));assert.ok(!exportData.includes(O.email));
});
test('activate/deactivate revoke sessions; soft deletion retains records',async()=>{
  const user=await employee();const session=await auth.login(user.email,password);
  await call('PATCH','/employees/'+user.id+'/status',A,{active:false},200,'/employees/:id/status');
  await assert.rejects(auth.authenticate(session.accessToken),{status:401});
  await call('PATCH','/employees/'+user.id+'/status',A,{active:true},200,'/employees/:id/status');
  await call('DELETE','/employees/'+user.id,A,undefined,204,'/employees/:id');
  assert.ok((await db.query('select deleted_at from wp_auth_users where id=$1',[user.id])).rows[0].deleted_at);
  await call('GET','/employees/'+user.id,A,undefined,404);await call('PATCH','/employees/'+user.id+'/status',A,{active:true},404);
});
test('department assignment, bulk deactivation and missing-member rollback',async()=>{
  const one=await employee(),two=await employee();
  await call('PATCH','/employees/'+one.id+'/department',A,{departmentId:dept.id},200,'/employees/:id/department');
  await call('POST','/employees/bulk-deactivate',A,{ids:[one.id,randomUUID()]},404);
  assert.equal((await db.query('select is_active from wp_auth_users where id=$1',[one.id])).rows[0].is_active,true);
  await call('POST','/employees/bulk-deactivate',A,{ids:[one.id,two.id]},200);
  await call('POST','/employees/bulk-deactivate',A,{ids:[A.id]},409);
  await call('POST','/employees/bulk-deactivate',A,{ids:[two.id,two.id]},400);
});
test('temporary password generation revokes access and enforces first-login password change',async()=>{
  const user=await employee();const session=await auth.login(user.email,password);
  const result=await(await call('POST','/employees/'+user.id+'/reset-password',A,undefined,200,'/employees/:id/reset-password')).json();
  assert.ok(result.temporaryPassword.length>=12);await assert.rejects(auth.authenticate(session.accessToken),{status:401});
  const fresh=await auth.login(user.email,result.temporaryPassword);assert.equal(fresh.user.mustChangePassword,true);
  await call('GET','/profile',{token:fresh.accessToken},undefined,403);
});
test('employee summary and CSV return actual scoped counts and escape formulas',async()=>{
  const summary=await(await call('GET','/employees/summary',A,undefined,200)).json();assert.ok(summary.totalEmployees>=4);assert.equal(typeof summary.agentNotInstalled,'number');
  await employee({firstName:'=HYPERLINK("bad")',lastName:'Comma,Quote"'});
  const response=await call('GET','/employees/export',A,undefined,200);assert.ok(response.headers.get('content-type').includes('text/csv'));
  const text=await response.text();assert.ok(text.includes("'=HYPERLINK"));assert.ok(text.includes('Comma,Quote""'));
  assert.ok(!text.includes('password_hash'));assert.ok(!text.includes('credential_hash'));
  assert.ok(csv([{v:'   +CMD'}],[['Value','v']]).includes("'   +CMD"));
});
test('departments list/get/update/employees return real membership statistics',async()=>{
  const list=await(await call('GET','/departments?pageSize=1',A,undefined,200,'/departments')).json();assert.equal(list.items.length,1);assert.ok(list.total>=2);
  const data=await(await call('GET','/departments/'+dept.id,M,undefined,200,'/departments/:id')).json();assert.ok(data.employee_count>=1);
  await call('PUT','/departments/'+dept.id,A,{description:'Updated description'},200,'/departments/:id');
  const employees=await(await call('GET','/departments/'+dept.id+'/employees',M,undefined,200,'/departments/:id/employees')).json();
  assert.ok(employees.items.every(x=>x.department_id===dept.id));
  const exported=await call('GET','/departments/export',A,undefined,200);assert.ok((await exported.text()).includes('Engineering'));
});
test('department deletion requires atomic reassignment and preserves soft-deleted history',async()=>{
  const original=await department('To-delete'),replacement=await department('Replacement');const user=await employee({departmentId:original.id});
  await call('DELETE','/departments/'+original.id,A,undefined,409);
  await call('DELETE','/departments/'+original.id,A,{reassignToDepartmentId:randomUUID()},400);
  assert.equal((await db.query('select department_id from wp_employee_profiles where user_id=$1',[user.id])).rows[0].department_id,original.id);
  await call('DELETE','/departments/'+original.id,A,{reassignToDepartmentId:replacement.id},204,'/departments/:id');
  assert.equal((await db.query('select department_id from wp_employee_profiles where user_id=$1',[user.id])).rows[0].department_id,replacement.id);
  assert.ok((await db.query('select deleted_at from wp_departments where id=$1',[original.id])).rows[0].deleted_at);
});
test('duplicate department names, invalid managers and missing records fail',async()=>{
  await call('POST','/departments',A,{name:' engineering '},409);
  await call('POST','/departments',A,{name:'Bad-manager',managerId:E.id},400);
  for(const resource of ['employees','departments','devices'])await call('GET','/'+resource+'/'+randomUUID(),A,undefined,404);
});
test('productivity endpoint refuses fabricated statistics without approved telemetry',async()=>{
  await call('GET','/departments/'+dept.id+'/productivity',M,undefined,503,'/departments/:id/productivity');
  await call('GET','/departments/'+dept.id+'/productivity?from=2026-11-21&to=2026-11-01',A,undefined,400);
});
test('device registration rotates credentials, keeps ownership, and invalidates older tokens',async()=>{
  const old=device.token;
  await call('POST','/devices/register',device,{name:'Synthetic PC',platform:'Windows 11',deviceCredential:randomBytes(32).toString('base64url')},401);
  const registration=await(await call('POST','/devices/register',device,{name:'Synthetic PC',platform:'Windows 11',deviceCredential:device.credential},201)).json();
  assert.equal(registration.device.user_id,E.id);assert.ok(!('credential_hash'in registration.device));
  await assert.rejects(auth.authenticate(old),{status:401});
  await assert.rejects(auth.loginDevice(device.deviceId,device.credential),{status:401});
  assert.ok(await auth.loginDevice(device.deviceId,registration.deviceCredential));
  device.token=registration.accessToken;device.credential=registration.deviceCredential;
  await call('POST','/devices/register',device,{name:'Test',platform:'Windows',employeeId:O.id},400);
});
test('heartbeat and agent policy report actual device state and configured working hours',async()=>{
  const heartbeat=await(await call('POST','/devices/heartbeat',device,undefined,200)).json();assert.ok(heartbeat.lastSeen);
  const config=await(await call('GET','/devices/agent-config',device,undefined,200)).json();
  assert.equal(config.idleThreshold,300);assert.equal(config.trackingInterval,60);assert.equal(config.requireConsent,true);
  assert.equal(config.consentAccepted,false);assert.equal(config.manualStopOverridesSchedule,true);
  assert.equal(config.workingHours.timezone,'Asia/Colombo');
});
test('device list/detail are scoped and never expose credential hashes',async()=>{
  const list=await(await call('GET','/devices',M,undefined,200)).json();assert.ok(list.items.some(x=>x.id===device.deviceId));
  assert.ok(!JSON.stringify(list).includes('credential_hash'));
  await call('GET','/devices/'+device.deviceId,A,undefined,200,'/devices/:id');
  const extra=await auth.provisionDevice(A.context,O.id);await call('GET','/devices/'+extra.deviceId,M,undefined,404);
});
test('device disable/enable/remove safely invalidate sessions and preserve data',async()=>{
  const extra=await auth.provisionDevice(A.context,O.id);const session=await auth.loginDevice(extra.deviceId,extra.credential);
  await call('PATCH','/devices/'+extra.deviceId+'/status',A,{active:false},200,'/devices/:id/status');
  await assert.rejects(auth.authenticate(session.accessToken),{status:401});
  await call('PATCH','/devices/'+extra.deviceId+'/status',A,{active:true},200,'/devices/:id/status');
  assert.ok(await auth.loginDevice(extra.deviceId,extra.credential));
  await call('DELETE','/devices/'+extra.deviceId,A,undefined,204,'/devices/:id');
  assert.ok((await db.query('select deleted_at from wp_auth_devices where id=$1',[extra.deviceId])).rows[0].deleted_at);
  await assert.rejects(auth.loginDevice(extra.deviceId,extra.credential),{status:401});
});
test('own profile updates cannot change identity, role or another employee',async()=>{
  const result=await(await call('GET','/profile',E,undefined,200)).json();assert.equal(result.id,E.id);
  const changed=await(await call('PUT','/profile',E,{firstName:'OwnName',phone:'+94',language:'en',timezone:'Asia/Colombo'},200)).json();assert.equal(changed.first_name,'OwnName');
  for(const body of [{userId:O.id},{role:'A'},{departmentId:otherDept.id},{timezone:'Not/AZone'}])await call('PUT','/profile',E,body,400);
});
test('avatar endpoint sanitizes real images and rejects invalid content',async()=>{
  const png=await sharp({create:{width:16,height:16,channels:3,background:'#2563eb'}}).png().toBuffer();
  const result=await(await call('POST','/profile/avatar',E,{imageBase64:png.toString('base64')},200)).json();assert.ok(result.avatar.startsWith('data:image/png;base64,'));
  await call('POST','/profile/avatar',E,{imageBase64:Buffer.from('<svg/>').toString('base64')},400);
});
test('profile login history and notification preferences are own-only',async()=>{
  const history=await(await call('GET','/profile/login-history',E,undefined,200)).json();assert.ok(history.items.length>=1);
  assert.ok(!JSON.stringify(history).includes('token_hash'));
  await call('GET','/profile/notification-preferences',E,undefined,200);
  const prefs=await(await call('PUT','/profile/notification-preferences',E,{emailDailySummary:true,emailWeeklyReport:true},200)).json();assert.equal(prefs.emailWeeklyReport,true);
  await call('GET','/profile/login-history?employeeId='+O.id,E,undefined,400);
});
test('privacy policy versions and consent are owned, immutable and require the current version',async()=>{
  await call('GET','/consent/policy',E,undefined,404);
  const policy=await(await call('PUT','/consent/policy',A,{content:'Synthetic privacy policy for tests. Counts only.'},201)).json();
  assert.equal(policy.version,1);await call('GET','/consent/policy',device,undefined,200);
  const receipt=await(await call('POST','/consent/accept',E,{policyVersion:1},200)).json();assert.equal(receipt.user_id,E.id);assert.ok(receipt.accepted_at);
  const again=await(await call('POST','/consent/accept',device,{policyVersion:1},200)).json();assert.equal(again.accepted_at,receipt.accepted_at);
  const status=await(await call('GET','/consent/status/'+E.id,A,undefined,200,'/consent/status/:employeeId')).json();assert.equal(status.accepted,true);
  const agentConfig=await(await call('GET','/devices/agent-config',device,undefined,200)).json();assert.equal(agentConfig.consentAccepted,true);
  await call('PUT','/consent/policy',A,{content:'Version two.'},201);
  await call('POST','/consent/accept',E,{policyVersion:1},409);
  await call('POST','/consent/accept',E,{policyVersion:2,employeeId:O.id},400);
  assert.equal((await(await call('GET','/consent/status/'+E.id,A,undefined,200)).json()).accepted,false);
});
test('profile logout-all invalidates every human/device session',async()=>{
  const user=await seed();const second=await auth.login(user.email,password);const extra=await auth.provisionDevice(A.context,user.id);
  const agentSession=await auth.loginDevice(extra.deviceId,extra.credential);
  await call('POST','/profile/logout-all',user,undefined,204);
  for(const token of [user.token,second.accessToken,agentSession.accessToken])await assert.rejects(auth.authenticate(token),{status:401});
});
test('validation rejects bad pagination, UUIDs, empty updates, SQL-like input and unknown fields',async()=>{
  await call('GET','/employees?page=0',A,undefined,400);await call('GET','/employees?pageSize=1000',A,undefined,400);
  await call('GET','/employees/not-a-uuid',A,undefined,400);await call('PUT','/employees/'+E.id,A,{},400);
  await call('GET','/employees?search=%27%20OR%201=1%20--',A,undefined,200);
  await call('POST','/employees',A,{email:'invalid',password},400);
});
test('database outages return safe errors and RLS denies direct browser access',async()=>{
  const unavailable=createCoreRepository({rpc:async()=>({error:{code:'PGRST205',message:'private-database-detail'}})});
  await assert.rejects(unavailable.employees(A.context,{}),{status:503,message:'Management storage unavailable'});
  await db.exec('reset role;set role anon');
  try{await assert.rejects(db.query('select * from wp_employee_profiles'));await assert.rejects(db.query('select wp_core_employee_summary($1)',[A.id]));}
  finally{await db.exec('reset role;set role service_role');}
});
test('every documented endpoint rejects all unauthorized role classes',async()=>{
  const allHumans=['A','M','E'];
  const permissions=[['A','M'],['A'],['A','M'],['A'],['A'],['A'],['A'],['A'],['A'],['A','M'],['A','M'],
    ['A','M'],['A'],['A','M'],['A'],['A'],['A','M'],['A','M'],['A'],
    ['Agent'],['A','M'],['A','M'],['A'],['A'],['Agent'],['Agent'],
    allHumans,allHumans,allHumans,allHumans,allHumans,allHumans,allHumans,
    ['A','M','E','Agent'],['E','Agent'],['A'],['A']];
  assert.equal(permissions.length,endpoints.length);
  for(const [index,[method,template]]of endpoints.entries()) {
    const path=template.replace(':employeeId',E.id).replace(':id',E.id);
    for(const [role,actor]of [['A',A],['M',M],['E',E],['Agent',device]]) {
      if(!permissions[index].includes(role))await call(method,path,actor,undefined,403);
    }
  }
});
test('missing mutation targets and department subresources return 404',async()=>{
  const missing=randomUUID();
  for(const [method,path,body]of [['PUT','/employees/'+missing,{firstName:'Missing'}],['PATCH','/employees/'+missing+'/status',{active:false}],
    ['PATCH','/employees/'+missing+'/department',{departmentId:null}],['DELETE','/employees/'+missing,undefined],
    ['POST','/employees/'+missing+'/reset-password',undefined],['PUT','/departments/'+missing,{name:'Missing'}],
    ['DELETE','/departments/'+missing,undefined],['GET','/departments/'+missing+'/employees',undefined],['GET','/departments/'+missing+'/productivity',undefined],
    ['PATCH','/devices/'+missing+'/status',{active:false}],['DELETE','/devices/'+missing,undefined],['GET','/consent/status/'+missing,undefined]]) {
    await call(method,path,A,body,404);
  }
});
test('database failures are sanitized through actual HTTP routes for every management module',async()=>{
  const failing=createCoreRepository({rpc:async()=>({error:{code:'PGRST205',message:'private-database-detail'}})});
  const app=express();app.use(express.json());app.use('/api/v1',createCoreRouter({auth,repository:failing,
    employees:createEmployeeService({repository:failing,config,mailer}),departments:createDepartmentService({repository:failing}),
    devices:createDeviceService({repository:failing,config,policy:loadAgentPolicy()}),profile:createProfileService({repository:failing}),
    consent:createConsentService({repository:failing})}));app.use(errorHandler);
  const temporary=app.listen(0,'127.0.0.1');await new Promise(resolve=>temporary.once('listening',resolve));
  try {
    for(const path of ['/employees','/departments','/devices','/profile','/consent/policy']) {
      const response=await fetch(`http://127.0.0.1:${temporary.address().port}/api/v1${path}`,{headers:{Authorization:`Bearer ${A.token}`}});
      assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:{message:'Management storage unavailable'}});
    }
  }finally{await new Promise(resolve=>temporary.close(resolve));}
});
test('management migration refuses duplicate columns and leaves existing records intact',async()=>{
  const count=(await db.query('select count(*) from wp_employee_profiles')).rows[0].count;
  await db.exec('reset role');
  try{await assert.rejects(db.exec(await readFile(new URL('../migrations/002_core_management.proposed.sql',import.meta.url),'utf8')));}
  finally{await db.exec('rollback;set role service_role');}
  assert.equal((await db.query('select count(*) from wp_employee_profiles')).rows[0].count,count);
});
test('every documented endpoint has an integration result (productivity explicitly unavailable)',()=>{
  for(const [method,path]of endpoints)assert.ok(coverage.has(`${method} ${path}`),`No integration result for ${method} ${path}`);
});
