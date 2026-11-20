import { ApiError } from '../utils/api-error.js';

export function createCoreRepository(client) {
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      if (/^PT(400|401|403|404|409|413)$/.test(error.code)) throw new ApiError(Number(error.code.slice(2)), error.message);
      if (error.code === '23505') throw new ApiError(409, 'Duplicate record');
      if (['23503','23514','22P02','22001'].includes(error.code)) throw new ApiError(400, 'Invalid record fields or relationship');
      throw new ApiError(503, 'Management storage unavailable');
    }
    return data;
  }
  return {
    employees: (actor, options) => rpc('wp_core_employees_read', { p_actor: actor.userId, p_options: options }),
    employeeWrite: (actor, action, id, data) => rpc('wp_core_employee_write', { p_actor: actor.userId, p_action: action, p_id: id, p_data: data }),
    employeeSummary: (actor) => rpc('wp_core_employee_summary', { p_actor: actor.userId }),
    departments: (actor, options) => rpc('wp_core_departments_read', { p_actor: actor.userId, p_options: options }),
    departmentWrite: (actor, action, id, data) => rpc('wp_core_department_write', { p_actor: actor.userId, p_action: action, p_id: id, p_data: data }),
    devices: (actor, action, id = null, data = {}) => rpc('wp_core_devices', { p_actor: actor.userId, p_device: actor.deviceId || null, p_action: action, p_id: id, p_data: data }),
    profile: (actor, action, data = {}) => rpc('wp_core_profile', { p_actor: actor.userId, p_action: action, p_data: data }),
    consent: (actor, action, data = {}) => rpc('wp_core_consent', { p_actor: actor.userId, p_device: actor.deviceId || null, p_action: action, p_data: data }),
  };
}
