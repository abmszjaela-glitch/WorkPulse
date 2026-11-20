// Controllers map the documented endpoint responsibilities to the auth service.
export const createAuthController = (service) => ({
  login: async (req, res) => res.json(await service.login(req.body.email, req.body.password)),
  logout: async (req, res) => { await service.logout(req.auth); res.status(204).end(); },
  refresh: async (req, res) => res.json(await service.refresh(req.body.refreshToken)),
  me: async (req, res) => res.json(await service.me(req.auth)),
  forgotPassword: async (req, res) => {
    await service.forgotPassword(req.body.email);
    res.json({ message: 'If an eligible account exists, password recovery instructions will be sent' });
  },
  resetPassword: async (req, res) => {
    await service.resetPassword(req.body.token, req.body.newPassword);
    res.status(204).end();
  },
  changePassword: async (req, res) => {
    await service.changePassword(req.auth, req.body.currentPassword, req.body.newPassword);
    res.status(204).end();
  },
});
