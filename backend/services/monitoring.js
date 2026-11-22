import { randomUUID } from 'node:crypto';
import isUUID from 'validator/lib/isUUID.js';
import { ApiError } from '../utils/api-error.js';
import { validateMonitoringBatch } from '../validators/monitoring.js';

export function createMonitoringService({repository,config}) {
  async function upload(actor,kind,values) {
    const {valid,results}=validateMonitoringBatch(values,actor,config);
    // No acknowledgment is constructed before the database transaction commits.
    if(valid.length)results.push(...await repository.batch(actor,kind,valid,config));
    results.sort((a,b)=>a.index-b.index);
    return {acknowledged_record_ids:[...new Set(results.filter(item=>['accepted','duplicate'].includes(item.status)).map(item=>item.record_id))],results};
  }
  return {
    assertDevice:actor=>repository.authorize(actor),
    async single(actor,kind,input) {
      const result=await upload(actor,kind,[input]);const item=result.results[0];
      if(item.status==='rejected')throw new ApiError(item.http_status,item.error.message);
      return {httpStatus:item.status==='accepted'?201:200,body:result};
    },
    async batch(actor,kind,input) {
      if(!Array.isArray(input)||!input.length)throw new ApiError(400,'A non-empty array of queue records is required');
      if(input.length>config.maxBatchSize)throw new ApiError(413,'Batch exceeds configured record limit');
      const body=await upload(actor,kind,input);
      return {httpStatus:body.results.some(item=>item.status==='rejected')?207:200,body};
    },
    async status(actor,input,idempotencyKey) {
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1
        ||!['ACTIVE','IDLE','PAUSED','OFFLINE'].includes(input.status))throw new ApiError(400,'Provide only a valid status');
      if(idempotencyKey!==undefined&&(typeof idempotencyKey!=='string'||!isUUID(idempotencyKey)))throw new ApiError(400,'Idempotency-Key must be a UUID');
      return repository.status(actor,input.status,idempotencyKey?.toLowerCase()||randomUUID(),config);
    },
  };
}
