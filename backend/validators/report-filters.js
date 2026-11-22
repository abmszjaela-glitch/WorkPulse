import {pagination,uuid,timezone,choice} from '../middleware/core-validation.js';
import {ApiError} from '../utils/api-error.js';

export const date=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))
    ||new Date(value).toISOString().slice(0,10)!==value)throw new ApiError(400,'Invalid date');return value;
};
export const reportFilters={...pagination,from:date,to:date,employeeId:uuid,departmentId:uuid,timezone,
  reportType:choice('summary','activity','application-usage')};
export function validateDateRange(req,res,next){
  const {from,to}=req.input.query;
  if(from&&to&&(from>to||(Date.parse(to)-Date.parse(from))/86400000>366))throw new ApiError(400,'Invalid or excessive date range');
  next();
}
