import {createServer} from 'node:http';
import {attachRealtime} from './services/realtime.js';
import {logFailure} from './utils/server-logger.js';
import {ConfigurationError} from './config/configuration-error.js';
import {createSummaryWorker} from './services/summary-worker.js';

async function start(){
  const {default:app,authService,systemRepository,systemConfig}=await import('./app.js');
  const {port}=await import('./config/environment.js');
  const {createConfiguredProcessing}=await import('./config/processing-runtime.js');
  const processing=createConfiguredProcessing();
  const worker=createSummaryWorker({service:processing.summaries,config:processing.config});
  const server=createServer(app);
  const realtime=attachRealtime(server,{auth:authService,repository:systemRepository,config:systemConfig});
  server.listen(port, () => {console.log('Authentication initialized successfully');console.log(`WorkPulse API listening on port ${port}`);worker.start();realtime.start();});
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? 'Configured port is already in use' : 'API server failed to start');
    process.exitCode = 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {await worker.stop();await realtime.stop();server.close(() => process.exit(0));});
  }
}

start().catch(error=>{
  if(error instanceof ConfigurationError)console.error(`Startup configuration error: ${error.message}`);
  else logFailure('server.startup.failed',error);
  process.exitCode=1;
});

// Unexpected failures are logged without exception text; terminate so a process
// supervisor can restart a clean instance rather than continue in unknown state.
process.once('uncaughtException',error=>{logFailure('server.uncaught-exception',error);process.exit(1);});
process.once('unhandledRejection',error=>{logFailure('server.unhandled-rejection',error);process.exit(1);});
