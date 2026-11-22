import {uuid,timezone as validateTimezone} from '../middleware/core-validation.js';
import {date as validateDate} from '../validators/report-filters.js';
import {ApiError} from '../utils/api-error.js';

// Internal service for trusted backend/CLI callers; no undocumented public report endpoint.
export function createDailySummaryService({repository,config}){
  return {
    async recalculate(employeeId,date,timezone=config.timezone){
      const result=await repository.recalculate(uuid(employeeId),validateDate(date),validateTimezone(timezone),true);
      if(result.state==='failed')throw new ApiError(503,'Daily summary calculation failed; job retained for retry');
      return result.summary;
    },
    async runScheduled(){
      const queued=await repository.enqueue(config);
      const processed=await repository.process(config);
      return {...queued,...processed};
    },
  };
}
