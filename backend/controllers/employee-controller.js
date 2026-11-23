import { csv } from '../utils/csv.js';

export const createEmployeeController = (service) => ({
  list: async (req, res) => res.json(await service.list(req.auth, req.input.query)),
  get: async (req, res) => res.json(await service.get(req.auth, req.input.params.id)),
  create: async (req, res) => res.status(201).json(await service.create(req.auth, req.input.body)),
  update: async (req, res) => res.json(await service.write(req.auth, 'update', req.input.params.id, req.input.body)),
  setStatus: async (req, res) => res.json(await service.write(req.auth, 'status', req.input.params.id, req.input.body)),
  setDepartment: async (req, res) => res.json(await service.write(req.auth, 'department', req.input.params.id, req.input.body)),
  bulkDeactivate: async (req, res) => res.json(await service.write(req.auth, 'bulk-deactivate', null, req.input.body)),
  resetPassword: async (req, res) => res.json(await service.resetPassword(req.auth, req.input.params.id)),
  remove: async (req, res) => {
    await service.write(req.auth, 'delete', req.input.params.id, {});
    res.status(204).end();
  },
  summary: async (req, res) => res.json(await service.summary(req.auth)),
  exportCsv: async (req, res) => {
    const result = await service.list(req.auth, { ...req.input.query, export: true });
    res.type('text/csv').attachment('employees.csv').send(csv(result.items, [
      ['Employee ID', 'employee_code'], ['First name', 'first_name'], ['Last name', 'last_name'],
      ['Email', 'email'], ['Role', 'role'], ['Department', 'department_name'], ['Active', 'is_active'],
    ]));
  },
});
