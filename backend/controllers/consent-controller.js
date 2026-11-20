export const createConsentController = (service) => ({
  policy: async (req, res) => res.json(await service.policy(req.auth)),
  accept: async (req, res) => res.json(await service.accept(req.auth, req.input.body)),
  status: async (req, res) => res.json(await service.status(req.auth, req.input.params.employeeId)),
  updatePolicy: async (req, res) => res.status(201).json(await service.updatePolicy(req.auth, req.input.body)),
});
