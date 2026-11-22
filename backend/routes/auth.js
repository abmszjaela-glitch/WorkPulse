import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createAuthController } from '../controllers/auth-controller.js';
import { authenticate } from '../middleware/auth.js';
import {loginValidators,refreshValidators,forgotPasswordValidators,resetPasswordValidators,changePasswordValidators} from '../validators/auth.js';

export function createAuthRouter(service) {
  const router = Router();
  const controller = createAuthController(service);
  const requireAuth = authenticate(service);
  // Single-instance limiters; use a shared store before running multiple API replicas.
  const limit = (max) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { message: 'Too many authentication requests; try again later' } } });
  const credentialsLimit = limit(20);
  const recoveryLimit = limit(5);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/login', credentialsLimit, ...loginValidators(), controller.login);
  router.post('/logout', requireAuth, controller.logout);
  router.post('/refresh', limit(60), ...refreshValidators(), controller.refresh);
  router.get('/me', requireAuth, controller.me);
  router.post('/forgot-password', recoveryLimit, ...forgotPasswordValidators(), controller.forgotPassword);
  router.post('/reset-password', recoveryLimit, ...resetPasswordValidators(), controller.resetPassword);
  router.put('/change-password', credentialsLimit, requireAuth, ...changePasswordValidators(), controller.changePassword);
  return router;
}
