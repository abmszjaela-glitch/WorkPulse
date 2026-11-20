import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateCore, required, text, uuid, nullableUuid, boolean, choice, email, ids, timezone,
  integer, pagination, filters } from '../middleware/core-validation.js';
import { ApiError } from '../utils/api-error.js';
import { createEmployeeController } from '../controllers/employee-controller.js';
import { createDepartmentController } from '../controllers/department-controller.js';
import { createDeviceController } from '../controllers/device-controller.js';
import { createProfileController } from '../controllers/profile-controller.js';
import { createConsentController } from '../controllers/consent-controller.js';

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

export function createCoreRouter({ auth, employees, departments, devices, profile, consent }) {
  const root = Router();
  const employeeController = createEmployeeController(employees);
  const departmentController = createDepartmentController(departments);
  const deviceController = createDeviceController(devices);
  const profileController = createProfileController(profile);
  const consentController = createConsentController(consent);
  const secure = () => {
    const router=Router();
    router.use(authenticate(auth),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
    return router;
  };
  const employee=secure();
  employee.get('/summary',readManagement(),validate(),employeeController.summary);
  employee.get('/export',readManagement(),validate({},listFilters),employeeController.exportCsv);
  employee.post('/bulk-deactivate',admin(),validate({ids:required(ids)}),employeeController.bulkDeactivate);
  employee.get('/',readManagement(),validate({},listFilters),employeeController.list);
  employee.post('/',admin(),validate({...employeeFields,firstName:required(employeeFields.firstName),lastName:required(employeeFields.lastName),
    email:required(email),password:required(password),temporary:boolean}),employeeController.create);
  employee.post('/:id/reset-password',admin(),limit(10),validate({},{},id),employeeController.resetPassword);
  employee.patch('/:id/status',admin(),validate({active:required(boolean)},{},id),employeeController.setStatus);
  employee.patch('/:id/department',admin(),validate({departmentId:required(nullableUuid)},{},id),employeeController.setDepartment);
  employee.get('/:id',readManagement(),validate({},{},id),employeeController.get);
  employee.put('/:id',admin(),validate(employeeFields,{},id,true),employeeController.update);
  employee.delete('/:id',admin(),validate({},{},id),employeeController.remove);
  root.use('/employees',employee);

  const department=secure();
  department.get('/export',admin(),validate({},filters),departmentController.exportCsv);
  department.get('/',readManagement(),validate({},filters),departmentController.list);
  department.post('/',admin(),validate({...departmentFields,name:required(departmentFields.name)}),departmentController.create);
  department.get('/:id/employees',readManagement(),validate({},listFilters,id),departmentController.employees);
  department.get('/:id/productivity',readManagement(),validate({},{from:date,to:date},id),departmentController.productivity);
  department.get('/:id',readManagement(),validate({},{},id),departmentController.get);
  department.put('/:id',admin(),validate(departmentFields,{},id,true),departmentController.update);
  department.delete('/:id',admin(),validate({reassignToDepartmentId:uuid},{},id),departmentController.remove);
  root.use('/departments',department);

  const device=secure();
  device.post('/register',agent(),limit(20),validate({name:required(text(100,1)),platform:required(text(100,1)),deviceCredential:required(value=>{
    if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw new ApiError(400,'Invalid device credential');return value;
  })}),deviceController.register);
  device.post('/heartbeat',agent(),validate(),deviceController.heartbeat);
  device.get('/agent-config',agent(),validate(),deviceController.agentConfig);
  device.get('/',readManagement(),validate({},{...pagination,employeeId:uuid,status:choice('active','inactive')}),deviceController.list);
  device.get('/:id',readManagement(),validate({},{},id),deviceController.get);
  device.patch('/:id/status',admin(),validate({active:required(boolean)},{},id),deviceController.setStatus);
  device.delete('/:id',admin(),validate({},{},id),deviceController.remove);
  root.use('/devices',device);

  const own=secure();own.use(human());
  own.get('/',validate(),profileController.get);
  own.put('/',validate({firstName:text(100,1),lastName:text(100,1),phone:text(32),language:text(35,1),timezone},{},{},true),
    profileController.update);
  own.post('/avatar',limit(20),validate({imageBase64:required(text(350000,1))}),profileController.avatar);
  own.get('/login-history',validate({},pagination),profileController.loginHistory);
  own.get('/notification-preferences',validate(),profileController.getPreferences);
  own.put('/notification-preferences',validate({emailDailySummary:boolean,idleAlerts:boolean,emailWeeklyReport:boolean},{},{},true),
    profileController.updatePreferences);
  own.post('/logout-all',validate(),profileController.logoutAll);
  root.use('/profile',own);

  const privacy=secure();
  privacy.get('/policy',authorize('A','M','E','Agent'),validate(),consentController.policy);
  privacy.post('/accept',authorize('E','Agent'),validate({policyVersion:required(integer(1,2147483647))}),consentController.accept);
  privacy.get('/status/:employeeId',admin(),validate({},{},{employeeId:required(uuid)}),consentController.status);
  privacy.put('/policy',admin(),validate({content:required(text(50000,1))}),consentController.updatePolicy);
  root.use('/consent',privacy);
  return root;
}
