export const createProfileController = (service) => ({
  get: async (req, res) => res.json(await service.run(req.auth, 'get')),
  update: async (req, res) => res.json(await service.run(req.auth, 'update', req.input.body)),
  avatar: async (req, res) => res.json(await service.avatar(req.auth, req.input.body.imageBase64)),
  loginHistory: async (req, res) => res.json(await service.run(req.auth, 'login-history', req.input.query)),
  getPreferences: async (req, res) => res.json(await service.run(req.auth, 'preferences')),
  updatePreferences: async (req, res) => res.json(await service.run(req.auth, 'preferences-update', req.input.body)),
  logoutAll: async (req, res) => {
    await service.run(req.auth, 'logout-all');
    res.status(204).end();
  },
});
