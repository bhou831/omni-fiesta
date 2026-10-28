/** Standalone UI preview; never mounted by the application or production server. */
import { createApp } from '../src/server/app.js';
import { hash } from '../src/server/core/store.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from './preview-fixtures.js';

if (process.env.NODE_ENV === 'production')
  throw new Error('Preview server is unavailable in production.');
const aliases: Record<string, string> = {
  stock: 'investments',
  stocks: 'investments',
  slot: 'slots',
  calling: 'somebody-calling',
  review: 'investment-review',
};
const arg = process.argv[2] ?? 'all';
const selected = aliases[arg] ?? arg;
if (selected !== 'all' && !PREVIEW_SCENARIOS.some((s) => s.key === selected))
  throw new Error(`Choose all or: ${PREVIEW_SCENARIOS.map((s) => s.key).join(', ')}`);
const port = Number(process.env.PREVIEW_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PREVIEW_PORT');
// Ignore the configured database/password and prevent live market requests, even if a key is inherited.
const password = 'fixture-preview-password';
const server = createApp({
  databasePath: ':memory:',
  hostPassword: password,
  enableRehearsal: true,
  cookiePrefix: 'of_preview',
  marketProvider: {
    async fetch() {
      throw new Error('Live market requests are disabled in UI previews.');
    },
  },
});
const rooms = new Map<string, Awaited<ReturnType<typeof seedPreviewRoom>>>();
for (const scenario of PREVIEW_SCENARIOS)
  rooms.set(scenario.key, await seedPreviewRoom(server.engine, scenario));
const base = `http://127.0.0.1:${port}`;
const pathFor = (key: string, role: string) => `/preview/open/${key}/${role}`;
server.app.get('/preview/open/:key/:role', (req, res) => {
  const room = rooms.get(req.params.key);
  const role = req.params.role;
  if (!room || !['player', 'host', 'display'].includes(role))
    return res.status(404).send('Preview not found.');
  if (role === 'display') return res.redirect(`/screen?code=${room.code}#${room.displayToken}`);
  const token =
    role === 'host'
      ? server.store.session('host', Date.now(), hash(password))
      : server.store.session('player', Date.now(), null, room.playerId, room.id);
  res.cookie(role === 'host' ? 'of_preview_host' : 'of_preview_player', token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  });
  res.redirect(role === 'host' ? `/host?code=${room.code}` : `/play?code=${room.code}`);
});
server.app.get(['/preview', '/'], (_req, res) => {
  // All labels and paths are from the fixed scenario list; no user HTML is interpolated.
  res.type('html')
    .send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Game previews · Tracy / 10,000 days</title>
  <style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#202020;max-width:900px;margin:40px auto;padding:0 24px}h1{letter-spacing:-.04em}p{color:#666}article{border-top:1px solid #e8e8e5;padding:20px 0}nav{display:flex;gap:24px;flex-wrap:wrap}a{color:inherit;text-underline-offset:4px;padding:8px 0}h2{font-size:20px;margin:0}small{color:#666}.selected{border-left:3px solid;padding-left:20px}code{background:#f7f7f5;padding:2px 6px}</style>
  <h1>Game previews</h1><p>Disposable sample rooms · No live prices or saved party data.</p><p>Open any view directly. Use the host view to close, draw and reveal results. Timers allow 15 minutes for inspection. Restart <code>just preview</code> to reset everything.</p><p>Player sessions are shared between tabs on this server: inspect one sample room at a time, or use separate browser profiles for several rooms.</p>
  ${[...PREVIEW_SCENARIOS]
    .sort((a, b) => Number(b.key === selected) - Number(a.key === selected))
    .map(
      (s) =>
        `<article class="${s.key === selected ? 'selected' : ''}" id="${s.key}"><h2>${s.label}</h2><small>${s.key}</small><nav>${['player', 'host', 'display'].map((role) => `<a href="${pathFor(s.key, role)}" target="_blank" rel="noopener">${role === 'display' ? 'TV display' : role === 'host' ? 'Host controls' : 'Player view'} ↗</a>`).join('')}</nav></article>`,
    )
    .join('')}
  </html>`);
});
const closeFrontend = await server.attachFrontend();
await server.listen(port, '127.0.0.1');
console.log(`UI preview gallery: ${base}/preview${selected === 'all' ? '' : `#${selected}`}`);
if (selected !== 'all')
  for (const role of ['player', 'host', 'display'])
    console.log(`${role}: ${base}${pathFor(selected, role)}`);
console.log('In-memory fixtures only. Stop with Ctrl+C; restart to reset.');
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
