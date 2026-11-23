import {ApiError} from '../utils/api-error.js';
import isUUID from 'validator/lib/isUUID.js';
import {validateMonitoringRecord} from '../services/monitoring-validation.js';

export const validateActivity=validateMonitoringRecord;
export const validateApplicationUsage=validateMonitoringRecord;
export function validateMonitoringBatch(input,actor,config){
  if(!Array.isArray(input)||!input.length)throw new ApiError(400,'A non-empty array of queue records is required');
  if(input.length>config.maxBatchSize)throw new ApiError(413,'Batch exceeds configured record limit');
  const valid=[],results=[];
  input.forEach((value,index)=>{
    try{valid.push({index,record:validateActivity(value,actor,config)});}
    catch(error){if(!(error instanceof ApiError))throw error;
      results.push({index,record_id:typeof value?.record_id==='string'&&isUUID(value.record_id)?value.record_id.toLowerCase():null,
        status:'rejected',http_status:error.status,error:{message:error.safeMessage}});}
  });
  return {valid,results};
}
