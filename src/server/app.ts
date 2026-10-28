import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { EMOJIS, type Command, type Role } from '../shared/contracts.js';
import { loadConfig, gameConfigSchema, type GameConfig } from './config.js';
import { Store, hash, type Session } from './core/store.js';
import { Engine, type Viewer } from './core/engine.js';
import { GameError, requireRule } from './core/errors.js';

const cookieNames = { host: 'of_host', player: 'of_player' };
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
        email: z.string().trim().email().max(254),
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
    type: z.enum(['player.ready', 'phase.advance', 'phase.close', 'phase.action']),
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
}

export function createApp(options: AppOptions) {
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
  const engine = new Engine(store, now);
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
  function viewer(req: Request, roomId: string): Viewer {
    const role = z.enum(['host', 'player', 'display']).parse(req.query.role ?? 'player');
    if (role === 'host') {
      needSession(req, 'host');
      return { role, roomId };
    }
    if (role === 'display') {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      requireRule(
        token && store.displayAuthorized(roomId, token),
        'FORBIDDEN',
        'Ask the host for a new TV link.',
        403,
      );
      return { role, roomId };
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
  const attempts = new Map<string, { count: number; until: number }>();
  app.post('/api/login', (req, res) => {
    const key = req.socket.remoteAddress ?? 'unknown';
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
    const token = cookies(req.headers.cookie).of_host;
    if (token) store.revoke(token);
    res.clearCookie('of_host', { path: '/' });
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
      session
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
          'SELECT id,code,mode,phase,created_at AS createdAt FROM rooms ORDER BY created_at DESC,id DESC LIMIT 50',
        )
        .all(),
      rehearsalEnabled: !!options.enableRehearsal,
    });
  });
  app.post('/api/rooms', (req, res) => {
    needSession(req, 'host');
    const input = z
      .object({ requestId: z.string().uuid(), mode: z.enum(['party', 'rehearsal']) })
      .strict()
      .parse(req.body);
    requireRule(
      input.mode !== 'rehearsal' || options.enableRehearsal,
      'REHEARSAL_DISABLED',
      'Rehearsal is disabled on this server.',
    );
    const room = store.transaction(() =>
      store.once('host:room-create', input.requestId, input, () =>
        store.createRoom(config, input.mode, now()),
      ),
    );
    res.status(201).json(room);
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
  app.get('/api/rooms/:code/state', (req, res) => {
    const room = store.roomByCode(codeSchema.parse(req.params.code));
    res.json(engine.snapshot(viewer(req, room.id)));
  });
  app.post('/api/rooms/:code/commands', (req, res) => {
    const room = store.roomByCode(codeSchema.parse(req.params.code));
    const role = z.enum(['host', 'player']).parse(req.query.role ?? 'player');
    const session = needSession(req, role);
    const command = commandSchema.parse(req.body) as Command;
    const result = engine.execute(session, room.id, command);
    broadcast(room.id);
    res.json(result);
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
        if (auth.role === 'display') {
          requireRule(
            auth.displayToken && store.displayAuthorized(room.id, auth.displayToken),
            'FORBIDDEN',
            'TV access expired.',
            403,
          );
          return { role: 'display', roomId: room.id };
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
    } catch {
      next(new Error('Join or sign in to access this party.'));
    }
  });
  io.on('connection', (socket) => {
    const currentViewer = socket.data.viewer as Viewer;
    if (currentViewer.role === 'player') engine.presence(currentViewer.playerId, 1);
    socket.on('sync', () => {
      try {
        socket.emit('state', engine.snapshot(socket.data.authorize()));
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
