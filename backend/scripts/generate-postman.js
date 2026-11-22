import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),manifest=JSON.parse(await readFile(new URL('reports/api-document-manifest.json',root),'utf8'));
const folder=new URL('postman/',root);await mkdir(folder,{recursive:true});
const schedule=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day,i)=>({day,enabled:i<5,start:'09:00',end:'17:30'}));
const record={record_id:'{{recordId}}',employee_id:'{{employeeId}}',interval_start:'{{intervalStart}}',interval_end:'{{intervalEnd}}',summary:{interval_seconds:60,active_seconds:50,idle_seconds:10,counts:{mouse_movements:120,mouse_clicks:3,key_presses:44},application_usage_seconds:{'code.exe':45},status:'ACTIVE'}};
function body(e){const key=e.method+' '+e.path;const map={
 'POST /auth/login':{email:'{{loginEmail}}',password:'{{loginPassword}}'},'POST /auth/refresh':{refreshToken:'{{refreshToken}}'},
 'POST /auth/forgot-password':{email:'{{loginEmail}}'},'POST /auth/reset-password':{token:'{{resetToken}}',newPassword:'{{newPassword}}'},'PUT /auth/change-password':{currentPassword:'{{loginPassword}}',newPassword:'{{newPassword}}'},
 'POST /employees':{firstName:'Synthetic',lastName:'Employee',email:'{{newEmployeeEmail}}',password:'{{newPassword}}',temporary:false,role:'E',departmentId:'{{departmentId}}'},
 'PUT /employees/:id':{firstName:'Updated',lastName:'Employee'},'PATCH /employees/:id/status':{active:false},'PATCH /employees/:id/department':{departmentId:'{{departmentId}}'},'POST /employees/bulk-deactivate':{ids:['{{employeeId}}']},
 'PUT /profile':{firstName:'Synthetic',lastName:'User',phone:'',language:'en',timezone:'Asia/Colombo'},'POST /profile/avatar':{imageBase64:'{{avatarBase64}}'},'PUT /profile/notification-preferences':{emailDailySummary:false,idleAlerts:true,emailWeeklyReport:false},
 'POST /departments':{name:'Synthetic Engineering',description:'Test department',managerId:'{{managerId}}'},'PUT /departments/:id':{description:'Updated test description'},'DELETE /departments/:id':{reassignToDepartmentId:'{{reassignDepartmentId}}'},
 'POST /devices/register':{name:'WorkPulse test device',platform:'Windows 11',deviceCredential:'{{deviceCredential}}'},'PATCH /devices/:id/status':{active:false},
 'POST /consent/accept':{policyVersion:1},'PUT /consent/policy':{content:'Review and supply the actual approved employee privacy notice.'},
 'POST /activity':record,'POST /activity/batch':[record],'POST /app-usage':record,'POST /app-usage/batch':[record],'POST /status':{status:'PAUSED'},
 'POST /app-categories':{applicationName:'code.exe',category:'Productive'},'PUT /app-categories/:id':{category:'Neutral'},
 'PUT /settings/monitoring':{idleMinutes:5,evaluationSeconds:60,syncMinutes:5,offlineDays:7,trackApplications:true,trackKeyboardCounts:true,trackMouseCounts:true,pauseOutsideHours:true},
 'PUT /settings/working-hours':{timezone:'Asia/Colombo',schedule},'PUT /settings/data-retention':{retentionDays:90,requireConsent:true},'PUT /settings/notifications':{notifyIdle:true,notifyAgentOffline:true,weeklyDigest:false},
 };return map[key];}
const token=roles=>roles.includes('Public')?null:roles==='Agent'?'agentToken':roles.startsWith('E')?'employeeToken':'adminToken';
const items=new Map();for(const e of manifest.endpoints){
 const group=items.get(e.section)||[];items.set(e.section,group);
 const id=e.path.startsWith('/departments')?'departmentId':e.path.startsWith('/devices')?'deviceId':e.path.startsWith('/notifications')?'notificationId':e.path.startsWith('/app-categories')?'categoryId':'employeeId';
 const path=e.path.replace(':id','{{'+id+'}}').replace(':employeeId','{{employeeId}}');const value=body(e),t=token(e.roles);
 const req={method:e.method,header:[],url:'{{baseUrl}}'+path,description:`Document role: ${e.roles}. ${e.purpose}\nUses real stored data; identifiers must reference disposable fixtures. Destructive writes must be run only in an isolated test environment. See README.md for filters, expected results and role tests.`};
 if(t)req.auth={type:'bearer',bearer:[{key:'token',value:'{{'+t+'}}',type:'string'}]};else req.auth={type:'noauth'};
 if(value!==undefined){req.header.push({key:'Content-Type',value:'application/json'});req.body={mode:'raw',raw:JSON.stringify(value,null,2),options:{raw:{language:'json'}}};}
 if(e.path==='/status')req.header.push({key:'Idempotency-Key',value:'{{recordId}}'});
 const request={name:e.method+' '+e.path,request:req,response:[],event:[{listen:'test',script:{type:'text/javascript',exec:["pm.test('No unexpected server failure', () => pm.expect(pm.response.code).to.be.below(500));","pm.test('Errors use safe API contract', () => { if (pm.response.code >= 400 && pm.response.code !== 429) { const b = pm.response.json(); pm.expect(b.error.message).to.be.a('string'); } });"]}}]};
 if(t&&e.path!=='/auth/refresh')request.response.push({name:'Missing Bearer token – expected contract',originalRequest:{...req,auth:{type:'noauth'}},status:'Unauthorized',code:401,header:[{key:'Content-Type',value:'application/json'}],body:JSON.stringify({error:{message:'Bearer access token required'}},null,2)});
 if(e.path.startsWith('/activity')&&e.method==='POST'||e.path.startsWith('/app-usage')&&e.method==='POST')request.event.unshift({listen:'prerequest',script:{type:'text/javascript',exec:["const end = new Date(); pm.variables.set('intervalEnd', end.toISOString()); pm.variables.set('intervalStart', new Date(end.getTime() - 60000).toISOString()); pm.variables.set('recordId', pm.variables.replaceIn('{{$guid}}')); "]}});
 group.push(request);
}
const roleExamples=['adminToken','managerToken','employeeToken','agentToken'].map(t=>({name:`${t}: GET /settings (${t==='adminToken'?'200':'403'})`,request:{method:'GET',header:[],url:'{{baseUrl}}/settings',auth:{type:'bearer',bearer:[{key:'token',value:'{{'+t+'}}',type:'string'}]}},event:[{listen:'test',script:{type:'text/javascript',exec:[`pm.test('Role permission',()=>pm.response.to.have.status(${t==='adminToken'?200:403}));`]}}]}));
const examples=JSON.parse(await readFile(new URL('reports/phase6-http-examples.json',root),'utf8'));
// Observed, sanitized previous integration responses; no invented live statistics.
for(const entry of examples.examples||[]){const found=[...items.values()].flat().find(x=>entry.path?.startsWith(x.request.url.replace('{{baseUrl}}','')));if(found&&entry.response)found.response.push({name:'Observed isolated PostgreSQL fixture response',originalRequest:found.request,status:'OK',code:200,header:[{key:'Content-Type',value:'application/json'}],body:JSON.stringify(entry.response,null,2)});}
const collection={info:{name:'WorkPulse Backend – all 99 documented endpoints',schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',description:'Review-only fixtures, no real credentials. Do not run the entire collection against production: it includes destructive management endpoints. Auth/SMTP/installer configuration can intentionally produce 503 until configured.'},item:[...[...items].map(([name,item])=>({name,item})),{name:'RBAC examples – isolated fixtures only',item:roleExamples}],variable:[{key:'baseUrl',value:'http://localhost:5000/api/v1'}]};
const values={baseUrl:'http://localhost:5000/api/v1',adminToken:'',managerToken:'',employeeToken:'',agentToken:'',loginEmail:'',loginPassword:'',newPassword:'',refreshToken:'',resetToken:'',newEmployeeEmail:'synthetic@example.test',employeeId:'',managerId:'',departmentId:'',reassignDepartmentId:'',deviceId:'',deviceCredential:'',notificationId:'',categoryId:'',avatarBase64:'',recordId:'',intervalStart:'',intervalEnd:''};
await writeFile(new URL('WorkPulse.postman_collection.json',folder),JSON.stringify(collection,null,2)+'\n');
await writeFile(new URL('WorkPulse.postman_environment.json',folder),JSON.stringify({name:'WorkPulse local template',_postman_variable_scope:'environment',values:Object.entries(values).map(([key,value])=>({key,value,enabled:true,type:/Token|Password|Credential/.test(key)?'secret':'default'}))},null,2)+'\n');
console.log(`Generated ${manifest.endpoints.length} API requests + 4 role examples`);
