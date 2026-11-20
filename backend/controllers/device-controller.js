export const createDeviceController = (service) => ({
  list: async (req, res) => res.json(await service.list(req.auth, req.input.query)),
  get: async (req, res) => res.json(await service.get(req.auth, req.input.params.id)),
  register: async (req, res) => res.status(201).json(await service.register(req.auth, req.input.body)),
  setStatus: async (req, res) => res.json(await service.write(req.auth, 'status', req.input.params.id, req.input.body)),
  remove: async (req, res) => {
    await service.write(req.auth, 'delete', req.input.params.id, {});
    res.status(204).end();
  },
  heartbeat: async (req, res) => res.json(await service.heartbeat(req.auth)),
  agentConfig: async (req, res) => res.json(await service.agentConfig(req.auth)),
});
