/** Isolated, in-memory development harness. Never use for a real party or deployment. */
import { createApp } from '../src/server/app.js';

if (process.env.NODE_ENV === 'production')
  throw new Error('Fixture harness is unavailable in production.');
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const server = createApp({
  databasePath: ':memory:',
  hostPassword: process.env.HOST_PASSWORD ?? 'fixture-test-password',
  enableRehearsal: true,
});
const closeFrontend = await server.attachFrontend();
await server.listen(port, '127.0.0.1');
console.log(
  `Disposable fixture test server: http://127.0.0.1:${port} (use fixture party; data disappears on exit).`,
);
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
