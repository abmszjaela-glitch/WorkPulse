import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { corsOrigin } from './config/environment.js';
import { notFound, errorHandler } from './middleware/error-handler.js';
import { createAuthRouter } from './routes/auth.js';
import { createConfiguredAuthService } from './config/auth-runtime.js';
import { createCoreRouter } from './routes/core.js';
import { createConfiguredCore } from './config/core-runtime.js';
import { createMonitoringRouter } from './routes/monitoring.js';
import { createConfiguredMonitoring } from './config/monitoring-runtime.js';
import {createConfiguredProcessing} from './config/processing-runtime.js';
import {createCategoryRouter} from './routes/categories.js';
import {createAnalyticsRouter} from './routes/analytics.js';
import {createAnalyticsService} from './services/analytics.js';
import {createReportService} from './services/reports.js';
import {createReportRouter} from './routes/reports.js';
import supabase from './config/supabase.js';
import {createSystemRouter} from './routes/system.js';
import {createSystemRepository} from './services/system-repository.js';
import {loadSystemConfig} from './config/system.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: corsOrigin }));
// Log paths without query strings, request bodies or authorization headers.
morgan.token('safe-path', (req) => req.route?.path || '[unmatched route]');
app.use(morgan(':method :safe-path :status :response-time ms'));
app.use(express.json({ limit: '1mb' }));

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
// Fail startup before listening if authentication cannot be configured.
export const authService=createConfiguredAuthService();
export const systemConfig=loadSystemConfig();
export const systemRepository=createSystemRepository(supabase);
app.use('/api/v1/auth',createAuthRouter(authService));
  app.use('/api/v1',createSystemRouter({auth:authService,repository:systemRepository,config:systemConfig}));
  app.use('/api/v1',createCoreRouter(createConfiguredCore(authService)));
  app.use('/api/v1',createAnalyticsRouter({auth:authService,service:createAnalyticsService({client:supabase})}));
  app.use('/api/v1',createReportRouter({auth:authService,service:createReportService({client:supabase})}));
  app.use('/api/v1',createMonitoringRouter(createConfiguredMonitoring(authService)));
  app.use('/api/v1',createCategoryRouter({auth:authService,service:createConfiguredProcessing().categories}));
app.use(notFound);
app.use(errorHandler);

export default app;
