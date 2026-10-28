import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import { EMOJIS, type RoomSnapshot } from '../shared/contracts.js';
import { api, post, requestId } from './api.js';
import { useRoom } from './useRoom.js';
import './style.css';

// Optional decoration stays independent of navigation, forms, and room state.
const celebration = { enabled: true };
function CelebrationMarker() {
  return celebration.enabled ? (
    <div className="celebration-marker" aria-hidden="true">
      🎈
    </div>
  ) : null;
}
function Brand() {
  return (
    <a className="brand" href="/" aria-label="Tracy / 10,000 days home">
      Tracy / 10,000 days
    </a>
  );
}
function ErrorNote({ text }: { text: string }) {
  return text ? (
    <p className="error" role="alert">
      {text}
    </p>
  ) : null;
}
function Connection({ connected }: { connected: boolean }) {
  return (
    <span className={`connection ${connected ? 'is-online' : ''}`} role="status">
      <span />
      {connected ? 'Connected' : 'Reconnecting…'}
    </span>
  );
}
function Timer({ state, offset }: { state: RoomSnapshot; offset: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  if (state.room.deadlineAt === null) return null;
  const remaining =
    state.room.status === 'closed'
      ? 0
      : Math.max(0, Math.ceil((state.room.deadlineAt - now - offset) / 1000));
  return (
    <div
      className={`timer ${remaining <= 10 ? 'is-ending' : ''}`}
      aria-label={`Time remaining: ${remaining} seconds`}
    >
      <span className="eyebrow">Time left</span>
      <strong>
        {Math.floor(remaining / 60)
          .toString()
          .padStart(2, '0')}
        :{(remaining % 60).toString().padStart(2, '0')}
      </strong>
    </div>
  );
}
function Qr({ code }: { code: string }) {
  const [src, setSrc] = useState('');
  const url = `${location.origin}/play?code=${code}`;
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, {
      margin: 1,
      width: 200,
      color: { dark: '#12140f', light: '#ffffff' },
    }).then((value) => {
      if (active) setSrc(value);
    });
    return () => {
      active = false;
    };
  }, [url]);
  return (
    <div className="qr-block">
      {src && <img src={src} width="136" height="136" alt={`Scan to join party ${code}`} />}
      <div>
        <span className="eyebrow">Join on your phone</span>
        <strong className="room-code">{code}</strong>
        <a className="subtle-link" href={url}>
          Open player view ↗
        </a>
      </div>
    </div>
  );
}
function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Brand />
      {right}
    </header>
  );
}
function Home() {
  return (
    <div className="landing">
      <Header
        right={
          <a className="subtle-link" href="/host">
            Host controls
          </a>
        }
      />
      <main className="landing-main">
        <CelebrationMarker />
        <h1>Tracy’s 10,000th day.</h1>
        <p>A Saturday night to celebrate Tracy.</p>
        <p className="instruction">Join on your phone. We’ll start when everyone’s here.</p>
        <a className="button primary" href="/play">
          Join the games <span aria-hidden="true">↗</span>
        </a>
        <div className="landing-note">
          <span>Tonight</span>
          <p>Investments, costumes, trivia &amp; a little luck.</p>
        </div>
        <p className="fine-print">
          For now, try Sound check — a rehearsal. Party games are coming next.
        </p>
      </main>
      <footer className="landing-footer">10,000 days. One Tracy.</footer>
    </div>
  );
}
function useSession(role: 'host' | 'player') {
  const [session, setSession] = useState<{
    authenticated: boolean;
    roomCode?: string | null;
  } | null>(null);
  const [error, setError] = useState('');
  const refresh = () =>
    api<{ authenticated: boolean; roomCode?: string | null }>(`/api/session?role=${role}`)
      .then(setSession)
      .catch((err) => setError(err.message));
  useEffect(() => {
    void refresh();
  }, [role]);
  return { session, setSession, error };
}
function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/api/login', { password });
      setPassword('');
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <Header right={<span className="tag">Private host access</span>} />
      <main className="form-card">
        <h1>Host controls</h1>
        <p>Sign in to manage your room.</p>
        <form onSubmit={submit}>
          <label>
            Host password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <ErrorNote text={error} />
          <button className="button primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>
      </main>
    </div>
  );
}
function Join({
  defaultCode,
  onJoined,
}: {
  defaultCode: string;
  onJoined: (code: string) => void;
}) {
  const [code, setCode] = useState(defaultCode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [emoji, setEmoji] = useState<string>(EMOJIS[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const profile = { name, email, phone, emoji };
    const fingerprint = JSON.stringify({ code, profile });
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: requestId() };
    try {
      const joined = await post<{ roomCode: string }>(`/api/rooms/${code.toUpperCase()}/join`, {
        joinKey: attempt.current.key,
        profile,
      });
      onJoined(joined.roomCode);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page player-page">
      <Header right={<span className="tag">Player registration</span>} />
      <main className="join-main">
        <h1>Join the games</h1>
        <p>Add your details so the host knows who’s here.</p>
        <form onSubmit={submit}>
          <label>
            Party code
            <input
              className="code-input"
              placeholder="ABC123"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={6}
              pattern="[A-Fa-f0-9]{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <label>
            Your name
            <input
              autoComplete="nickname"
              maxLength={30}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <fieldset>
            <legend>Pick an emoji</legend>
            <div className="emoji-picker">
              {EMOJIS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-label={`Choose ${item}`}
                  aria-pressed={emoji === item}
                  onClick={() => setEmoji(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Phone number
            <input
              type="tel"
              autoComplete="tel"
              minLength={7}
              maxLength={30}
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <p className="fine-print">
            Contact details stay private. Your number is for the final lucky call.
          </p>
          <ErrorNote text={error} />
          <button className="button primary" disabled={busy}>
            {busy ? 'Joining…' : 'Join the games ↗'}
          </button>
        </form>
      </main>
    </div>
  );
}
function Player() {
  const { session, setSession, error } = useSession('player');
  const queryCode = new URLSearchParams(location.search).get('code')?.toUpperCase() ?? '';
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
  const code =
    joinedCode ??
    (session?.authenticated && (!queryCode || queryCode === session.roomCode)
      ? (session.roomCode ?? null)
      : null);
  const room = useRoom('player', code);
  const [reveal, setReveal] = useState(false);
  useEffect(() => setReveal(false), [room.state?.room.phaseInstance]);
  if (!session) return <Loading error={error} />;
  if (!code)
    return (
      <Join
        defaultCode={queryCode}
        onJoined={(next) => {
          setJoinedCode(next);
          setSession({ authenticated: true, roomCode: next });
          history.replaceState(null, '', `/play?code=${next}`);
        }}
      />
    );
  const state = room.state;
  if (!state?.self) return <Loading error={room.error} />;
  const self = state.players.find((p) => p.id === state.self?.id)!;
  const open = state.room.status === 'open';
  return (
    <div className="page player-page">
      <Header
        right={
          <button
            className="balance-toggle"
            aria-label={reveal ? 'Hide token balance' : 'Reveal token balance'}
            aria-pressed={reveal}
            onClick={() => setReveal(!reveal)}
          >
            <span>Tokens</span>
            <strong>{reveal ? state.self.accounts.spendable.toLocaleString() : '••••'}</strong>
          </button>
        }
      />
      <main className="player-main">
        <div className="player-meta">
          <span className="tag">
            {state.room.mode === 'rehearsal' ? 'Rehearsal' : 'Party'} · {state.room.code}
          </span>
          <Connection connected={room.connected} />
        </div>
        <div className="avatar-big">{self.emoji}</div>
        <span className="eyebrow">{self.name}</span>
        <h1>
          {state.room.phase === 'lobby' ? (
            <>You’re in. Waiting for the host.</>
          ) : state.room.phase === 'connection-check' ? (
            <>Sound check</>
          ) : (
            <>Rehearsal complete</>
          )}
        </h1>
        <p>
          {state.room.phase === 'lobby'
            ? 'Your host will take it from here. Let them know when you’re ready.'
            : state.room.phase === 'connection-check'
              ? 'Tap below to check your connection. No tokens are spent.'
              : 'Sound check is complete. Waiting for the host.'}
        </p>
        {reveal && (
          <p className="fine-print">
            {state.self.accounts.locked} invested · {state.self.accounts.reserved} reserved
          </p>
        )}
        <Timer state={state} offset={room.clockOffset} />
        <ErrorNote text={room.error} />
        {state.room.phase === 'lobby' && (
          <button
            className={`button ${state.self.ready ? 'secondary' : 'primary'}`}
            disabled={!room.connected || room.busy}
            onClick={() => void room.command('player.ready', { ready: !state.self!.ready })}
          >
            {state.self.ready ? '✓ Ready' : 'I’m ready ↗'}
          </button>
        )}
        {state.room.phase === 'connection-check' && (
          <button
            className={`button ${state.self.checkedIn ? 'secondary' : 'primary'}`}
            disabled={!open || state.self.checkedIn || !room.connected || room.busy}
            onClick={() => void room.command('phase.action', { action: 'check-in' })}
          >
            {state.self.checkedIn
              ? '✓ Checked in'
              : open
                ? 'Check in ↗'
                : 'Time’s up — waiting for host'}
          </button>
        )}
        <div className="player-footer">
          {state.players.length} {state.players.length === 1 ? 'player' : 'players'} · Sound check
          rehearsal
        </div>
      </main>
    </div>
  );
}
function Loading({ error }: { error?: string }) {
  return (
    <div className="page">
      <Header />
      <main className="form-card">
        <span className="eyebrow">Connecting</span>
        <h1>
          One moment<em>…</em>
        </h1>
        {error ? (
          <>
            <ErrorNote text={error} />
            <a className="button secondary" href={location.pathname}>
              Try again →
            </a>
          </>
        ) : (
          <p>Connecting to your party.</p>
        )}
      </main>
    </div>
  );
}
interface RoomListItem {
  id: string;
  code: string;
  mode: 'party' | 'rehearsal';
  phase: string;
}
function Host() {
  const { session, setSession, error: sessionError } = useSession('host');
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [code, setCode] = useState<string | null>(new URLSearchParams(location.search).get('code'));
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const createAttempt = useRef<string | null>(null);
  const [displayToken, setDisplayToken] = useState<string | undefined>(
    code ? (localStorage.getItem(`of_display_${code}`) ?? undefined) : undefined,
  );
  const room = useRoom('host', session?.authenticated ? code : null);
  const loadRooms = () =>
    api<{ rooms: RoomListItem[]; rehearsalEnabled: boolean }>('/api/rooms')
      .then((data) => {
        setRooms(data.rooms);
        setEnabled(data.rehearsalEnabled);
      })
      .catch((err) => setError(err.message));
  useEffect(() => {
    if (session?.authenticated) void loadRooms();
  }, [session?.authenticated]);
  function selectRoom(next: string) {
    setCode(next);
    setDisplayToken(localStorage.getItem(`of_display_${next}`) ?? undefined);
    history.replaceState(null, '', `/host?code=${next}`);
  }
  async function create() {
    setCreating(true);
    setError('');
    createAttempt.current ??= requestId();
    try {
      const data = await post<{ code: string; displayToken: string }>('/api/rooms', {
        requestId: createAttempt.current,
        mode: 'rehearsal',
      });
      createAttempt.current = null;
      localStorage.setItem(`of_display_${data.code}`, data.displayToken);
      selectRoom(data.code);
      await loadRooms();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }
  async function makeDisplayLink() {
    try {
      const data = await post<{ displayToken: string }>(`/api/rooms/${code}/display-link`, {});
      localStorage.setItem(`of_display_${code}`, data.displayToken);
      setDisplayToken(data.displayToken);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  if (!session) return <Loading error={sessionError} />;
  if (!session.authenticated)
    return <Login onSuccess={() => setSession({ authenticated: true })} />;
  const state = room.state;
  return (
    <div className="page host-page">
      <Header
        right={
          <div className="header-actions">
            <span className="tag">Host controls</span>
            <button
              className="text-button"
              onClick={async () => {
                await post('/api/logout', {});
                setSession({ authenticated: false });
              }}
            >
              Sign out ↗
            </button>
          </div>
        }
      />
      <main className="host-main">
        <div className="host-heading">
          <div>
            <span className="eyebrow">Private host view</span>
            <h1>Waiting room</h1>
          </div>
          <div className="room-selector">
            <label>
              Your parties
              <select value={code ?? ''} onChange={(e) => selectRoom(e.target.value)}>
                <option value="" disabled>
                  Select a party
                </option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.code}>
                    {r.code} · {r.mode} · {r.phase}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button primary"
              disabled={creating || !enabled}
              onClick={() => void create()}
            >
              {creating ? 'Creating…' : '+ New rehearsal'}
            </button>
          </div>
        </div>
        <ErrorNote text={error || room.error} />
        <div className="notice">
          <span aria-hidden="true">🎈</span>
          <div>
            <strong>First, a sound check.</strong> This rehearsal tests the room, countdown, and
            everyone’s connection. Game rounds are coming next. No tokens are spent.
          </div>
        </div>
        {!state ? (
          <section className="empty-state">
            <span aria-hidden="true">🎈</span>
            <h2>{code ? 'Connecting to your room…' : 'No room selected'}</h2>
            <p>
              {code
                ? 'Your party will appear here in a moment.'
                : 'Create a rehearsal, open the TV view, and invite a few phones.'}
            </p>
          </section>
        ) : (
          <>
            <div className="host-grid">
              <section className="panel round-panel">
                <div className="section-heading">
                  <span className="eyebrow">
                    {state.room.phase === 'lobby' ? 'Up next: Sound check' : 'Current round'}
                  </span>
                  <Connection connected={room.connected} />
                </div>
                <h2>
                  {state.room.phase === 'lobby'
                    ? 'Waiting room'
                    : state.room.phase === 'finish'
                      ? 'Rehearsal complete'
                      : state.room.title}
                  <span className="accent">.</span>
                </h2>
                <p>
                  {state.room.phase === 'lobby'
                    ? 'Get everyone into the room. When you’re ready, start the shared countdown.'
                    : state.room.phase === 'connection-check'
                      ? `${state.players.filter((p) => p.checkedIn).length} of ${state.players.length} players have checked in. You decide when to move on.`
                      : 'All connected. The rehearsal is complete.'}
                </p>
                <Timer state={state} offset={room.clockOffset} />
                <div className="actions">
                  {state.room.phase !== 'lobby' &&
                    state.room.phase !== 'finish' &&
                    state.room.status === 'open' && (
                      <button
                        className="button secondary"
                        disabled={room.busy || !room.connected}
                        onClick={() => void room.command('phase.close')}
                      >
                        Close round
                      </button>
                    )}
                  <button
                    className="button primary"
                    disabled={room.busy || !room.connected || !state.room.canAdvance}
                    onClick={() => void room.command('phase.advance')}
                  >
                    {state.room.phase === 'lobby'
                      ? 'Start sound check →'
                      : state.room.phase === 'finish'
                        ? 'Rehearsal complete ✓'
                        : 'Next stage →'}
                  </button>
                </div>
                {state.room.advanceBlocker && state.room.phase !== 'finish' && (
                  <p className="fine-print">{state.room.advanceBlocker}</p>
                )}
              </section>
              <section className="panel invite-panel">
                <span className="eyebrow">Invite players</span>
                <h2>Join this room</h2>
                <Qr code={state.room.code} />
                {displayToken ? (
                  <a
                    className="button secondary"
                    target="_blank"
                    rel="noreferrer"
                    href={`/screen?code=${state.room.code}#${displayToken}`}
                  >
                    Open TV display ↗
                  </a>
                ) : (
                  <button className="button secondary" onClick={() => void makeDisplayLink()}>
                    Create TV link ↗
                  </button>
                )}
              </section>
            </div>
            <section className="panel roster-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Private roster</span>
                  <h2>
                    Players<span className="accent">.</span>{' '}
                    <span className="count">{state.players.length}</span>
                  </h2>
                </div>
                <span className="fine-print">
                  {state.players.filter((p) => p.ready).length} ready · private host view
                </span>
              </div>
              {!state.players.length ? (
                <p className="empty-copy">Waiting for your first guest. Share the code above.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Status</th>
                        <th>Available</th>
                        <th>Invested</th>
                        <th>Reserved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.host?.players.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <span className="avatar-small">{p.emoji}</span>
                            <strong>{p.name}</strong>
                          </td>
                          <td>
                            <span className={`status-dot ${p.connected ? 'is-online' : ''}`} />
                            {!p.connected
                              ? 'Away'
                              : p.checkedIn
                                ? 'Checked in'
                                : p.ready
                                  ? 'Ready'
                                  : 'Getting settled'}
                          </td>
                          <td>{p.accounts.spendable.toLocaleString()}</td>
                          <td>{p.accounts.locked.toLocaleString()}</td>
                          <td>{p.accounts.reserved.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <details className="ledger">
              <summary>
                Token activity <span>↗</span>
              </summary>
              <p className="fine-print">Saved activity for this party.</p>
              {state.host?.ledger.map((entry) => (
                <div className="ledger-row" key={entry.id}>
                  <span>
                    {state.players.find((p) => p.id === entry.playerId)?.name} · {entry.reason}
                  </span>
                  <strong>
                    {entry.spendable >= 0 ? '+' : ''}
                    {entry.spendable}
                  </strong>
                </div>
              ))}
            </details>
          </>
        )}
      </main>
    </div>
  );
}
function Display() {
  const code = new URLSearchParams(location.search).get('code')?.toUpperCase() ?? null;
  const token = location.hash.slice(1);
  const room = useRoom('display', code, token);
  const state = room.state;
  if (!code || !token)
    return (
      <Loading error="Open the TV display using the private link in your host control room." />
    );
  if (!state) return <Loading error={room.error} />;
  return (
    <div className="page display-page">
      <Header
        right={
          <div className="header-actions">
            <span className="tag">{state.room.code} · Rehearsal</span>
            <Connection connected={room.connected} />
          </div>
        }
      />
      <main className="display-main">
        <div className="display-hero">
          <div>
            <span className="eyebrow">
              {state.room.phase === 'lobby' ? 'Waiting room' : 'Sound check rehearsal'}{' '}
            </span>
            <h1>
              {state.room.phase === 'lobby' ? (
                <>Tracy’s 10,000th day.</>
              ) : state.room.phase === 'connection-check' ? (
                <>Sound check</>
              ) : (
                <>Rehearsal complete</>
              )}
            </h1>
            <p>
              {state.room.phase === 'lobby'
                ? 'Join on your phone. We’ll start when everyone’s here.'
                : state.room.phase === 'connection-check'
                  ? state.room.status === 'closed'
                    ? 'Time’s up. Your host will take it from here.'
                    : 'Tap “Check in” on your phone.'
                  : 'Sound check is complete. Waiting for the host.'}
            </p>
          </div>
          {state.room.phase === 'lobby' ? (
            <div className="display-qr">
              <Qr code={code} />
            </div>
          ) : (
            <Timer state={state} offset={room.clockOffset} />
          )}
        </div>
        <ErrorNote text={room.error} />
        <div className="section-heading">
          <span className="eyebrow">Players</span>
          <span>
            {state.players.length} in the room
            {state.room.phase === 'connection-check'
              ? ` · ${state.players.filter((p) => p.checkedIn).length} checked in`
              : ''}
          </span>
        </div>
        <div className="guest-grid">
          {state.players.map((p) => (
            <div key={p.id} className={`guest-chip ${p.checkedIn ? 'checked' : ''}`}>
              <span>{p.emoji}</span>
              <strong>{p.name}</strong>
              <small>
                {p.checkedIn
                  ? '✓ Checked in'
                  : p.ready
                    ? '✓ Ready'
                    : p.connected
                      ? 'Connected'
                      : 'Away for a moment'}
              </small>
            </div>
          ))}
        </div>
        {!state.players.length && (
          <p className="empty-copy">No players yet. Scan the code to join.</p>
        )}
      </main>
      <footer className="display-footer">
        Tracy / 10,000 days <span>Sound check rehearsal · No tokens spent</span>
      </footer>
    </div>
  );
}
const route = location.pathname;
createRoot(document.getElementById('root')!).render(
  route === '/host' ? (
    <Host />
  ) : route === '/play' ? (
    <Player />
  ) : route === '/screen' ? (
    <Display />
  ) : (
    <Home />
  ),
);
