import {required,nullableUuid,choice,pagination,text,uuid} from '../middleware/core-validation.js';
import {processName} from '../services/monitoring-validation.js';

export const categoryFields={applicationName:processName,category:choice('Productive','Neutral','Unproductive'),departmentId:nullableUuid};
export const categoryCreate={...categoryFields,applicationName:required(processName),category:required(categoryFields.category)};
export const categoryFilters={...pagination,search:text(255),departmentId:uuid,category:categoryFields.category};
