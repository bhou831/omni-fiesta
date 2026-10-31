import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { EMOJIS, type Command } from '../shared/contracts.js';
import { loadConfig, gameConfigSchema, type GameConfig } from './config.js';
import { Store, hash, type Session } from './core/store.js';
import { Engine, type Viewer } from './core/engine.js';
import type { PhaseModule } from './core/phases.js';
import { GameError, requireRule } from './core/errors.js';
import { prepareMarket } from './games/prepare-market.js';
import { createPartyModules } from './games/index.js';
import { coinGeckoProvider, fixtureProvider, type MarketProvider } from './games/market.js';
import { isApprovedApplePreviewUrl } from './games/trivia-content.js';

function cookies(header?: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}
const codeSchema = z.string().regex(/^[A-F0-9]{6}$/);
const joinSchema = z
  .object({
    joinKey: z.string().uuid(),
    profile: z
      .object({
        name: z.string().trim().min(1).max(30),
        email: z
          .union([z.string().trim().email().max(254), z.string().trim().length(0)])
          .default(''),
        phone: z
          .string()
          .trim()
          .min(7)
          .max(30)
          .regex(/^[+()\d .-]+$/)
          .refine((value) => value.replace(/\D/g, '').length >= 7),
        emoji: z.enum(EMOJIS),
      })
      .strict(),
  })
  .strict();
const commandSchema = z
  .object({
    requestId: z.string().uuid(),
    phaseInstance: z.number().int().nonnegative(),
    type: z.enum([
      'player.ready',
      'phase.advance',
      'phase.start',
      'phase.close',
      'phase.action',
      'phase.host',
    ]),
    payload: z
      .object({
        ready: z.boolean().optional(),
        action: z.string().max(80).optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export interface AppOptions {
  databasePath: string;
  hostPassword: string;
  config?: GameConfig;
  now?: () => number;
  enableRehearsal?: boolean;
  publicOrigin?: string;
  production?: boolean;
  marketProvider?: MarketProvider;
  /** Explicit injection for isolated integration tests. */
  modules?: PhaseModule[];
  /** Isolate the standalone preview server from other apps on the same loopback host. */
  cookiePrefix?: string;
}

export function createApp(options: AppOptions) {
  const cookiePrefix = options.cookiePrefix ?? 'of';
  if (!/^[a-z_]{1,32}$/.test(cookiePrefix)) throw new Error('Invalid cookie prefix');
  const cookieNames = { host: `${cookiePrefix}_host`, player: `${cookiePrefix}_player` };
  requireRule(
    options.hostPassword.length >= 12,
    'HOST_PASSWORD_REQUIRED',
    'Set HOST_PASSWORD to at least 12 characters before starting.',
  );
  if (options.production)
    requireRule(
      options.publicOrigin?.startsWith('https://'),
      'ORIGIN_REQUIRED',
      'Set an HTTPS PUBLIC_ORIGIN for production.',
    );
  const config = gameConfigSchema.parse(options.config ?? loadConfig());
  const now = options.now ?? Date.now;
  const credentialHash = hash(options.hostPassword);
  const store = new Store(options.databasePath);
  const engine = new Engine(store, now, options.modules ?? createPartyModules());
  engine.expireAll();
  const app = express();
  const httpServer = createServer(app);
  function allowedOrigin(origin: string | undefined, host: string | undefined): boolean {
    if (!origin) return true; // CLI clients still need session credentials.
    try {
      return options.publicOrigin
        ? origin === new URL(options.publicOrigin).origin
        : new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const io = new Server(httpServer, {
    maxHttpBufferSize: 16_384,
    allowRequest: (req, callback) =>
      callback(null, allowedOrigin(req.headers.origin, req.headers.host)),
  });
  app.disable('x-powered-by');
  // Only the local Caddy proxy may supply a forwarded client address.
  if (options.production) app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && !allowedOrigin(req.headers.origin, req.headers.host))
      return next(
        new GameError('ORIGIN_REJECTED', 'This request must come from the party app.', 403),
      );
    next();
  });
  function sessionFrom(header: string | undefined, role: 'host' | 'player'): Session | null {
    return store.authenticate(cookies(header)[cookieNames[role]], role, now(), credentialHash);
  }
  function needSession(req: Request, role: 'host' | 'player'): Session {
    const session = sessionFrom(req.headers.cookie, role);
    requireRule(
      session,
      'UNAUTHORIZED',
      role === 'host' ? 'Sign in as host to continue.' : 'Join the party to continue.',
      401,
    );
    return session;
  }
  function setSession(res: Response, role: 'host' | 'player', token: string) {
    res.cookie(cookieNames[role], token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: !!options.production,
      maxAge: 7 * 86_400_000,
      path: '/',
    });
  }
  // A Mac can sign in independently and run only the public TV projection, without
  // replacing a capability link already in use on another display.
  function displayViewer(header: string | undefined, roomId: string, token?: string): Viewer {
    if (token !== undefined) {
      requireRule(
        store.displayAuthorized(roomId, token),
        'FORBIDDEN',
        'This TV link expired. Open /screen and sign in, or ask the host for a new link.',
        403,
      );
    } else {
      requireRule(
        sessionFrom(header, 'host'),
        'UNAUTHORIZED',
        'Sign in on this device to set up the TV display.',
        401,
      );
    }
    return { role: 'display', roomId };
  }
  function viewer(req: Request, roomId: string): Viewer {
    const role = z.enum(['host', 'player', 'display']).parse(req.query.role ?? 'player');
    if (role === 'host') {
      needSession(req, 'host');
      return { role, roomId };
    }
    if (role === 'display') {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      return displayViewer(req.headers.cookie, roomId, token);
    }
    const session = needSession(req, 'player');
    requireRule(
      session.roomId === roomId && session.playerId,
      'FORBIDDEN',
      'This session belongs to another party.',
      403,
    );
    return { role, roomId, playerId: session.playerId };
  }
  let closing = false;
  const broadcasts = new Map<string, ReturnType<typeof setTimeout>>();
  function broadcast(roomId: string) {
    if (closing || broadcasts.has(roomId)) return;
    broadcasts.set(
      roomId,
      setTimeout(() => {
        broadcasts.delete(roomId);
        const targets: { socket: Socket; viewer: Viewer }[] = [];
        for (const socket of io.sockets.sockets.values()) {
          if (socket.data.viewer?.roomId !== roomId) continue;
          try {
            targets.push({ socket, viewer: socket.data.authorize() as Viewer });
          } catch {
            socket.emit('session-expired');
            socket.disconnect();
          }
        }
        const snapshots = engine.snapshots(targets.map((target) => target.viewer));
        targets.forEach((target, index) => target.socket.emit('state', snapshots[index]));
      }, 16),
    );
  }
  function synchronizedSnapshot(authorizedViewer: Viewer) {
    const version = store.room(authorizedViewer.roomId).version;
    const snapshot = engine.snapshot(authorizedViewer);
    if (snapshot.room.version !== version) broadcast(authorizedViewer.roomId);
    return snapshot;
  }
  const attempts = new Map<string, { count: number; until: number }>();
  app.post('/api/login', (req, res) => {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    for (const [ip, entry] of attempts) if (entry.until <= now()) attempts.delete(ip);
    const entry = attempts.get(key) ?? { count: 0, until: now() + 60_000 };
    requireRule(
      entry.count < 10,
      'TOO_MANY_ATTEMPTS',
      'Too many login attempts. Try again in a minute.',
      429,
    );
    entry.count++;
    attempts.set(key, entry);
    const password = z.object({ password: z.string().max(256) }).parse(req.body).password;
    requireRule(
      timingSafeEqual(Buffer.from(hash(password)), Buffer.from(credentialHash)),
      'UNAUTHORIZED',
      'That host password wasn’t recognized.',
      401,
    );
    attempts.delete(key);
    setSession(res, 'host', store.session('host', now(), credentialHash));
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    const token = cookies(req.headers.cookie)[cookieNames.host];
    if (token) store.revoke(token);
    res.clearCookie(cookieNames.host, { path: '/' });
    for (const socket of io.sockets.sockets.values())
      if (token && socket.data.sessionHash === hash(token)) socket.disconnect();
    res.json({ ok: true });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, milestone: 'foundation' }));
  app.get('/api/time', (_req, res) => res.json({ serverTime: now() }));
  app.get('/api/session', (req, res) => {
    const role = z.enum(['host', 'player']).parse(req.query.role ?? 'player');
    const session = sessionFrom(req.headers.cookie, role);
    res.json(
      session && (!session.roomId || !store.isArchived(session.roomId))
        ? {
            authenticated: true,
            role,
            roomCode: session.roomId ? store.room(session.roomId).code : null,
          }
        : { authenticated: false },
    );
  });
  app.get('/api/rooms', (req, res) => {
    needSession(req, 'host');
    res.json({
      rooms: store.db
        .prepare(
          'SELECT id,code,mode,phase,created_at AS createdAt, EXISTS(SELECT 1 FROM archived_rooms WHERE room_id=rooms.id) AS archived FROM rooms ORDER BY archived,created_at DESC,id DESC',
        )
        .all(),
      rehearsalEnabled: !!options.enableRehearsal,
    });
  });
  app.post('/api/rooms', (req, res) => {
    needSession(req, 'host');
    const input = z
      .object({
        requestId: z.string().uuid(),
        mode: z.enum(['party', 'rehearsal']),
        marketSource: z.enum(['live', 'fixture']).optional(),
      })
      .strict()
      .parse(req.body);
    requireRule(
      input.mode !== 'rehearsal' || options.enableRehearsal,
      'REHEARSAL_DISABLED',
      'Rehearsal is disabled on this server.',
    );
    requireRule(
      input.marketSource !== 'fixture' || (!!options.enableRehearsal && !options.production),
      'FIXTURE_DISABLED',
      'Fixture rooms are disabled.',
    );
    const room = store.transaction(() =>
      store.once('host:room-create', input.requestId, input, () =>
        store.createRoom(config, input.mode, now(), input.marketSource ?? 'live'),
      ),
    );
    res.status(201).json(room);
  });
  app.post('/api/rooms/:code/archive', (req, res) => {
    needSession(req, 'host');
    const code = codeSchema.parse(req.params.code);
    const { archived } = z.object({ archived: z.boolean() }).strict().parse(req.body);
    if (archived) {
      const row = store.db.prepare('SELECT id FROM rooms WHERE code=?').get(code) as
        { id: string } | undefined;
      requireRule(row, 'ROOM_NOT_FOUND', 'Party not found.', 404);
      requireRule(
        !store.players(row.id).some((player) => engine.isConnected(player.id)),
        'PLAYERS_CONNECTED',
        'Players are still connected. Ask them to leave the room before archiving.',
        409,
      );
    }
    const roomId = store.setArchived(code, archived, now());
    if (archived) {
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.viewer?.roomId !== roomId) continue;
        socket.emit('room-archived');
        socket.disconnect();
      }
    } else {
      engine.expire(roomId);
      broadcast(roomId);
    }
    res.json({ code, archived });
  });
  app.post('/api/rooms/:code/join', (req, res) => {
    const room = store.roomByCode(codeSchema.parse(req.params.code));
    const existing = sessionFrom(req.headers.cookie, 'player');
    if (existing?.roomId === room.id)
      return res.json({ roomId: room.id, playerId: existing.playerId, roomCode: room.code });
    const input = joinSchema.parse(req.body);
    const joined = store.join(room, input.profile, input.joinKey, now());
    setSession(res, 'player', joined.token);
    broadcast(room.id);
    res.json({ roomId: room.id, playerId: joined.playerId, roomCode: room.code });
  });
  app.post('/api/rooms/:code/recovery', (req, res) => {
    needSession(req, 'host');
    const room = store.roomByCode(codeSchema.parse(req.params.code));
    const { playerId } = z.object({ playerId: z.string().uuid() }).strict().parse(req.body);
    const token = store.issueRecovery(room.id, playerId, now());
    res.json({ token, expiresAt: now() + 10 * 60_000 });
  });
  app.post('/api/rooms/:code/recover', (req, res) => {
    const room = store.roomByCode(codeSchema.parse(req.params.code));
    const { token, requestId } = z
      .object({ token: z.string().min(32).max(128), requestId: z.string().uuid().optional() })
      .strict()
      .parse(req.body);
    const replacement = store.recover(room.id, token, now(), requestId, credentialHash);
    setSession(res, 'player', replacement);
    broadcast(room.id);
    res.json({ roomCode: room.code });
  });
  app.get('/api/rooms/:code/state', (req, res) => {
    const room = store.roomByCode(codeSchema.parse(req.params.code));
    const authorizedViewer = viewer(req, room.id);
    res.json(synchronizedSnapshot(authorizedViewer));
  });
  app.get('/api/rooms/:code/trivia-audio/:cellId', (req, res) => {
    const room = store.roomByCode(codeSchema.parse(req.params.code));
    const token = typeof req.query.displayToken === 'string' ? req.query.displayToken : undefined;
    if (token !== undefined) displayViewer(req.headers.cookie, room.id, token);
    else needSession(req, 'host');
    requireRule(
      room.phase === 'trivia' && room.status === 'open',
      'AUDIO_UNAVAILABLE',
      'This clip is unavailable.',
      404,
    );
    const row = store.db
      .prepare(
        'SELECT content,selected_cell FROM trivia_boards WHERE room_id=? AND phase_instance=?',
      )
      .get(room.id, room.phase_instance) as
      { content: string; selected_cell: string | null } | undefined;
    requireRule(
      row?.selected_cell === req.params.cellId,
      'AUDIO_UNAVAILABLE',
      'This clip is unavailable.',
      404,
    );
    let bank: {
      mode: string;
      cells: { id: string; kind: string; musicAudio?: { file?: string; url?: string } }[];
    };
    try {
      bank = JSON.parse(row.content);
    } catch {
      return res.sendStatus(404);
    }
    const clue = bank.cells.find((cell) => cell.id === row.selected_cell);
    requireRule(
      clue?.kind === 'music' && clue.musicAudio,
      'AUDIO_UNAVAILABLE',
      'This clip is unavailable.',
      404,
    );
    if (clue.musicAudio.url) {
      let url: URL;
      try {
        url = new URL(clue.musicAudio.url);
      } catch {
        return res.sendStatus(404);
      }
      requireRule(
        isApprovedApplePreviewUrl(url.toString()),
        'AUDIO_UNAVAILABLE',
        'This clip is unavailable.',
        404,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      return res.redirect(302, url.toString());
    }
    let path: string;
    let size: number;
    try {
      const root = realpathSync(
        bank.mode === 'demo' ? resolve('fixtures') : resolve('private/trivia-media'),
      );
      path = realpathSync(resolve(root, clue.musicAudio.file!));
      requireRule(
        path.startsWith(`${root}/`),
        'AUDIO_UNAVAILABLE',
        'This clip is unavailable.',
        404,
      );
      size = statSync(path).size;
      requireRule(size > 0, 'AUDIO_UNAVAILABLE', 'This clip is unavailable.', 404);
    } catch {
      return res.sendStatus(404);
    }
    let start = 0;
    let end = size - 1;
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || size === 0 || (!match[1] && !match[2])) {
        res.setHeader('Content-Range', `bytes */${size}`);
        return res.sendStatus(416);
      }
      if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
          res.setHeader('Content-Range', `bytes */${size}`);
          return res.sendStatus(416);
        }
        start = Math.max(0, size - suffixLength);
      } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : size - 1;
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start >= size ||
        end < start
      ) {
        res.setHeader('Content-Range', `bytes */${size}`);
        return res.sendStatus(416);
      }
      end = Math.min(end, size - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', end - start + 1);
    res.setHeader('Cache-Control', 'private, no-store');
    const stream = createReadStream(path, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
  app.post('/api/rooms/:code/market/:kind', async (req, res) => {
    needSession(req, 'host');
    const kind = z.enum(['opening', 'closing']).parse(req.params.kind);
    const room = store.roomByCode(codeSchema.parse(req.params.code));
    const source =
      (
        store.db.prepare('SELECT source FROM room_market_modes WHERE room_id=?').get(room.id) as
          { source: string } | undefined
      )?.source ?? 'live';
    const provider =
      source === 'fixture'
        ? fixtureProvider()
        : (options.marketProvider ?? coinGeckoProvider(process.env.COINGECKO_API_KEY ?? ''));
    await prepareMarket(store, room.id, kind, provider, now);
    broadcast(room.id);
    res.json({ prepared: true });
  });
  app.post('/api/rooms/:code/commands', (req, res) => {
    const room = store.roomByCode(codeSchema.parse(req.params.code));
    const role = z.enum(['host', 'player']).parse(req.query.role ?? 'player');
    const session = needSession(req, role);
    const command = commandSchema.parse(req.body) as Command;
    try {
      const result = engine.execute(session, room.id, command);
      res.json(result);
    } finally {
      broadcast(room.id);
    }
  });
  app.post('/api/rooms/:code/display-link', (req, res) => {
    needSession(req, 'host');
    const room = store.roomByCode(codeSchema.parse(req.params.code));
    const token = randomBytes(32).toString('base64url');
    store.db.prepare('UPDATE rooms SET display_token_hash=? WHERE id=?').run(hash(token), room.id);
    broadcast(room.id);
    res.json({ displayToken: token });
  });
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: 'API route not found.', code: 'NOT_FOUND' }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error instanceof GameError)
      return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof z.ZodError || (error instanceof SyntaxError && 'body' in error))
      return res
        .status(400)
        .json({ error: 'Check the submitted fields and try again.', code: 'INVALID_INPUT' });
    console.error('Unhandled server error:', error instanceof Error ? error.name : 'UnknownError');
    res
      .status(500)
      .json({ error: 'Something went wrong. Please retry the same action.', code: 'SERVER_ERROR' });
  });
  io.use((socket, next) => {
    try {
      const auth = z
        .object({
          role: z.enum(['host', 'player', 'display']),
          code: codeSchema,
          displayToken: z.string().max(128).optional(),
        })
        .parse(socket.handshake.auth);
      const room = store.roomByCode(auth.code);
      const authorize = (): Viewer => {
        store.room(room.id);
        if (auth.role === 'display') {
          const publicViewer = displayViewer(
            socket.handshake.headers.cookie,
            room.id,
            auth.displayToken,
          );
          if (auth.displayToken === undefined)
            socket.data.sessionHash = sessionFrom(
              socket.handshake.headers.cookie,
              'host',
            )!.tokenHash;
          return publicViewer;
        }
        const session = sessionFrom(socket.handshake.headers.cookie, auth.role);
        requireRule(session, 'UNAUTHORIZED', 'Session expired.', 401);
        socket.data.sessionHash = session.tokenHash;
        if (auth.role === 'host') return { role: 'host', roomId: room.id };
        requireRule(
          session.roomId === room.id && session.playerId,
          'FORBIDDEN',
          'Wrong party.',
          403,
        );
        return { role: 'player', roomId: room.id, playerId: session.playerId };
      };
      socket.data.authorize = authorize;
      socket.data.viewer = authorize();
      next();
    } catch (error) {
      next(
        new Error(
          error instanceof GameError ? error.message : 'Join or sign in to access this party.',
        ),
      );
    }
  });
  io.on('connection', (socket) => {
    const currentViewer = socket.data.viewer as Viewer;
    if (currentViewer.role === 'player') engine.presence(currentViewer.playerId, 1);
    socket.on('sync', () => {
      try {
        const authorizedViewer = socket.data.authorize() as Viewer;
        socket.emit('state', synchronizedSnapshot(authorizedViewer));
      } catch {
        socket.disconnect();
      }
    });
    socket.on('clock', (ack: unknown) => {
      if (typeof ack === 'function') ack({ serverTime: now() });
    });
    socket.on('disconnect', () => {
      if (currentViewer.role === 'player') engine.presence(currentViewer.playerId, -1);
      broadcast(currentViewer.roomId);
    });
    broadcast(currentViewer.roomId);
  });
  const ticker = setInterval(() => {
    for (const id of engine.expireAll()) broadcast(id);
  }, 250);
  ticker.unref();
  return {
    app,
    httpServer,
    io,
    store,
    engine,
    broadcast,
    async attachFrontend() {
      if (options.production) {
        app.use(express.static(resolve('dist/client')));
        app.get(/.*/, (_req, res) => res.sendFile(resolve('dist/client/index.html')));
      } else {
        const { createServer: createVite } = await import('vite');
        const vite = await createVite({
          configLoader: 'runner',
          server: { middlewareMode: true, hmr: { server: httpServer } },
          appType: 'spa',
        });
        app.use(vite.middlewares);
        return () => vite.close();
      }
    },
    async listen(port = 0, host = '127.0.0.1'): Promise<number> {
      await new Promise<void>((done, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          done();
        });
      });
      return (httpServer.address() as { port: number }).port;
    },
    async close() {
      closing = true;
      clearInterval(ticker);
      broadcasts.forEach(clearTimeout);
      broadcasts.clear();
      await new Promise<void>((done) => io.close(() => done()));
      if (httpServer.listening) await new Promise<void>((done) => httpServer.close(() => done()));
      store.close();
    },
  };
}
