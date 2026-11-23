import { csv } from '../utils/csv.js';

export const createDepartmentController = (service) => ({
  list: async (req, res) => res.json(await service.list(req.auth, req.input.query)),
  get: async (req, res) => res.json(await service.get(req.auth, req.input.params.id)),
  create: async (req, res) => res.status(201).json(await service.create(req.auth, req.input.body)),
  update: async (req, res) => res.json(await service.write(req.auth, 'update', req.input.params.id, req.input.body)),
  remove: async (req, res) => {
    await service.write(req.auth, 'delete', req.input.params.id, req.input.body);
    res.status(204).end();
  },
  employees: async (req, res) => res.json(await service.employees(req.auth, req.input.params.id, req.input.query)),
  productivity: async (req, res) => res.json(await service.productivity(req.auth, req.input.params.id, req.input.query)),
  exportCsv: async (req, res) => {
    const result = await service.list(req.auth, { ...req.input.query, export: true });
    res.type('text/csv').attachment('departments.csv').send(csv(result.items, [
      ['Name', 'name'], ['Description', 'description'], ['Employees', 'employee_count'], ['Active accounts', 'active_accounts'],
    ]));
  },
});
