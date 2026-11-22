import {createServer} from 'node:http';
import app,{authService,systemRepository,systemConfig} from './app.js';
import {attachRealtime} from './services/realtime.js';
import {logFailure} from './utils/server-logger.js';
import { port } from './config/environment.js';
import './config/supabase.js';
import {createConfiguredProcessing} from './config/processing-runtime.js';
import {createSummaryWorker} from './services/summary-worker.js';

const processing=createConfiguredProcessing();
const worker=createSummaryWorker({service:processing.summaries,config:processing.config});
const server=createServer(app);
const realtime=attachRealtime(server,{auth:authService,repository:systemRepository,config:systemConfig});
server.listen(port, () => {console.log(`WorkPulse API listening on port ${port}`);worker.start();realtime.start();});
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? 'Configured port is already in use' : 'API server failed to start');
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {await worker.stop();await realtime.stop();server.close(() => process.exit(0));});
}

// Unexpected failures are logged without exception text; terminate so a process
// supervisor can restart a clean instance rather than continue in unknown state.
process.once('uncaughtException',error=>{logFailure('server.uncaught-exception',error);process.exit(1);});
process.once('unhandledRejection',error=>{logFailure('server.unhandled-rejection',error);process.exit(1);});
