import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import { EMOJIS, type RoomSnapshot } from '../shared/contracts.js';
import { api, post, requestId } from './api.js';
import { useRoom } from './useRoom.js';
import { InvestmentPlayer } from './Investments.js';
import { CostumePlayer, CostumeHost, CostumeDisplay } from './Costume.js';
import { TriviaPlayer, TriviaHost, TriviaDisplay } from './Trivia.js';
import { SlotsPlayer, SlotsHost, SlotsDisplay } from './Slots.js';
import { PowerballPlayer, PowerballHost, PowerballDisplay } from './Powerball.js';
import {
  SomebodyCallingHost,
  SomebodyCallingPlayer,
  SomebodyCallingDisplay,
} from './SomebodyCalling.js';
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
          Your phone is your controller. Follow the big screen between rounds.
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
  const [recoveryError, setRecoveryError] = useState('');
  const [recovering, setRecovering] = useState(
    !!new URLSearchParams(location.hash.slice(1)).get('recover'),
  );
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get('recover');
    if (!token || !queryCode) return;
    history.replaceState(null, '', `/play?code=${queryCode}`);
    post<{ roomCode: string }>(`/api/rooms/${queryCode}/recover`, { token })
      .then((data) => {
        setJoinedCode(data.roomCode);
        setSession({ authenticated: true, roomCode: data.roomCode });
      })
      .catch((err) => setRecoveryError(err.message))
      .finally(() => setRecovering(false));
  }, []);
  const code =
    joinedCode ??
    (session?.authenticated && (!queryCode || queryCode === session.roomCode)
      ? (session.roomCode ?? null)
      : null);
  const room = useRoom('player', code);
  const [reveal, setReveal] = useState(false);
  useEffect(() => setReveal(false), [room.state?.room.phaseInstance]);
  if (recovering || !session) return <Loading error={error} />;
  if (recoveryError) return <Loading error={recoveryError} />;
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
      <main
        className={`player-main ${state.room.status !== 'pending' && ['slots', 'powerball'].includes(state.room.phase) ? 'game-interaction' : ''}`}
      >
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
          ) : state.room.mode === 'party' ? (
            state.room.title
          ) : (
            <>Rehearsal complete</>
          )}
        </h1>
        <p className="round-instruction">
          {state.room.status === 'pending'
            ? 'Waiting for the host to start the timer.'
            : state.room.phase === 'lobby'
              ? 'Your host will take it from here. Let them know when you’re ready.'
              : state.room.phase === 'connection-check'
                ? 'Tap below to check your connection. No tokens are spent.'
                : state.room.mode === 'party'
                  ? 'Follow the instructions below.'
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
                : state.room.status === 'pending'
                  ? 'Waiting for the host to start'
                  : 'Time’s up — waiting for host'}
          </button>
        )}
        {(state.room.phase === 'investments' || state.room.phase === 'investment-review') &&
          state.investments && (
            <InvestmentPlayer
              state={state}
              revealBalance={reveal}
              command={room.command}
              disabled={!open || !room.connected || room.busy}
            />
          )}
        {state.costume && state.room.status !== 'pending' && (
          <CostumePlayer
            state={state.costume}
            players={state.players}
            selfId={state.self.id}
            open={open}
            disabled={room.busy || !room.connected}
            allowSelfVote={state.costume.allowSelfVote}
            onVote={(candidateId) =>
              void room.command('phase.action', { action: 'vote', data: { candidateId } })
            }
            onReveal={() => {}}
          />
        )}
        {state.trivia && (
          <TriviaPlayer
            trivia={state.trivia}
            command={room.command}
            disabled={room.busy || !room.connected || !open}
          />
        )}
        {state.room.status !== 'pending' && state.slots?.role === 'player' && (
          <SlotsPlayer
            state={state.slots.data}
            spendable={state.self.accounts.spendable}
            revealBalance={reveal}
            open={open}
            disabled={room.busy || !room.connected}
            command={room.command}
          />
        )}
        {state.room.marketSource === 'fixture' && <p>Fixture prices · test party</p>}
        {state.powerball && state.room.status !== 'pending' && (
          <PowerballPlayer
            state={state.powerball}
            players={state.players}
            spendable={state.self.accounts.spendable}
            revealBalance={reveal}
            open={open}
            disabled={room.busy || !room.connected}
            onBet={(color, amount) =>
              void room.command('phase.action', { action: 'bet', data: { color, amount } })
            }
            onCancel={() => void room.command('phase.action', { action: 'cancel' })}
            onDraw={() => {}}
            onReveal={() => {}}
          />
        )}
        {state.calling?.role === 'public' && <SomebodyCallingPlayer state={state.calling.data} />}
        <Ranking state={state} />
        <div className="player-footer">
          {state.players.length} {state.players.length === 1 ? 'player' : 'players'} ·{' '}
          {state.room.mode === 'rehearsal' ? 'Sound check rehearsal' : 'Party'}
        </div>
      </main>
    </div>
  );
}
function Ranking({ state, display = false }: { state: RoomSnapshot; display?: boolean }) {
  const page = useRotatingPage(state.ranking?.length ?? 0, 6);
  return state.ranking ? (
    <section>
      <h2>Final ranking</h2>
      <ol>
        {(display ? state.ranking.slice(page * 6, page * 6 + 6) : state.ranking).map((p) => (
          <li key={p.playerId} value={p.rank}>
            {p.emoji} {p.name} · {p.tokens.toLocaleString()} tokens
          </li>
        ))}
      </ol>
    </section>
  ) : null;
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
  archived: number;
}
function Host() {
  const { session, setSession, error: sessionError } = useSession('host');
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [code, setCode] = useState<string | null>(new URLSearchParams(location.search).get('code'));
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [recoveryLink, setRecoveryLink] = useState('');
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
  function selectRoom(next: string | null) {
    setCode(next);
    setRecoveryLink('');
    setDisplayToken(next ? (localStorage.getItem(`of_display_${next}`) ?? undefined) : undefined);
    history.replaceState(null, '', next ? `/host?code=${next}` : '/host');
  }
  async function archiveRoom(target: string, archived: boolean) {
    setArchiving(true);
    setError('');
    try {
      await post(`/api/rooms/${target}/archive`, { archived });
      if (archived && code === target) selectRoom(null);
      await loadRooms();
      if (!archived) selectRoom(target);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setArchiving(false);
    }
  }
  async function create(mode: 'party' | 'rehearsal', marketSource: 'live' | 'fixture' = 'live') {
    setCreating(true);
    setError('');
    createAttempt.current ??= requestId();
    try {
      const data = await post<{ code: string; displayToken: string }>('/api/rooms', {
        requestId: createAttempt.current,
        mode,
        marketSource,
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
            <h1>
              {state?.room.phase && state.room.phase !== 'lobby'
                ? state.room.title
                : 'Waiting room'}
            </h1>
          </div>
          <details className="party-management">
            <summary>Manage parties</summary>
            <div className="room-selector">
              <label>
                Your parties
                <select value={code ?? ''} onChange={(e) => selectRoom(e.target.value)}>
                  <option value="" disabled>
                    Select a party
                  </option>
                  {rooms
                    .filter((r) => !r.archived)
                    .map((r) => (
                      <option key={r.id} value={r.code}>
                        {r.code} · {r.mode} · {r.phase}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button primary"
                disabled={creating || !enabled}
                onClick={() => void create('rehearsal')}
              >
                {creating ? 'Creating…' : '+ New rehearsal'}
              </button>
              <button
                className="button secondary"
                disabled={creating}
                onClick={() => void create('party')}
              >
                + New party
              </button>
              {enabled && (
                <button
                  className="button secondary"
                  disabled={creating}
                  onClick={() => void create('party', 'fixture')}
                >
                  + Fixture party
                </button>
              )}
              {code && (
                <button
                  className="button secondary"
                  disabled={
                    archiving || room.busy || !state || state.players.some((p) => p.connected)
                  }
                  onClick={() => void archiveRoom(code, true)}
                >
                  Archive party
                </button>
              )}
            </div>
          </details>
        </div>
        {code && state?.players.some((p) => p.connected) && (
          <p className="fine-print">Archiving is available once all players disconnect.</p>
        )}
        {rooms.some((r) => r.archived) && (
          <details className="archived-parties">
            <summary>Archived parties ({rooms.filter((r) => r.archived).length})</summary>
            <p className="fine-print">
              Scores and history are preserved. Restore a party to reopen it; elapsed timers stay
              expired.
            </p>
            {rooms
              .filter((r) => r.archived)
              .map((r) => (
                <div className="archived-party" key={r.id}>
                  <span>
                    <strong>{r.code}</strong> · {r.mode} · {r.phase}
                  </span>
                  <button
                    className="button secondary"
                    disabled={archiving}
                    onClick={() => void archiveRoom(r.code, false)}
                  >
                    Restore
                  </button>
                </div>
              ))}
          </details>
        )}
        <ErrorNote text={error || room.error} />
        {(!state || state.room.mode === 'rehearsal') && (
          <div className="notice">
            <span aria-hidden="true">🎈</span>
            <div>
              <strong>First, a sound check.</strong> This rehearsal tests the room, countdown, and
              everyone’s connection. No tokens are spent.
            </div>
          </div>
        )}
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
                    {state.room.phase === 'lobby'
                      ? state.room.mode === 'party'
                        ? 'Up next: Investments'
                        : 'Up next: Sound check'
                      : 'Current round'}
                  </span>
                  <Connection connected={room.connected} />
                </div>
                <h2>
                  {state.room.phase === 'lobby'
                    ? 'Waiting room'
                    : state.room.phase === 'finish'
                      ? state.room.mode === 'party'
                        ? 'Party complete'
                        : 'Rehearsal complete'
                      : state.room.title}
                  <span className="accent">.</span>
                </h2>
                <p>
                  {state.room.phase === 'lobby'
                    ? 'Get everyone into the room. When you’re ready, start the shared countdown.'
                    : state.room.phase === 'connection-check'
                      ? `${state.players.filter((p) => p.checkedIn).length} of ${state.players.length} players have checked in. You decide when to move on.`
                      : state.room.mode === 'party'
                        ? 'Manage this round below. Only the host advances the party.'
                        : 'All connected. The rehearsal is complete.'}
                </p>
                <Timer state={state} offset={room.clockOffset} />
                {state.room.status === 'pending' && (
                  <p>
                    Waiting to start. Players can prepare; their actions open when you start the
                    timer.
                  </p>
                )}
                {state.room.marketSource === 'fixture' && <p>Fixture prices · test party</p>}
                {state.room.mode === 'party' &&
                  ((state.room.phase === 'lobby' && !state.investments?.opening) ||
                    (state.room.phase === 'investment-review' && !state.investments?.closing)) && (
                    <button
                      className="button secondary"
                      onClick={async () => {
                        try {
                          setError('');
                          await post(
                            `/api/rooms/${code}/market/${state.room.phase === 'lobby' ? 'opening' : 'closing'}`,
                            {},
                          );
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    >
                      Prepare {state.room.phase === 'lobby' ? 'opening' : 'closing'} prices
                    </button>
                  )}
                {state.room.phase === 'investment-review' && state.investments?.closing && (
                  <button
                    className="button secondary"
                    disabled={room.busy}
                    onClick={() => void room.command('phase.host', { action: 'settle' })}
                  >
                    Settle investments
                  </button>
                )}
                {state.costume && state.room.status !== 'pending' && (
                  <CostumeHost
                    state={state.costume}
                    players={state.players}
                    open={state.room.status === 'open'}
                    disabled={room.busy || !room.connected}
                    allowSelfVote={state.costume.allowSelfVote}
                    onVote={() => {}}
                    onReveal={() => void room.command('phase.host', { action: 'reveal' })}
                  />
                )}
                {state.trivia && (
                  <TriviaHost
                    trivia={state.trivia}
                    command={room.command}
                    disabled={room.busy || !room.connected || state.room.status !== 'open'}
                  />
                )}
                {state.slots?.role === 'host' && <SlotsHost state={state.slots.data} />}
                {state.powerball && state.room.status !== 'pending' && (
                  <PowerballHost
                    state={state.powerball}
                    players={state.players}
                    spendable={0}
                    open={state.room.status === 'open'}
                    disabled={room.busy || !room.connected}
                    onBet={() => {}}
                    onCancel={() => {}}
                    onDraw={() => void room.command('phase.host', { action: 'draw' })}
                    onReveal={() => void room.command('phase.host', { action: 'reveal' })}
                  />
                )}
                {state.calling?.role === 'host' && (
                  <SomebodyCallingHost
                    state={state.calling.data}
                    disabled={room.busy || !room.connected}
                    command={room.command}
                  />
                )}
                <div className="actions round-actions">
                  {state.room.status === 'pending' && (
                    <button
                      className="button primary"
                      disabled={room.busy || !room.connected}
                      onClick={() => void room.command('phase.start')}
                    >
                      Start timer
                    </button>
                  )}
                  {state.room.phase !== 'lobby' &&
                    state.room.phase !== 'finish' &&
                    (state.room.status === 'open' || state.room.status === 'pending') && (
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
                      ? state.room.mode === 'party'
                        ? 'Open investments →'
                        : 'Open sound check →'
                      : state.room.phase === 'finish'
                        ? state.room.mode === 'party'
                          ? 'Party complete ✓'
                          : 'Rehearsal complete ✓'
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
                <div className="mobile-roster">
                  {state.host?.players.map((p) => (
                    <details key={p.id}>
                      <summary>
                        {p.emoji} <strong>{p.name}</strong>
                        <span>{p.connected ? 'Connected' : 'Away'}</span>
                      </summary>
                      <div className="account-details">
                        <p>Available: {p.accounts.spendable.toLocaleString()}</p>
                        <p>Invested: {p.accounts.locked.toLocaleString()}</p>
                        <p>Reserved: {p.accounts.reserved.toLocaleString()}</p>{' '}
                        <button
                          className="text-button"
                          onClick={async () => {
                            try {
                              const data = await post<{ token: string }>(
                                `/api/rooms/${code}/recovery`,
                                { playerId: p.id },
                              );
                              setRecoveryLink(
                                `${location.origin}/play?code=${code}#recover=${data.token}`,
                              );
                            } catch (err) {
                              setError((err as Error).message);
                            }
                          }}
                        >
                          Recover
                        </button>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </section>
            {recoveryLink && (
              <div className="notice">
                <p>
                  After verifying the guest’s identity, share this private one-use link directly
                  with them. It expires in ten minutes and replaces their previous sessions.
                </p>
                <input readOnly value={recoveryLink} aria-label="Private recovery link" />
                <button className="text-button" onClick={() => setRecoveryLink('')}>
                  Hide link
                </button>
              </div>
            )}
            {state.room.mode === 'party' && (
              <details className="ledger">
                <summary>Private investment positions</summary>
                {state.host?.investments.map((pos) => (
                  <p key={pos.player_id}>
                    {state.players.find((p) => p.id === pos.player_id)?.name}: {pos.asset_id},{' '}
                    {pos.principal} tokens
                    {pos.payout === null ? ' locked' : `, gross payout ${pos.payout}`}
                  </p>
                ))}
              </details>
            )}
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
function useRotatingPage(count: number, size: number) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(count / size));
  useEffect(() => {
    const timer = setInterval(() => setPage((p) => (p + 1) % pages), 8000);
    return () => clearInterval(timer);
  }, [pages]);
  return page % pages;
}
function Display() {
  const code = new URLSearchParams(location.search).get('code')?.toUpperCase() ?? null;
  const token = location.hash.slice(1);
  const room = useRoom('display', code, token);
  const state = room.state;
  const rosterPage = useRotatingPage(state?.players.length ?? 0, 8);
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
            <span className="tag">
              {state.room.code} ·{' '}
              {state.room.marketSource === 'fixture'
                ? 'Fixture party'
                : state.room.mode === 'party'
                  ? 'Party'
                  : 'Rehearsal'}
            </span>
            <Connection connected={room.connected} />
          </div>
        }
      />
      <main className={`display-main ${state.powerball ? 'has-ball-machine' : ''}`}>
        <div className="display-hero">
          <div>
            <span className="eyebrow">
              {state.room.phase === 'lobby'
                ? 'Waiting room'
                : state.room.mode === 'party'
                  ? state.room.title
                  : 'Sound check rehearsal'}{' '}
            </span>
            <h1>
              {state.room.phase === 'lobby' ? (
                <>Tracy’s 10,000th day.</>
              ) : state.room.phase === 'connection-check' ? (
                <>Sound check</>
              ) : state.room.mode === 'party' ? (
                state.room.title
              ) : (
                <>Rehearsal complete</>
              )}
            </h1>
            <p>
              {state.room.status === 'pending'
                ? 'Waiting for the host to start the timer.'
                : state.room.phase === 'lobby'
                  ? 'Join on your phone. We’ll start when everyone’s here.'
                  : state.room.phase === 'connection-check'
                    ? state.room.status === 'closed'
                      ? 'Time’s up. Your host will take it from here.'
                      : 'Tap “Check in” on your phone.'
                    : state.room.mode === 'party'
                      ? 'Follow along on your phone.'
                      : 'Sound check is complete. Waiting for the host.'}
            </p>
          </div>
          {state.room.phase === 'lobby' ? (
            <div className="display-qr">
              <Qr code={code} />
            </div>
          ) : (
            <>
              {state.room.status === 'open' ? (
                <Timer state={state} offset={room.clockOffset} />
              ) : (
                <span className="round-state">
                  {state.room.status === 'pending'
                    ? 'Starting soon'
                    : state.powerball && !state.powerball.revealed
                      ? 'Betting closed'
                      : 'Round complete'}
                </span>
              )}
            </>
          )}
        </div>
        <ErrorNote text={room.error} />
        <Ranking state={state} display />
        {state.room.status !== 'pending' && state.powerball && (
          <PowerballDisplay state={state.powerball} />
        )}
        {state.calling?.role === 'public' && <SomebodyCallingDisplay state={state.calling.data} />}
        {state.room.status !== 'pending' && state.costume && (
          <CostumeDisplay state={state.costume} />
        )}
        {state.trivia && <TriviaDisplay trivia={state.trivia} />}
        {state.room.status !== 'pending' && state.slots?.role === 'display' && (
          <SlotsDisplay state={state.slots.data} />
        )}
        {state.room.phase === 'investments' && (
          <p>
            Choose one asset and amount on your phone. Your investment remains locked until review.
          </p>
        )}
        {state.room.phase === 'investment-review' && (
          <p>The host will prepare closing prices and settle the investments.</p>
        )}
        <div className="section-heading">
          <span className="eyebrow">Players</span>
          <span>
            {state.players.length} in the room
            {state.room.phase === 'connection-check'
              ? ` · ${state.players.filter((p) => p.checkedIn).length} checked in`
              : ''}
          </span>
        </div>
        <div
          className={`guest-grid ${state.room.phase !== 'lobby' && state.room.phase !== 'connection-check' ? 'roster-during-game' : ''}`}
        >
          {state.players.slice(rosterPage * 8, rosterPage * 8 + 8).map((p) => (
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
        Tracy / 10,000 days{' '}
        <span>
          {state.room.mode === 'rehearsal'
            ? 'Sound check rehearsal · No tokens spent'
            : state.room.marketSource === 'fixture'
              ? 'Fixture prices · test party'
              : 'Party games'}
        </span>
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
