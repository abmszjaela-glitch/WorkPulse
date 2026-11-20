import app from './app.js';
import { port } from './config/environment.js';
import './config/supabase.js';

const server = app.listen(port, () => console.log(`WorkPulse API listening on port ${port}`));
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? 'Configured port is already in use' : 'API server failed to start');
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
