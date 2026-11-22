import {required,text,uuid,nullableUuid,boolean,choice,email,filters} from '../middleware/core-validation.js';
import {ApiError} from '../utils/api-error.js';

export const idParams={id:required(uuid)};
export const employeeFields={firstName:text(100,1),lastName:text(100,1),phone:text(32),employeeCode:text(64,1),email,
  role:choice('A','M','E'),departmentId:nullableUuid};
export const departmentFields={name:text(100,1),description:text(2000),managerId:nullableUuid,active:boolean};
export const employeeFilters={...filters,departmentId:uuid,role:choice('A','M','E')};
export const passwordValue=value=>{
  if(typeof value!=='string'||Buffer.byteLength(value)>72)throw new ApiError(400,'Invalid password');return value;
};
export const deviceCredential=value=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw new ApiError(400,'Invalid device credential');return value;
};
export const employeeCreate={...employeeFields,firstName:required(employeeFields.firstName),lastName:required(employeeFields.lastName),
  email:required(email),password:required(passwordValue),temporary:boolean};
export const deviceRegistration={name:required(text(100,1)),platform:required(text(100,1)),deviceCredential:required(deviceCredential)};
