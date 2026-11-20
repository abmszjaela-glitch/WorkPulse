import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { PGlite } from '@electric-sql/pglite';
import { postgresClient } from './postgres-client.js';
import { createAuthRepository } from '../services/auth-repository.js';
import { createAuthService } from '../services/auth-service.js';
import { hashPassword, comparePassword, validatePassword } from '../services/passwords.js';
import { tokenHash } from '../services/tokens.js';
import { authenticate, authorize, authorizeEmployee } from '../middleware/auth.js';
import { errorHandler } from '../middleware/error-handler.js';
import { createAuthRouter } from '../routes/auth.js';

const db = new PGlite();
const config = { secret: randomBytes(48).toString('base64url'), issuer: 'workpulse-api', userAudience: 'workpulse-dashboard',
  agentAudience: 'workpulse-agent', accessSeconds: 900, refreshSeconds: 3600, resetSeconds: 1800, temporarySeconds: 86400, bcryptRounds: 10 };
const password = 'Synthetic-Password-123!';
const repository = createAuthRepository(postgresClient(db));
let hash, server, base;
const sent = [];
const notifications = [];
const mailer = { assertResetReady() {}, async sendPasswordReset(email, token) { sent.push({ email, token }); },
  async sendAccountCreated(email) { notifications.push({ kind: 'created', email }); },
  async sendPasswordChanged(email) { notifications.push({ kind: 'password', email }); } };
const service = createAuthService({ repository, config, mailer });

async function seed(role = 'E', options = {}) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await db.query('insert into wp_auth_users(id,email,password_hash,role,must_change_password,temporary_expires_at) values ($1,$2,$3,$4,$5,$6)',
    [id, email, hash, role, options.temporary || false, options.temporary ? new Date(Date.now() + 3600000).toISOString() : null]);
  return { id, email };
}
const login = (user) => service.login(user.email, password);
async function context(user) { return service.authenticate((await login(user)).accessToken); }
async function request(path, { method = 'GET', token, body } = {}) {
  return fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}

before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(await readFile(new URL('../migrations/001_auth.proposed.sql', import.meta.url), 'utf8'));
  await db.exec('set role service_role');
  hash = await hashPassword(password, config.bcryptRounds);
  const app = express(); app.use(express.json()); app.use('/api/v1/auth', createAuthRouter(service));
  app.get('/test/admin', authenticate(service), authorize('A'), (req,res) => res.json({ role: req.auth.role }));
  app.get('/test/manager', authenticate(service), authorize('A','M'), (req,res) => res.json({ role: req.auth.role }));
  app.get('/test/employee/:id', authenticate(service), authorizeEmployee(service), (req,res) => res.json({ allowed: true }));
  app.get('/test/agent', authenticate(service), authorize('Agent'), (req,res) => res.json({ deviceId: req.auth.deviceId }));
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if(server) await new Promise(resolve => server.close(resolve)); await db.close(); });

test('operator bootstrap succeeds only on an empty database', async () => {
  const id=randomUUID(), email=`${id}@example.test`;
  await db.query('select wp_auth_bootstrap_admin($1,$2,$3)',[id,email,hash]);
  assert.equal((await service.login(email,password)).user.role,'A');
  await assert.rejects(db.query('select wp_auth_bootstrap_admin($1,$2,$3)',[randomUUID(),'second@example.test',hash]));
});
test('valid login returns safe user, JWT and hashed refresh token', async () => {
  const user = await seed(); const response = await request('/api/v1/auth/login', { method: 'POST', body: { email: user.email, password, role: 'A' } });
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
  const result = await response.json(); assert.equal(result.user.role,'E'); assert.ok(!JSON.stringify(result).includes(hash));
  assert.equal((await service.authenticate(result.accessToken)).role,'E');
  const stored = (await db.query('select token_hash from wp_auth_refresh_tokens where token_hash=$1',[tokenHash(result.refreshToken)])).rows;
  assert.equal(stored.length,1); assert.notEqual(stored[0].token_hash,result.refreshToken);
});
test('invalid login and unknown account have the same safe response', async () => {
  const user = await seed();
  for (const email of [user.email, 'nonexistent@example.test']) {
    const response = await request('/api/v1/auth/login',{method:'POST',body:{email,password:'Wrong-synthetic-password!'}});
    assert.equal(response.status,401); assert.deepEqual(await response.json(),{error:{message:'Invalid credentials'}});
  }
});
test('missing credentials and wrong field types are rejected', async () => {
  for(const body of [{},{email:'bad',password:'x'},{email:'user@example.test',password:{unsafe:true}}]) {
    assert.equal((await request('/api/v1/auth/login',{method:'POST',body})).status,400);
  }
});
test('registration is admin-only, duplicate-safe and returns no password hash', async () => {
  const admin = await context(await seed('A')); const manager = await context(await seed('M'));
  const email = `${randomUUID()}@example.test`;
  await assert.rejects(service.registerEmployee(manager,{email,password,role:'A'}),{status:403});
  await assert.rejects(service.registerEmployee(null,{email,password}),{status:403});
  const user = await service.registerEmployee(admin,{email,password}); assert.equal(user.role,'E'); assert.ok(!('password_hash' in user));
  await assert.rejects(service.registerEmployee(admin,{email:email.toUpperCase(),password}),{status:409});
  assert.ok(await comparePassword(password,(await repository.getUser(user.id)).password_hash));
});
test('password validation rejects weak passwords and bcrypt truncation', () => {
  for(const value of ['short','a'.repeat(80),'Ä'.repeat(40)+'Aa1!']) assert.throws(()=>validatePassword(value),{status:400});
});
test('expired, tampered, wrong audience, wrong issuer and wrong algorithm JWTs are rejected', async () => {
  const user = await seed(); const session = await login(user); const decoded = jwt.decode(session.accessToken);
  const payload = { sid:decoded.sid,version:0,token_use:'access',role:'E' };
  const options={subject:user.id,issuer:config.issuer,audience:config.userAudience,jwtid:randomUUID(),expiresIn:-1};
  for(const token of [session.accessToken+'tampered', jwt.sign(payload,config.secret,options),
    jwt.sign(payload,config.secret,{...options,expiresIn:60,audience:'wrong'}),
    jwt.sign(payload,config.secret,{...options,expiresIn:60,issuer:'wrong'}),
    jwt.sign(payload,config.secret,{...options,expiresIn:60,algorithm:'HS384'})]) {
    await assert.rejects(service.authenticate(token),{status:401});
  }
});
test('unauthenticated access fails; admin, manager and employee permissions are enforced', async () => {
  assert.equal((await request('/test/admin')).status,401);
  for(const [role,adminStatus,managerStatus] of [['A',200,200],['M',403,200],['E',403,403]]) {
    const token=(await login(await seed(role))).accessToken;
    assert.equal((await request('/test/admin',{token})).status,adminStatus);
    assert.equal((await request('/test/manager',{token})).status,managerStatus);
  }
});
test('employee is self-only and manager is limited to explicit assignments', async () => {
  const employee = await seed(); const other = await seed(); const manager = await seed('M');
  const employeeToken = (await login(employee)).accessToken, managerToken=(await login(manager)).accessToken;
  assert.equal((await request('/test/employee/'+employee.id,{token:employeeToken})).status,200);
  assert.equal((await request('/test/employee/'+other.id,{token:employeeToken})).status,403);
  assert.equal((await request('/test/employee/'+employee.id,{token:managerToken})).status,403);
  await db.query('insert into wp_auth_manager_assignments values ($1,$2)',[manager.id,employee.id]);
  assert.equal((await request('/test/employee/'+employee.id,{token:managerToken})).status,200);
});
test('refresh rotates once; replay revokes the entire session including access tokens', async () => {
  const original=await login(await seed()); const rotated=await service.refresh(original.refreshToken);
  assert.notEqual(rotated.refreshToken,original.refreshToken);
  await assert.rejects(service.refresh(original.refreshToken),{status:401});
  await assert.rejects(service.refresh(rotated.refreshToken),{status:401});
  await assert.rejects(service.authenticate(rotated.accessToken),{status:401});
});
test('concurrent refresh does not produce two usable descendants', async () => {
  const original=await login(await seed());
  const results=await Promise.allSettled([service.refresh(original.refreshToken),service.refresh(original.refreshToken)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(service.authenticate(results.find(r=>r.status==='fulfilled').value.accessToken),{status:401});
});
test('logout immediately invalidates access and refresh tokens', async () => {
  const session=await login(await seed());
  assert.equal((await request('/api/v1/auth/me',{token:session.accessToken})).status,200);
  assert.equal((await request('/api/v1/auth/logout',{method:'POST',token:session.accessToken})).status,204);
  await assert.rejects(service.authenticate(session.accessToken),{status:401});
  await assert.rejects(service.refresh(session.refreshToken),{status:401});
});
test('device credential is required for agent access and disabled devices fail immediately', async () => {
  const user=await seed(); const actor=await context(await seed('A'));
  const human=await login(user); assert.equal((await request('/test/agent',{token:human.accessToken})).status,403);
  const device=await service.provisionDevice(actor,user.id);
  await assert.rejects(service.loginDevice(device.deviceId,'incorrect'),{status:401});
  const session=await service.loginDevice(device.deviceId,device.credential);
  assert.equal((await request('/test/agent',{token:session.accessToken})).status,200);
  assert.equal((await request('/test/admin',{token:session.accessToken})).status,403);
  await assert.rejects(service.changePassword(await service.authenticate(session.accessToken),password,'Changed-password-123!'),{status:403});
  await db.query('update wp_auth_devices set is_active=false where id=$1',[device.deviceId]);
  await assert.rejects(service.authenticate(session.accessToken),{status:401});
  await assert.rejects(service.refresh(session.refreshToken),{status:401});
});
test('deactivation rejects access and refresh immediately', async () => {
  const user=await seed(); const session=await login(user);
  await db.query('update wp_auth_users set is_active=false where id=$1',[user.id]);
  await assert.rejects(service.authenticate(session.accessToken),{status:401});
  await assert.rejects(service.refresh(session.refreshToken),{status:401});
});
test('forgot-password is generic, reset tokens are hashed, single-use and revoke sessions', async () => {
  const user=await seed(); const session=await login(user);
  const known=await request('/api/v1/auth/forgot-password',{method:'POST',body:{email:user.email}});
  const unknown=await request('/api/v1/auth/forgot-password',{method:'POST',body:{email:'missing@example.test'}});
  assert.deepEqual(await known.json(),await unknown.json());
  const token=sent.find(r=>r.email===user.email).token;
  assert.equal((await db.query('select token_hash from wp_auth_password_resets where token_hash=$1',[tokenHash(token)])).rows.length,1);
  const changed='Changed-password-123!'; await service.resetPassword(token,changed);
  await assert.rejects(service.resetPassword(token,changed),{status:400});
  await assert.rejects(service.authenticate(session.accessToken),{status:401});
  await assert.rejects(service.refresh(session.refreshToken),{status:401});
  await assert.rejects(login(user),{status:401}); assert.ok(await service.login(user.email,changed));
});
test('password change checks current password and invalidates all sessions', async () => {
  const user=await seed(); const first=await login(user), second=await login(user);
  const auth=await service.authenticate(first.accessToken);
  await assert.rejects(service.changePassword(auth,'Wrong-password-123!','Changed-password-123!'),{status:401});
  await service.changePassword(auth,password,'Changed-password-123!');
  for(const session of [first,second]) {
    await assert.rejects(service.authenticate(session.accessToken),{status:401});
    await assert.rejects(service.refresh(session.refreshToken),{status:401});
  }
});
test('temporary password restricts permissions until changed and expires', async () => {
  const user=await seed('A',{temporary:true}); const session=await login(user);
  assert.equal((await request('/test/admin',{token:session.accessToken})).status,403);
  assert.equal((await request('/api/v1/auth/change-password',{method:'PUT',token:session.accessToken,
    body:{currentPassword:password,newPassword:'Changed-password-123!'}})).status,204);
  assert.equal((await repository.getUser(user.id)).must_change_password,false);
  const expired=await seed('E',{temporary:true});
  await db.query("update wp_auth_users set temporary_expires_at=now()-interval '1 second' where id=$1",[expired.id]);
  await assert.rejects(login(expired),{status:401});
});
test('expired refresh and reset tokens fail safely', async () => {
  const user=await seed(); const session=await login(user);
  await db.query("update wp_auth_refresh_tokens set expires_at=now()-interval '1 second' where token_hash=$1",[tokenHash(session.refreshToken)]);
  await assert.rejects(service.refresh(session.refreshToken),{status:401});
  await service.forgotPassword(user.email); const token=sent.find(r=>r.email===user.email).token;
  await db.query("update wp_auth_password_resets set expires_at=now()-interval '1 second' where token_hash=$1",[tokenHash(token)]);
  await assert.rejects(service.resetPassword(token,'Changed-password-123!'),{status:400});
});
test('SQL permissions deny anon/authenticated access to auth storage and mutation RPCs', async () => {
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query('select * from wp_auth_users'));
      await assert.rejects(db.query('select wp_auth_reset_password($1,$2)',['x',hash]));
    } finally { await db.exec('reset role; set role service_role'); }
  }
});
test('refresh and password-reset HTTP routes enforce their contracts', async () => {
  const user=await seed(); const session=await login(user);
  assert.equal((await request('/api/v1/auth/refresh',{method:'POST',body:{}})).status,400);
  const refresh=await request('/api/v1/auth/refresh',{method:'POST',body:{refreshToken:session.refreshToken}});
  assert.equal(refresh.status,200); assert.ok((await refresh.json()).accessToken);
  await service.forgotPassword(user.email); const token=sent.find(r=>r.email===user.email).token;
  assert.equal((await request('/api/v1/auth/reset-password',{method:'POST',body:{token,newPassword:'Changed-password-123!'}})).status,204);
  assert.equal((await request('/api/v1/auth/reset-password',{method:'POST',body:{token,newPassword:'Changed-password-123!'}})).status,400);
});
test('explicit RLS deny policies still block browsers even if table grants are accidentally added', async () => {
  await db.exec('reset role; begin; grant select,insert on wp_auth_users to anon; set local role anon;');
  try {
    assert.equal((await db.query('select * from wp_auth_users')).rows.length,0);
    await assert.rejects(db.query('insert into wp_auth_users(id,email,password_hash,role) values($1,$2,$3,$4)',
      [randomUUID(),'denied@example.test',hash,'A']));
  } finally { await db.exec('rollback; set role service_role;'); }
});
test('migration refuses duplicate objects without altering existing account data', async () => {
  const count=(await db.query('select count(*) from wp_auth_users')).rows[0].count;
  await db.exec('reset role');
  try {
    await assert.rejects(db.exec(await readFile(new URL('../migrations/001_auth.proposed.sql',import.meta.url),'utf8')));
  } finally { await db.exec('rollback; set role service_role;'); }
  assert.equal((await db.query('select count(*) from wp_auth_users')).rows[0].count,count);
});
test('missing schema fails closed with a safe storage error', async () => {
  const missing=createAuthRepository({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({error:{code:'PGRST205',message:'private details'}})})})})});
  await assert.rejects(missing.getUser(randomUUID()),{status:503,message:'Authentication storage unavailable'});
});
test('credential rate limiter returns safe 429 JSON', async () => {
  let response;
  for(let i=0;i<21;i++) response=await request('/api/v1/auth/login',{method:'POST',body:{}});
  assert.equal(response.status,429); assert.ok((await response.json()).error.message.includes('Too many'));
});
