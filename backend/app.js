import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { corsOrigin } from './config/environment.js';
import { notFound, errorHandler } from './middleware/error-handler.js';
import { createAuthRouter } from './routes/auth.js';
import { createConfiguredAuthService } from './config/auth-runtime.js';
import { ApiError } from './utils/api-error.js';
import { createCoreRouter } from './routes/core.js';
import { createConfiguredCore } from './config/core-runtime.js';
import { createMonitoringRouter } from './routes/monitoring.js';
import { createConfiguredMonitoring } from './config/monitoring-runtime.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: corsOrigin }));
// Log paths without query strings, request bodies or authorization headers.
morgan.token('safe-path', (req) => req.path);
app.use(morgan(':method :safe-path :status :response-time ms'));
app.use(express.json({ limit: '1mb' }));

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
// Keep health available during initial deployment; auth always fails closed until configured.
let authService;
try { authService = createConfiguredAuthService(); } catch {
  console.error('Authentication unavailable: configure the signing secret and server-only Supabase key');
}
app.use('/api/v1/auth', authService ? createAuthRouter(authService) : (req, res, next) => {
  next(new ApiError(503, 'Authentication is not configured'));
});
if (authService) {
  app.use('/api/v1',createCoreRouter(createConfiguredCore(authService)));
  app.use('/api/v1',createMonitoringRouter(createConfiguredMonitoring(authService)));
} else {
  for (const resource of ['employees','departments','devices','profile','consent','activity','app-usage','status']) {
    app.use(`/api/v1/${resource}`,(req,res,next)=>next(new ApiError(503,'Authentication is not configured')));
  }
}
app.use(notFound);
app.use(errorHandler);

export default app;
