import{test,before,after}from'node:test';
import assert from'node:assert/strict';
import{readFile,writeFile,mkdir}from'node:fs/promises';
import{randomUUID,randomBytes}from'node:crypto';
import express from'express';
import{PGlite}from'@electric-sql/pglite';
import{postgresClient}from'./postgres-client.js';
import{createAuthService}from'../services/auth-service.js';
import{createAuthRepository}from'../services/auth-repository.js';
import{hashPassword}from'../services/passwords.js';
import{createReportService}from'../services/reports.js';
import{createReportRouter,reportEndpoints}from'../routes/reports.js';
import{errorHandler}from'../middleware/error-handler.js';
const db=new PGlite(),client=postgresClient(db),config={maxCsvRows:10000,maxPdfRows:2000,fontPath:null};
const auth=createAuthService({repository:createAuthRepository(client),mailer:{},config:{secret:randomBytes(48).toString('hex'),issuer:'test',userAudience:'users',agentAudience:'devices',accessSeconds:900,refreshSeconds:86400,bcryptRounds:10}});
const service=createReportService({client,timezone:'UTC',config});let A,M,E,O,D,dept,hash,server,base;
const day=new Date(Date.now()-86400000).toISOString().slice(0,10),examples=[];
async function seed(role){const id=randomUUID(),email=id+'@example.test';await db.query('insert into wp_auth_users(id,email,password_hash,role) values($1,$2,$3,$4)',[id,email,hash,role]);
  await db.query('update wp_employee_profiles set first_name=$1,last_name=$2 where user_id=$3',['Synthetic','Employee',id]);
  const session=await auth.login(email,'Synthetic-password-123!');return{id,token:session.accessToken,context:await auth.authenticate(session.accessToken)};}
async function get(path,actor=A){return fetch(base+'/api/v1/reports'+path,{headers:actor?{Authorization:'Bearer '+actor.token}:{}});}
const period=path=>path+(path.includes('?')?'&':'?')+`from=${day}&to=${day}&timezone=UTC`;
before(async()=>{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const n of ['001_auth','002_core_management','003_monitoring','004_processing','005_analytics','006_reports'])await db.exec(await readFile(new URL('../migrations/'+n+'.proposed.sql',import.meta.url),'utf8'));
  await db.exec('set role service_role');hash=await hashPassword('Synthetic-password-123!',10);A=await seed('A');M=await seed('M');E=await seed('E');O=await seed('E');dept=randomUUID();
  await db.query('insert into wp_departments(id,name,manager_id) values($1,$2,$3)',[dept,'Synthetic engineering',M.id]);await db.query('update wp_employee_profiles set department_id=$1 where user_id=$2',[dept,E.id]);
  const device=await auth.provisionDevice(A.context,E.id);await db.query('update wp_auth_devices set registered_at=now(),last_seen=now() where id=$1',[device.deviceId]);D={token:(await auth.loginDevice(device.deviceId,device.credential)).accessToken};
  const rid=randomUUID();await db.query('insert into wp_activity_intervals(device_id,record_id,employee_id,interval_start,interval_end,interval_seconds,active_seconds,idle_seconds,mouse_movements,mouse_clicks,key_presses,summary,content_hash) values($1,$2,$3,$4,$5,60,50,10,1,1,1,$6,$7)',[device.deviceId,rid,E.id,day+'T10:00:00Z',day+'T10:01:00Z','{}','a'.repeat(64)]);
  await db.query('insert into wp_application_usage(device_id,record_id,application_name,duration_seconds) values($1,$2,$3,45)',[device.deviceId,rid,'code.exe']);
  const app=express();app.use('/api/v1',createReportRouter({auth,service}));app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
  await mkdir(new URL('../reports/samples/',import.meta.url),{recursive:true});
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.close();await writeFile(new URL('../reports/phase7-http-examples.json',import.meta.url),JSON.stringify({source:'Observed local HTTP using synthetic database records; no credentials',examples},null,2)+'\n');});
test('all ten endpoints require Admin/Manager and return valid scoped report/export responses',async()=>{
  for(const [template,,action]of reportEndpoints){const path=template.replace(':id',template.includes('department')?dept:E.id);
    assert.equal((await get(path,null)).status,401);assert.equal((await get(path,E)).status,403);assert.equal((await get(path,D)).status,403);
    const response=await get(action==='history'?path:period(path));assert.equal(response.status,200,path+': '+await response.clone().text());
    if(action==='pdf'||action==='csv'){
      const bytes=Buffer.from(await response.arrayBuffer());assert.ok(response.headers.get('content-disposition').includes('attachment'));
      if(action==='pdf'){assert.equal(bytes.subarray(0,4).toString(),'%PDF');await writeFile(new URL('../reports/samples/WorkPulse-report.pdf',import.meta.url),bytes);}
      else{assert.ok(bytes.toString().includes('Monitored seconds'));await writeFile(new URL('../reports/samples/WorkPulse-report.csv',import.meta.url),bytes);}
      examples.push({path,status:200,contentType:response.headers.get('content-type'),bytes:bytes.length});
    }else{const body=await response.json();assert.equal(body.success,true);examples.push({path,status:200,response:body});}
  }
});
test('daily/weekly/monthly periods and report types use actual totals and unavailable business metrics',async()=>{
  const daily=await(await get(period('/daily'))).json();assert.equal(daily.kpis.active_seconds,50);assert.equal(daily.data.find(x=>x.employee_id===E.id).observed_activity_days,1);
  assert.equal(daily.kpis.productivity_score,null);
  const monthly=await(await get('/monthly')).json();assert.ok(monthly.meta.from.endsWith('-01'));
  const apps=await(await get(period('/daily?reportType=application-usage'))).json();assert.equal(apps.data[0].duration_seconds,45);
  const logs=await(await get(period('/weekly?reportType=activity'))).json();assert.equal(logs.data[0].active_seconds,50);
});
test('date, department, employee and pagination filters cannot escape Manager scope',async()=>{
  const scoped=await(await get(period('/weekly'),M)).json();assert.equal(scoped.pagination.total,2);assert.ok(!scoped.data.some(x=>x.employee_id===O.id));
  assert.equal((await get(period('/employee/'+O.id),M)).status,404);
  assert.equal((await get(period('/employee/'+E.id+'?employeeId='+O.id))).status,400);
  const paged=await(await get(period('/daily?pageSize=1&page=2'))).json();assert.equal(paged.data.length,1);assert.equal(paged.pagination.total,4);
  const filtered=await(await get(period('/department/'+dept))).json();assert.equal(filtered.data.length,1);
});
test('CSV escapes formulas, commas and quotes using actual stored employee names',async()=>{
  await db.query('update wp_employee_profiles set first_name=$1,last_name=$2 where user_id=$3',['=HYPERLINK("bad")','Comma,Quote"',E.id]);
  const response=await get(period('/export/csv?employeeId='+E.id));assert.equal(response.status,200);const text=await response.text();assert.ok(text.includes("'=HYPERLINK"));assert.ok(text.includes('Comma,Quote""'));
});
test('export history is owner-only and revalidates current scope',async()=>{
  assert.equal((await(await get('/recent-exports',M)).json()).data.length,0);
  assert.equal((await get(period('/export/csv'),M)).status,200);assert.equal((await(await get('/recent-exports',M)).json()).data.length,1);
  await db.query('update wp_departments set manager_id=$1 where id=$2',[A.id,dept]);assert.equal((await(await get('/recent-exports',M)).json()).data.length,0);
  await db.query('update wp_departments set manager_id=$1 where id=$2',[M.id,dept]);
  const history=(await(await get('/recent-exports')).json()).data;assert.ok(history.length>=2);assert.ok(history.every(x=>x.sha256.length===64));assert.ok(!JSON.stringify(history).includes('employee_ids'));
});
test('empty application reports export valid empty CSV/PDF without invented data',async()=>{
  const path=period('/daily?reportType=application-usage&employeeId='+O.id);assert.equal((await(await get(path)).json()).data.length,0);
  const file=await service.export(A.context,'pdf',{from:day,to:day,employeeId:O.id,reportType:'application-usage'});
  try{assert.equal((await readFile(file.path)).subarray(0,4).toString(),'%PDF');}finally{await file.cleanup();}
});
test('invalid filters, missing records and excessive export limits fail safely',async()=>{
  for(const path of ['/daily?from=bad','/daily?from=2026-11-20&to=2026-11-01','/daily?unknown=1','/daily?pageSize=999'])assert.equal((await get(path)).status,400);
  assert.equal((await get(period('/employee/'+randomUUID()))).status,404);
  const limited=createReportService({client,timezone:'UTC',config:{...config,maxPdfRows:1}});await assert.rejects(limited.export(A.context,'pdf',{from:day,to:day}),{status:413});
});
test('large reports generate multipage PDFs and bounded CSV without truncation',async()=>{
  for(let i=0;i<90;i++){const id=randomUUID();await db.query("insert into wp_auth_users(id,email,password_hash,role) values($1,$2,$3,'E')",[id,`volume-${i}@example.test`,hash]);
    await db.query('update wp_employee_profiles set first_name=$1,last_name=$2 where user_id=$3',['Synthetic volume employee',String(i+1),id]);}
  const response=await get(period('/export/pdf'));assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
  assert.ok((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>1);
  await writeFile(new URL('../reports/samples/WorkPulse-large-report.pdf',import.meta.url),bytes);
  const rows=await(await get(period('/daily'))).json();assert.equal(rows.pagination.total,94);
});
test('database and history failures never claim successful exports',async()=>{
  const bad=createReportService({client:{rpc:async()=>({error:{code:'PGRST205',message:'private details'}})},timezone:'UTC',config});
  await assert.rejects(bad.query(A.context,'daily',{from:day,to:day}),{status:503,message:'Reporting storage unavailable'});
  await db.exec('reset role;set role anon');try{await assert.rejects(db.query('select * from wp_report_exports'));}finally{await db.exec('reset role;set role service_role');}
});
