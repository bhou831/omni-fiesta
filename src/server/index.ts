import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be a valid TCP port.');
const server = createApp({
  databasePath: process.env.DATABASE_PATH ?? './data/party.sqlite',
  hostPassword: process.env.HOST_PASSWORD ?? '',
  enableRehearsal: process.env.ENABLE_REHEARSAL === 'true',
  publicOrigin: process.env.PUBLIC_ORIGIN,
  production: process.env.NODE_ENV === 'production',
});
const closeFrontend = await server.attachFrontend();
await server.listen(port, process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
console.log(`Omni Fiesta is ready at http://localhost:${port}. Host view: /host`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await closeFrontend?.();
  await server.close();
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
