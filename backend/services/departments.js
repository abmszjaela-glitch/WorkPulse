import { randomUUID } from 'node:crypto';
import { ApiError } from '../utils/api-error.js';

export function createDepartmentService({ repository, metrics = null }) {
  const get = async (actor, id) => (await repository.departments(actor, { id })).items[0];
  return {
    list: (actor, options) => repository.departments(actor, options), get,
    create: (actor, data) => repository.departmentWrite(actor, 'create', randomUUID(), data),
    write: (actor, action, id, data) => repository.departmentWrite(actor, action, id, data),
    async employees(actor, id, options) { await get(actor,id); return repository.employees(actor,{...options,departmentId:id}); },
    async productivity(actor, id, options) {
      if (options.from && options.to && options.from > options.to) throw new ApiError(400, 'Invalid date range');
      await get(actor,id);
      if (!metrics) throw new ApiError(503, 'Department productivity requires an approved activity telemetry source');
      return metrics.forDepartment(actor,id,options);
    },
  };
}
