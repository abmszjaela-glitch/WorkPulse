import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateCore, required, text, uuid, nullableUuid, boolean, choice, email, ids, timezone,
  integer, pagination, filters } from '../middleware/core-validation.js';
import { csv } from '../utils/csv.js';
import { ApiError } from '../utils/api-error.js';

const id = { id: required(uuid) };
const human = () => authorize('A','M','E');
const readManagement = () => authorize('A','M');
const admin = () => authorize('A');
const agent = () => authorize('Agent');
const validate = (body = {}, query = {}, params = {}, nonEmptyBody = false) => validateCore({ body,query,params },{nonEmptyBody});
const employeeFields = { firstName:text(100,1),lastName:text(100,1),phone:text(32),employeeCode:text(64,1),
  email,role:choice('A','M','E'),departmentId:nullableUuid };
const departmentFields = { name:text(100,1),description:text(2000),managerId:nullableUuid,active:boolean };
const listFilters = {...filters,departmentId:uuid,role:choice('A','M','E')};
const date = (value) => {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) throw new ApiError(400,'Invalid date');
  return value;
};
const password = value => {
  if (typeof value!=='string' || Buffer.byteLength(value)>72) throw new ApiError(400,'Invalid password');
  return value;
};
const limit = (max) => rateLimit({windowMs:15*60*1000,limit:max,standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:{message:'Too many sensitive requests; try again later'}}});
const exportCsv = (res,rows,columns,name) => res.type('text/csv').attachment(name).send(csv(rows,columns));

export function createCoreRouter({ auth, repository, employees, departments, devices, profile }) {
  const root = Router();
  const secure = () => {
    const router=Router();
    router.use(authenticate(auth),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
    return router;
  };
  const employee=secure();
  employee.get('/summary',readManagement(),validate(),async(req,res)=>res.json(await employees.summary(req.auth)));
  employee.get('/export',readManagement(),validate({},listFilters),async(req,res)=>{
    const result=await employees.list(req.auth,{...req.input.query,export:true});
    exportCsv(res,result.items,[['Employee ID','employee_code'],['First name','first_name'],['Last name','last_name'],['Email','email'],
      ['Role','role'],['Department','department_name'],['Active','is_active']],'employees.csv');
  });
  employee.post('/bulk-deactivate',admin(),validate({ids:required(ids)}),async(req,res)=>res.json(await employees.write(req.auth,'bulk-deactivate',null,req.input.body)));
  employee.get('/',readManagement(),validate({},listFilters),async(req,res)=>res.json(await employees.list(req.auth,req.input.query)));
  employee.post('/',admin(),validate({...employeeFields,firstName:required(employeeFields.firstName),lastName:required(employeeFields.lastName),
    email:required(email),password:required(password),temporary:boolean}),async(req,res)=>res.status(201).json(await employees.create(req.auth,req.input.body)));
  employee.post('/:id/reset-password',admin(),limit(10),validate({},{},id),async(req,res)=>res.json(await employees.resetPassword(req.auth,req.input.params.id)));
  employee.patch('/:id/status',admin(),validate({active:required(boolean)},{},id),async(req,res)=>res.json(await employees.write(req.auth,'status',req.input.params.id,req.input.body)));
  employee.patch('/:id/department',admin(),validate({departmentId:required(nullableUuid)},{},id),async(req,res)=>res.json(await employees.write(req.auth,'department',req.input.params.id,req.input.body)));
  employee.get('/:id',readManagement(),validate({},{},id),async(req,res)=>res.json(await employees.get(req.auth,req.input.params.id)));
  employee.put('/:id',admin(),validate(employeeFields,{},id,true),async(req,res)=>res.json(await employees.write(req.auth,'update',req.input.params.id,req.input.body)));
  employee.delete('/:id',admin(),validate({},{},id),async(req,res)=>{await employees.write(req.auth,'delete',req.input.params.id,{});res.status(204).end();});
  root.use('/employees',employee);

  const department=secure();
  department.get('/export',admin(),validate({},filters),async(req,res)=>{
    const result=await departments.list(req.auth,{...req.input.query,export:true});
    exportCsv(res,result.items,[['Name','name'],['Description','description'],['Employees','employee_count'],['Active accounts','active_accounts']],'departments.csv');
  });
  department.get('/',readManagement(),validate({},filters),async(req,res)=>res.json(await departments.list(req.auth,req.input.query)));
  department.post('/',admin(),validate({...departmentFields,name:required(departmentFields.name)}),async(req,res)=>res.status(201).json(await departments.create(req.auth,req.input.body)));
  department.get('/:id/employees',readManagement(),validate({},listFilters,id),async(req,res)=>res.json(await departments.employees(req.auth,req.input.params.id,req.input.query)));
  department.get('/:id/productivity',readManagement(),validate({},{from:date,to:date},id),async(req,res)=>{
    const {from,to}=req.input.query;if(from&&to&&from>to)throw new ApiError(400,'Invalid date range');
    res.json(await departments.productivity(req.auth,req.input.params.id,req.input.query));
  });
  department.get('/:id',readManagement(),validate({},{},id),async(req,res)=>res.json(await departments.get(req.auth,req.input.params.id)));
  department.put('/:id',admin(),validate(departmentFields,{},id,true),async(req,res)=>res.json(await departments.write(req.auth,'update',req.input.params.id,req.input.body)));
  department.delete('/:id',admin(),validate({reassignToDepartmentId:uuid},{},id),async(req,res)=>{await departments.write(req.auth,'delete',req.input.params.id,req.input.body);res.status(204).end();});
  root.use('/departments',department);

  const device=secure();
  device.post('/register',agent(),limit(20),validate({name:required(text(100,1)),platform:required(text(100,1)),deviceCredential:required(value=>{
    if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw new ApiError(400,'Invalid device credential');return value;
  })}),async(req,res)=>res.status(201).json(await devices.register(req.auth,req.input.body)));
  device.post('/heartbeat',agent(),validate(),async(req,res)=>res.json(await devices.heartbeat(req.auth)));
  device.get('/agent-config',agent(),validate(),async(req,res)=>res.json(await devices.agentConfig(req.auth)));
  device.get('/',readManagement(),validate({},{...pagination,employeeId:uuid,status:choice('active','inactive')}),async(req,res)=>res.json(await devices.list(req.auth,req.input.query)));
  device.get('/:id',readManagement(),validate({},{},id),async(req,res)=>res.json(await devices.get(req.auth,req.input.params.id)));
  device.patch('/:id/status',admin(),validate({active:required(boolean)},{},id),async(req,res)=>res.json(await devices.write(req.auth,'status',req.input.params.id,req.input.body)));
  device.delete('/:id',admin(),validate({},{},id),async(req,res)=>{await devices.write(req.auth,'delete',req.input.params.id,{});res.status(204).end();});
  root.use('/devices',device);

  const own=secure();own.use(human());
  own.get('/',validate(),async(req,res)=>res.json(await profile.run(req.auth,'get')));
  own.put('/',validate({firstName:text(100,1),lastName:text(100,1),phone:text(32),language:text(35,1),timezone},{},{},true),
    async(req,res)=>res.json(await profile.run(req.auth,'update',req.input.body)));
  own.post('/avatar',limit(20),validate({imageBase64:required(text(350000,1))}),async(req,res)=>res.json(await profile.avatar(req.auth,req.input.body.imageBase64)));
  own.get('/login-history',validate({},pagination),async(req,res)=>res.json(await profile.run(req.auth,'login-history',req.input.query)));
  own.get('/notification-preferences',validate(),async(req,res)=>res.json(await profile.run(req.auth,'preferences')));
  own.put('/notification-preferences',validate({emailDailySummary:boolean,idleAlerts:boolean,emailWeeklyReport:boolean},{},{},true),
    async(req,res)=>res.json(await profile.run(req.auth,'preferences-update',req.input.body)));
  own.post('/logout-all',validate(),async(req,res)=>{await profile.run(req.auth,'logout-all');res.status(204).end();});
  root.use('/profile',own);

  const consent=secure();
  consent.get('/policy',authorize('A','M','E','Agent'),validate(),async(req,res)=>res.json(await repository.consent(req.auth,'policy')));
  consent.post('/accept',authorize('E','Agent'),validate({policyVersion:required(integer(1,2147483647))}),async(req,res)=>res.json(await repository.consent(req.auth,'accept',req.input.body)));
  consent.get('/status/:employeeId',admin(),validate({},{},{employeeId:required(uuid)}),async(req,res)=>res.json(await repository.consent(req.auth,'status',req.input.params)));
  consent.put('/policy',admin(),validate({content:required(text(50000,1))}),async(req,res)=>res.status(201).json(await repository.consent(req.auth,'update',req.input.body)));
  root.use('/consent',consent);
  return root;
}
