import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { corsOrigin } from './config/environment.js';
import { notFound, errorHandler } from './middleware/error-handler.js';

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
app.use(notFound);
app.use(errorHandler);

export default app;
