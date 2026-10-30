import { TriviaScoreboard } from './TriviaScoreboard.js';
import { RewardCoins } from './RewardCoins.js';
import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import { EMOJIS, type RoomSnapshot } from '../shared/contracts.js';
import { api, post, requestId } from './api.js';
import { useRoom } from './useRoom.js';
import { formatTokens } from './format.js';
import { InvestmentPlayer, InvestmentReviewDisplay } from './Investments.js';
import { RoundDescription } from './RoundDescription.js';
import { CostumePlayer, CostumeHost, CostumeDisplay } from './Costume.js';
import { useRotatingPage } from './useRotatingPage.js';
import { CostumeRevealDisplay, CostumeRevealHost, CostumeRevealPlayer } from './CostumeReveal.js';
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
function Connection({ connected, chinese = false }: { connected: boolean; chinese?: boolean }) {
  return (
    <span className={`connection ${connected ? 'is-online' : ''}`} role="status">
      <span />
      {chinese ? (connected ? '已连接' : '正在重连…') : connected ? 'Connected' : 'Reconnecting…'}
    </span>
  );
}
function Timer({
  state,
  offset,
  bar = false,
}: {
  state: RoomSnapshot;
  offset: number;
  bar?: boolean;
}) {
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
  const total =
    state.room.openedAt === null ? 0 : (state.room.deadlineAt - state.room.openedAt) / 1000;
  const left = total > 0 ? Math.min(1, remaining / total) : 0;
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
      {bar && total > 0 && (
        <span className="timer-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${left})` }} />
        </span>
      )}
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
          Open player view
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
          <div className="header-actions">
            <a className="subtle-link" href="/screen">
              TV display
            </a>
            <a className="subtle-link" href="/host">
              Host controls
            </a>
          </div>
        }
      />
      <main className="landing-main">
        <CelebrationMarker />
        <h1>Tracy’s 10,000th day.</h1>
        <p>A night to celebrate Tracy.</p>
        <p className="instruction">Join on your phone. We’ll start when everyone’s here.</p>
        <a className="button primary" href="/play">
          Join the games →
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
function Login({ onSuccess, display = false }: { onSuccess: () => void; display?: boolean }) {
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
      <Header right={<span className="tag">{display ? 'TV setup' : 'Private host access'}</span>} />
      <main className="form-card">
        <h1>{display ? 'Set up the TV' : 'Host controls'}</h1>
        <p>
          {display
            ? 'Sign in on this computer, then choose your party. Keep host controls open on your phone or iPad.'
            : 'Sign in to manage your room.'}
        </p>
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
            Email (optional)
            <input
              type="email"
              autoComplete="email"
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
          <p className="fine-print">Contact details stay private.</p>
          <ErrorNote text={error} />
          <button className="button primary" disabled={busy}>
            {busy ? 'Joining…' : 'Join the games'}
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
    const key = `of_recovery_request_${queryCode}`;
    const recoveryRequestId = sessionStorage.getItem(key) ?? requestId();
    sessionStorage.setItem(key, recoveryRequestId);
    post<{ roomCode: string }>(`/api/rooms/${queryCode}/recover`, {
      token,
      requestId: recoveryRequestId,
    })
      .then((data) => {
        sessionStorage.removeItem(key);
        history.replaceState(null, '', `/play?code=${queryCode}`);
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
  const [rewardBlocked, setRewardBlocked] = useState(false);
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
      {state.room.phase !== 'trivia' && <AmbientCelebration light />}
      <Header
        right={
          <div className="balance-feedback">
            <RewardCoins cue={room.rewardCue} blocked={rewardBlocked} />
            <button
              className="balance-toggle"
              aria-label={
                state.room.phase === 'trivia'
                  ? reveal
                    ? '隐藏代币余额'
                    : '显示代币余额'
                  : reveal
                    ? 'Hide token balance'
                    : 'Reveal token balance'
              }
              aria-pressed={reveal}
              onClick={() => setReveal(!reveal)}
            >
              <span>{state.room.phase === 'trivia' ? '代币' : 'Tokens'}</span>
              <strong>{reveal ? state.self.accounts.spendable.toLocaleString() : '••••'}</strong>
            </button>
          </div>
        }
      />
      <main
        key={`${state.room.phase}-${state.room.phaseInstance}`}
        className={`player-main phase-${state.room.phase} ${state.room.status !== 'pending' && ['investments', 'trivia', 'slots', 'powerball'].includes(state.room.phase) ? 'game-interaction' : ''}`}
      >
        <div className="player-meta">
          <span className="player-id">
            <span className="avatar-big">{self.emoji}</span>
            <span className="eyebrow">{self.name}</span>
          </span>
          <span className="player-status">
            <span className="tag">
              {state.room.mode === 'rehearsal' ? 'Connection check' : 'Party'} · {state.room.code}
            </span>
            {state.room.status !== 'pending' && state.room.phase !== 'lobby' && (
              <span className={`phase-pill is-${state.room.status}`}>
                {state.room.phase === 'trivia'
                  ? open
                    ? '进行中'
                    : '已结束'
                  : open
                    ? 'Open'
                    : 'Closed'}
              </span>
            )}
            <Connection connected={room.connected} chinese={state?.room.phase === 'trivia'} />
          </span>
        </div>
        <h1>
          {state.room.phase === 'lobby' ? (
            <>You’re in. Waiting for the host.</>
          ) : state.room.phase === 'connection-check' ? (
            <>Connection check</>
          ) : state.room.mode === 'party' ? (
            state.room.title
          ) : (
            <>Connection check complete</>
          )}
        </h1>
        <p className="round-instruction">
          {state.room.status === 'pending'
            ? 'Waiting for the host to start the timer.'
            : state.room.phase === 'lobby'
              ? state.self.ready
                ? 'Your host will start the games.'
                : 'Let the host know you’re ready.'
              : state.room.phase === 'connection-check'
                ? 'Tap below to check your connection. No tokens are spent.'
                : state.room.mode === 'party'
                  ? ''
                  : 'Connection check complete. Waiting for the host.'}
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
            className={`button ready-button ${state.self.ready ? 'success' : 'primary'}`}
            aria-pressed={state.self.ready}
            disabled={!room.connected || room.busy}
            onClick={() => void room.command('player.ready', { ready: !state.self!.ready })}
          >
            {state.self.ready ? '✓ Ready — you’re all set' : 'I’m ready'}
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
                ? 'Check in'
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
              busyKey={room.busyKey}
            />
          )}
        {state.costumeReveal && (
          <CostumeRevealPlayer state={state.costumeReveal} selfId={state.self.id} />
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
            onLock={() => {}}
          />
        )}
        {state.triviaScoreboard && <TriviaScoreboard data={state.triviaScoreboard} />}
        {state.trivia && (
          <TriviaPlayer
            trivia={state.trivia}
            command={room.command}
            disabled={room.busy || !room.connected || !open}
            closed={!open}
          />
        )}
        {state.room.status !== 'pending' && state.slots?.role === 'player' && (
          <SlotsPlayer
            onPresentationChange={setRewardBlocked}
            state={state.slots.data}
            spendable={state.self.accounts.spendable}
            revealBalance={reveal}
            open={open}
            disabled={room.busy || !room.connected}
            command={room.command}
          />
        )}
        {state.room.marketSource === 'fixture' && (
          <p>{state.room.phase === 'trivia' ? '本地测试派对' : 'Fixture prices · test party'}</p>
        )}
        {state.powerball && state.room.status !== 'pending' && (
          <PowerballPlayer
            onPresentationChange={setRewardBlocked}
            state={state.powerball}
            players={state.players}
            spendable={state.self.accounts.spendable}
            revealBalance={reveal}
            open={open}
            disabled={room.busy || !room.connected}
            busyKey={room.busyKey}
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
          {state.room.mode === 'rehearsal' ? 'Connection check' : 'Party'}
        </div>
      </main>
    </div>
  );
}
const RANKING_PAGE = 4;
/** Which place was announced last, so only its row plays the entrance animation. */
const newestRank = (ranking: NonNullable<RoomSnapshot['ranking']>) =>
  Math.min(...ranking.map((p) => p.rank));
function Ranking({ state, display = false }: { state: RoomSnapshot; display?: boolean }) {
  const ranking = state.ranking ?? [];
  const complete = (state.rankingStep ?? 0) >= (state.rankingSteps ?? 0);
  // The TV keeps the podium in place and rotates everyone else beneath it.
  const podium = ranking.filter((p) => p.rank <= 3);
  const rest = ranking.filter((p) => p.rank > 3);
  const page = useRotatingPage(rest.length, RANKING_PAGE);
  if (!state.ranking) return null;
  if (!ranking.length)
    return (
      <section className="ranking-wait">
        <p className="costume-locked">And the final ranking is…</p>
      </section>
    );
  const shown = display
    ? [...podium, ...rest.slice(page * RANKING_PAGE, page * RANKING_PAGE + RANKING_PAGE)]
    : ranking;
  const newest = complete ? null : newestRank(ranking);
  return (
    <section>
      {!display && <h2>Final ranking</h2>}
      <ol className="ranking-list">
        {shown.map((p) => (
          <li
            key={p.playerId}
            className={`${p.rank <= 3 ? `is-top rank-${p.rank}` : ''}${p.rank === newest ? ' is-new' : ''}`}
          >
            <span className="rank-number">{p.rank}</span>
            <span className="rank-name">
              {p.emoji} {p.name}
            </span>
            <span className="rank-tokens">{formatTokens(p.tokens)} tokens</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
/** Host: announces the podium from 3rd down, then the full list. The host always sees everyone. */
function FinishRevealHost({
  step,
  steps,
  ranking,
  disabled,
  busyKey,
  onNext,
}: {
  step: number;
  steps: number;
  ranking: NonNullable<RoomSnapshot['ranking']>;
  disabled: boolean;
  busyKey?: string | null;
  onNext: () => void;
}) {
  const ranks = [...new Set(ranking.map((p) => p.rank).filter((r) => r <= 3))].sort(
    (a, b) => b - a,
  );
  const nextRank = steps > 1 ? ranks[step] : undefined;
  const label =
    step >= steps
      ? null
      : nextRank === undefined
        ? 'Show the full ranking'
        : `Reveal ${nextRank === 1 ? '1st' : nextRank === 2 ? '2nd' : '3rd'} place`;
  return (
    <section>
      <h3>Final ranking</h3>
      <p>
        {Math.min(step, steps)} of {steps} announced.
      </p>
      {label ? (
        <button className="button primary" disabled={disabled} onClick={onNext}>
          {busyKey === 'phase.host:next' ? 'Revealing…' : label}
        </button>
      ) : (
        <p role="status">✓ The full ranking is on screen.</p>
      )}
    </section>
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
              Try again
            </a>
          </>
        ) : (
          <p>Connecting to your party.</p>
        )}
      </main>
    </div>
  );
}
const PHASE_LABELS: Record<string, string> = {
  lobby: 'Waiting room',
  'connection-check': 'Connection check',
  investments: 'Investments',
  costume: 'Costume voting',
  'costume-reveal': 'Costume winners',
  trivia: 'Jeopardy · 团队抢答',
  'trivia-scoreboard': '团队积分榜',
  slots: 'Slots',
  powerball: 'Powerball',
  'investment-review': 'Closing bell',
  'somebody-calling': 'Somebody’s calling',
  finish: 'Finished',
};
const roomSummary = (r: { mode: string; phase: string }) =>
  `${r.mode === 'rehearsal' ? 'Connection check' : 'Party'} · ${PHASE_LABELS[r.phase] ?? r.phase}`;
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
  // Requests outside the command channel: market prices, TV link, recovery link.
  const [hostBusy, setHostBusy] = useState<string | null>(null);
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
    if (
      !confirm(
        'Create a new TV link? If a TV is already showing this party, its current link stops working and the TV must open the new link.',
      )
    )
      return;
    setHostBusy('display-link');
    setError('');
    try {
      const data = await post<{ displayToken: string }>(`/api/rooms/${code}/display-link`, {});
      localStorage.setItem(`of_display_${code}`, data.displayToken);
      setDisplayToken(data.displayToken);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setHostBusy(null);
    }
  }
  async function prepareMarket(kind: 'opening' | 'closing') {
    setHostBusy('market');
    setError('');
    try {
      await post(`/api/rooms/${code}/market/${kind}`, {});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setHostBusy(null);
    }
  }
  async function makeRecoveryLink(playerId: string) {
    setHostBusy(`recovery:${playerId}`);
    setError('');
    try {
      const data = await post<{ token: string }>(`/api/rooms/${code}/recovery`, { playerId });
      setRecoveryLink(`${location.origin}/play?code=${code}#recover=${data.token}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setHostBusy(null);
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
            <span className="tag">
              {state?.room.phase === 'trivia' ? '主持人控制台' : 'Host controls'}
            </span>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await post('/api/logout', {});
                  setSession({ authenticated: false });
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              Sign out
            </button>
          </div>
        }
      />
      <main className="host-main">
        <div className="host-heading">
          <div>
            <span className="eyebrow">
              {state?.room.phase === 'trivia' ? '主持人私密视图' : 'Private host view'}
            </span>
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
                        {r.code} · {roomSummary(r)}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button primary"
                disabled={creating}
                onClick={() => void create('party')}
              >
                {creating ? 'Creating…' : '+ New party'}
              </button>
              {enabled && (
                <details className="test-tools">
                  <summary>Test tools</summary>
                  <p>
                    Connection check: lobby, timer and check-in only. Full test party: all games
                    with sample prices.
                  </p>
                  <div className="actions">
                    <button
                      className="button secondary"
                      disabled={creating}
                      onClick={() => void create('rehearsal')}
                    >
                      + Connection check
                    </button>
                    <button
                      className="button secondary"
                      disabled={creating}
                      onClick={() => void create('party', 'fixture')}
                    >
                      + Full test party
                    </button>
                  </div>
                </details>
              )}
              {code && (
                <button
                  className="button secondary"
                  disabled={
                    archiving || room.busy || !state || state.players.some((p) => p.connected)
                  }
                  onClick={() => void archiveRoom(code, true)}
                >
                  {archiving ? 'Archiving…' : 'Archive party'}
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
                    <strong>{r.code}</strong> · {roomSummary(r)}
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
            <div>
              <strong>First, a connection check.</strong> This tests the room, countdown, and
              everyone’s connection. No tokens are spent.
            </div>
          </div>
        )}
        {!state ? (
          <section className="empty-state">
            <h2>{code ? 'Connecting to your room…' : 'No room selected'}</h2>
            <p>
              {code
                ? 'Your party will appear here in a moment.'
                : 'Create a connection check, open the TV view, and invite a few phones.'}
            </p>
          </section>
        ) : (
          <>
            <div className={`host-grid ${state.room.phase !== 'lobby' ? 'in-game' : ''}`}>
              <section className="panel round-panel">
                <div className="section-heading">
                  <span className="eyebrow">
                    {state.room.phase === 'lobby'
                      ? state.room.mode === 'party'
                        ? 'Up next: Investments'
                        : 'Up next: Connection check'
                      : state.room.phase === 'trivia'
                        ? '当前环节'
                        : 'Current round'}
                  </span>
                  <Connection connected={room.connected} chinese={state?.room.phase === 'trivia'} />
                </div>
                {state.room.phase === 'lobby' && (
                  <>
                    <p className="host-lobby-intro">
                      Get everyone into the room, prepare opening prices, then open the first game.
                    </p>
                  </>
                )}
                {state.room.phase === 'connection-check' && (
                  <p>
                    {state.players.filter((p) => p.checkedIn).length} of {state.players.length}{' '}
                    checked in.
                  </p>
                )}
                <Timer state={state} offset={room.clockOffset} />
                {state.room.status === 'pending' && (
                  <p>
                    Waiting to start. Players can prepare; their actions open when you start the
                    timer.
                  </p>
                )}
                {state.room.marketSource === 'fixture' && (
                  <p>
                    {state.room.phase === 'trivia' ? '本地测试派对' : 'Fixture prices · test party'}
                  </p>
                )}
                {state.room.mode === 'party' &&
                  (state.room.phase === 'lobby' ||
                    (state.room.phase === 'investments' && state.room.status === 'pending') ||
                    (state.room.phase === 'investment-review' &&
                      !state.investments?.closing &&
                      !state.investments?.refunded)) && (
                    <button
                      className="button secondary"
                      disabled={hostBusy === 'market'}
                      onClick={() =>
                        void prepareMarket(
                          state.room.phase === 'investment-review' ? 'closing' : 'opening',
                        )
                      }
                    >
                      {hostBusy === 'market'
                        ? 'Loading prices…'
                        : `${state.room.phase !== 'investment-review' && state.investments?.opening ? 'Refresh' : 'Prepare'} ${state.room.phase === 'investment-review' ? 'closing' : 'opening'} prices`}
                    </button>
                  )}
                {state.room.mode === 'party' &&
                  ['lobby', 'investments', 'investment-review'].includes(state.room.phase) &&
                  (state.room.phase === 'investment-review'
                    ? state.investments?.closing
                    : state.investments?.opening) && (
                    <p className="fine-print" role="status">
                      ✓ {state.room.phase === 'investment-review' ? 'Closing' : 'Opening'} prices
                      saved at{' '}
                      {new Date(
                        (state.room.phase === 'investment-review'
                          ? state.investments!.closing!
                          : state.investments!.opening!
                        ).fetchedAt,
                      ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      .
                    </p>
                  )}
                {state.room.phase === 'investment-review' &&
                  !state.investments?.closing &&
                  (state.investments?.refunded ? (
                    <p role="status">✓ Investments refunded at cost.</p>
                  ) : (
                    state.host?.investments.some((p) => p.payout === null) && (
                      <div className="refund-fallback">
                        <p className="fine-print">
                          If closing prices won’t load, return every stake in full instead.
                        </p>
                        <button
                          className="button secondary"
                          disabled={room.busy}
                          onClick={() => {
                            if (
                              confirm(
                                'Refund all investments? Every player gets back exactly what they invested, with no gain or loss. This cannot be undone.',
                              )
                            )
                              void room.command('phase.host', { action: 'refund' });
                          }}
                        >
                          {room.busyKey === 'phase.host:refund'
                            ? 'Refunding…'
                            : 'Refund all investments'}
                        </button>
                      </div>
                    )
                  ))}
                {state.room.phase === 'investment-review' &&
                  state.investments?.closing &&
                  (state.host?.investments.every((p) => p.payout !== null) ? (
                    <p role="status">✓ Investments settled.</p>
                  ) : (
                    <button
                      className="button secondary"
                      disabled={room.busy}
                      onClick={() => void room.command('phase.host', { action: 'settle' })}
                    >
                      {room.busyKey === 'phase.host:settle' ? 'Settling…' : 'Settle investments'}
                    </button>
                  ))}
                {state.costumeReveal && (
                  <CostumeRevealHost
                    state={state.costumeReveal}
                    disabled={room.busy || !room.connected}
                    busyKey={room.busyKey}
                    onNext={() =>
                      void room.command('phase.host', {
                        action: 'next',
                        data: { step: state.costumeReveal!.step },
                      })
                    }
                  />
                )}
                {state.room.phase === 'finish' &&
                  state.room.mode === 'party' &&
                  state.rankingStep !== undefined &&
                  state.rankingSteps !== undefined && (
                    <FinishRevealHost
                      step={state.rankingStep}
                      steps={state.rankingSteps}
                      ranking={state.ranking ?? []}
                      disabled={room.busy || !room.connected}
                      busyKey={room.busyKey}
                      onNext={() =>
                        void room.command('phase.host', {
                          action: 'next',
                          data: { step: state.rankingStep },
                        })
                      }
                    />
                  )}
                {state.costume && state.room.status !== 'pending' && (
                  <CostumeHost
                    state={state.costume}
                    players={state.players}
                    open={state.room.status === 'open'}
                    disabled={room.busy || !room.connected}
                    busyKey={room.busyKey}
                    allowSelfVote={state.costume.allowSelfVote}
                    onVote={() => {}}
                    onLock={() => void room.command('phase.host', { action: 'lock' })}
                    onRevote={() => void room.command('phase.host', { action: 'revote' })}
                  />
                )}
                {state.triviaScoreboard && <TriviaScoreboard data={state.triviaScoreboard} />}
                {state.trivia && (
                  <TriviaHost
                    trivia={state.trivia}
                    command={room.command}
                    disabled={room.busy || !room.connected || state.room.status !== 'open'}
                    clockOffset={room.clockOffset}
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
                    busyKey={room.busyKey}
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
                    busyKey={room.busyKey}
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
                      {room.busyKey === 'phase.start:' ? 'Starting…' : 'Start timer'}
                    </button>
                  )}
                  {state.room.phase !== 'lobby' &&
                    state.room.phase !== 'finish' &&
                    (state.room.status === 'open' || state.room.status === 'pending') && (
                      <button
                        className="button secondary"
                        disabled={room.busy || !room.connected || !!state.trivia?.board?.selected}
                        onClick={() => void room.command('phase.close')}
                      >
                        {room.busyKey === 'phase.close:'
                          ? state.room.phase === 'trivia'
                            ? '结束中…'
                            : 'Closing…'
                          : state.room.phase === 'trivia'
                            ? '结束问答'
                            : 'Close round'}
                      </button>
                    )}
                  <button
                    className="button primary"
                    disabled={room.busy || !room.connected || !state.room.canAdvance}
                    onClick={() => void room.command('phase.advance')}
                  >
                    {room.busyKey === 'phase.advance:'
                      ? state.room.phase === 'trivia'
                        ? '正在进入下一环节…'
                        : 'Opening…'
                      : state.room.phase === 'lobby'
                        ? state.room.mode === 'party'
                          ? 'Open investments →'
                          : 'Open connection check →'
                        : state.room.phase === 'finish'
                          ? state.room.mode === 'party'
                            ? 'Party complete ✓'
                            : 'Connection check complete ✓'
                          : state.room.phase === 'trivia'
                            ? '下一环节 →'
                            : 'Next stage →'}
                  </button>
                </div>
                {state.room.advanceBlocker && state.room.phase !== 'finish' && (
                  <p className="fine-print">
                    {state.room.phase === 'trivia' &&
                    state.room.status !== 'closed' &&
                    state.trivia?.board?.selected
                      ? '请完成当前题目并结束问答，再进入下一环节。'
                      : state.room.advanceBlocker}
                  </p>
                )}
              </section>
              <section className="panel invite-panel">
                {state.room.phase === 'lobby' ? (
                  <>
                    <h2>Join this room</h2>
                    <Qr code={state.room.code} />
                  </>
                ) : (
                  <details className="connection-help">
                    <summary>Connections &amp; rejoining</summary>
                    <p>
                      New registration is closed. Returning players can reopen their original tab.
                      For a lost session, use a recovery link in the player list below.
                    </p>
                    <p>Disconnected players keep their tokens, investments and team.</p>
                  </details>
                )}
                <a
                  className="button secondary"
                  target="_blank"
                  rel="noreferrer"
                  href={`/screen?code=${state.room.code}${displayToken ? `#${displayToken}` : ''}`}
                >
                  Open TV display ↗
                </a>
                <p className="fine-print">
                  Using a separate computer? Open <strong>/screen</strong> there, sign in with the
                  host password and choose party <strong>{state.room.code}</strong>. Your phone
                  stays signed in. Guests scan the join QR on the TV.
                </p>
                {!displayToken && (
                  <details>
                    <summary>TV link without signing in</summary>
                    <button
                      className="button secondary"
                      disabled={hostBusy === 'display-link'}
                      onClick={() => void makeDisplayLink()}
                    >
                      {hostBusy === 'display-link' ? 'Creating link…' : 'Create TV link'}
                    </button>
                    <p className="fine-print">
                      This browser has no TV link for this party. A new link replaces any link a TV
                      is already using.
                    </p>
                  </details>
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
                          disabled={hostBusy === `recovery:${p.id}`}
                          onClick={() => void makeRecoveryLink(p.id)}
                        >
                          {hostBusy === `recovery:${p.id}` ? 'Creating link…' : 'Recover'}
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
                  <p key={`${pos.player_id}:${pos.asset_id}`}>
                    {state.players.find((p) => p.id === pos.player_id)?.name}:{' '}
                    {state.investments?.assets.find((a) => a.provider_id === pos.asset_id)
                      ?.symbol ?? pos.asset_id}
                    , {pos.principal} tokens
                    {pos.payout === null ? ' locked' : `, gross payout ${pos.payout}`}
                  </p>
                ))}
              </details>
            )}
            <details className="ledger">
              <summary>Token activity</summary>
              <p className="fine-print">Saved activity for this party.</p>
              {state.host?.ledger.map((entry) => (
                <div className="ledger-row" key={entry.id}>
                  <span>
                    {state.players.find((p) => p.id === entry.playerId)?.name} · {entry.reason}
                  </span>
                  <strong>{formatTokens(entry.spendable, { signed: true })}</strong>
                </div>
              ))}
            </details>
          </>
        )}
      </main>
    </div>
  );
}
/** Balloons and fireworks behind content on every stage; `light` is the smaller phone version. */
function AmbientCelebration({ light = false }: { light?: boolean }) {
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return (
    <div
      className={`ambient-celebration ${light ? 'is-light' : ''} ${hidden ? 'is-paused' : ''}`}
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <span key={`balloon-${i}`} className={`ambient-balloon balloon-${i}`} />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={`firework-${i}`} className={`lobby-firework firework-${i}`} />
      ))}
    </div>
  );
}
/** Authors the TV on a fixed 1920×1080 stage and scales it to fit, so every round keeps its composition. */
function DisplayFrame({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState<number | null>(null);
  useEffect(() => {
    const fit = () => {
      const { innerWidth: w, innerHeight: h } = window;
      setScale(w > 1000 && w / h >= 1.2 ? Math.min(w / 1920, h / 1080) : null);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  if (scale === null) return <>{children}</>;
  return (
    <div className="tv-viewport">
      <div className="tv-frame" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
function Display() {
  const code = new URLSearchParams(location.search).get('code')?.toUpperCase() ?? null;
  const token = location.hash.slice(1);
  return code && token ? <DisplayRoom code={code} token={token} /> : <DisplaySetup code={code} />;
}
function DisplaySetup({ code }: { code: string | null }) {
  const { session, setSession, error: sessionError } = useSession('host');
  const [rooms, setRooms] = useState<RoomListItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!session?.authenticated || code) return;
    api<{ rooms: RoomListItem[] }>('/api/rooms')
      .then((data) => setRooms(data.rooms.filter((r) => !r.archived)))
      .catch((err) => setError(err.message));
  }, [session?.authenticated, code]);
  if (!session) return <Loading error={sessionError} />;
  if (!session.authenticated)
    return <Login display onSuccess={() => setSession({ authenticated: true })} />;
  if (code) return <DisplayRoom code={code} />;
  return (
    <div className="page">
      <Header right={<span className="tag">TV setup</span>} />
      <main className="form-card">
        <h1>Choose your party</h1>
        <p>Match the room code on your phone. Only the public game view will appear here.</p>
        <ErrorNote text={error} />
        <nav className="tv-party-list" aria-label="Choose party for TV">
          {rooms?.map((r) => (
            <a className="button secondary" key={r.id} href={`/screen?code=${r.code}`}>
              {r.code} · {roomSummary(r)} →
            </a>
          ))}
        </nav>
        {!rooms && !error && <p>Loading parties…</p>}
        {rooms?.length === 0 && (
          <p>Create a party in host controls on your phone, then reload this page.</p>
        )}
        <p className="fine-print">
          Keep this tab on the TV and control the games from your phone or iPad. Guests join through
          the QR code in the lobby.
        </p>
      </main>
    </div>
  );
}
function DisplayRoom({ code, token }: { code: string; token?: string }) {
  const room = useRoom('display', code, token);
  const state = room.state;
  const isTrivia = state?.room.phase === 'trivia' || state?.room.phase === 'trivia-scoreboard';
  const rosterPage = useRotatingPage(state?.players.length ?? 0, 8);
  if (!state)
    return (
      <>
        <Loading error={room.error} />
        {room.error && (
          <p className="tv-reconnect">
            <a className="subtle-link" href="/screen">
              Set up TV again
            </a>
          </p>
        )}
      </>
    );
  return (
    <DisplayFrame>
      <div className={`page display-page ${isTrivia ? 'is-trivia' : ''}`}>
        <AmbientCelebration />
        {isTrivia ? (
          <header className="trivia-display-header">
            <Brand />
            <h1>{state.room.title}</h1>
            <div className="header-actions">
              {state.trivia?.demo && <span className="trivia-demo-label">演示</span>}
              {!room.connected && <Connection connected={false} chinese />}
            </div>
          </header>
        ) : (
          <Header
            right={
              <div className="header-actions">
                <span className="tag">
                  {state.room.code} ·{' '}
                  {state.room.marketSource === 'fixture'
                    ? state.room.phase === 'trivia'
                      ? '测试派对'
                      : 'Fixture party'
                    : state.room.mode === 'party'
                      ? 'Party'
                      : 'Connection check'}
                </span>
                <Connection connected={room.connected} chinese={state?.room.phase === 'trivia'} />
              </div>
            }
          />
        )}
        <main
          className={`display-main phase-${state.room.phase} ${state.powerball ? 'has-ball-machine' : ''}`}
        >
          {!isTrivia && (
            <div className="display-hero">
              <div>
                {state.room.phase === 'lobby' && <span className="eyebrow">Waiting room</span>}
                <h1>
                  {state.room.phase === 'lobby' ? (
                    <>Tracy’s 10,000th day.</>
                  ) : state.room.phase === 'connection-check' ? (
                    <>Connection check</>
                  ) : state.room.mode === 'party' ? (
                    state.room.title
                  ) : (
                    <>Connection check complete</>
                  )}
                </h1>
              </div>
              {state.room.phase === 'lobby' ? (
                <div className="display-qr">
                  <Qr code={code} />
                </div>
              ) : (
                <>
                  {state.room.status === 'open' ? (
                    <Timer state={state} offset={room.clockOffset} bar />
                  ) : (
                    <span className="round-state">
                      {state.room.status === 'pending'
                        ? 'Starting soon'
                        : state.powerball && !state.powerball.revealed
                          ? 'Betting closed'
                          : ''}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          <ErrorNote text={room.error} />
          <div
            key={state.room.phase}
            className={`display-stage ${['lobby', 'connection-check', 'investments'].includes(state.room.phase) ? 'is-intro' : ''}`}
          >
            {!isTrivia && (
              <aside className="display-instructions">
                <RoundDescription state={state} />
              </aside>
            )}
            <div className="display-content">
              {state.slots?.role === 'display' && (
                <SlotsDisplay state={state.slots.data} roomPlayers={state.players.length} />
              )}
              {state.room.phase === 'costume' &&
                !state.costume?.locked &&
                !state.costume?.candidates && (
                  <div className="display-ghost" aria-hidden="true">
                    <span className="ghost-arm ghost-arm-left" />
                    <span className="ghost-arm ghost-arm-right" />
                    <span className="ghost-face">
                      <i />
                      <i />
                    </span>
                    <span className="ghost-cheeks" />
                    <span className="ghost-smile" />
                    <span className="ghost-bow" />
                    <span className="ghost-hem">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                )}
              <Ranking state={state} display />
              {state.room.status !== 'pending' && state.powerball && (
                <PowerballDisplay state={state.powerball} />
              )}
              {state.calling?.role === 'public' && (
                <SomebodyCallingDisplay state={state.calling.data} />
              )}
              {state.room.status !== 'pending' && state.costume && (
                <CostumeDisplay state={state.costume} />
              )}
              {state.costumeReveal && <CostumeRevealDisplay state={state.costumeReveal} />}
              {state.triviaScoreboard && <TriviaScoreboard data={state.triviaScoreboard} />}
              {state.trivia && (
                <TriviaDisplay
                  trivia={state.trivia}
                  closed={state.room.status === 'closed'}
                  clockOffset={room.clockOffset}
                />
              )}
              {state.room.phase === 'investment-review' && state.investments && (
                <InvestmentReviewDisplay data={state.investments} />
              )}
              {['lobby', 'connection-check'].includes(state.room.phase) && (
                <div className="section-heading">
                  <span className="eyebrow">Players</span>
                  <span>
                    {state.players.length} in the room
                    {state.room.phase === 'connection-check'
                      ? ` · ${state.players.filter((p) => p.checkedIn).length} checked in`
                      : ''}
                  </span>
                </div>
              )}
              {['lobby', 'connection-check'].includes(state.room.phase) ? (
                <div className="guest-grid">
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
              ) : (
                !!state.players.length &&
                state.room.phase !== 'finish' &&
                !isTrivia && (
                  <div className="roster-strip">
                    <span className="roster-faces" aria-hidden="true">
                      {state.players.slice(0, 16).map((p) => (
                        <i key={p.id} className={p.connected ? '' : 'is-away'}>
                          {p.emoji}
                        </i>
                      ))}
                    </span>
                    <span>
                      {state.room.phase === 'trivia'
                        ? `${state.players.length} 位玩家在场`
                        : `${state.players.length} ${state.players.length === 1 ? 'player' : 'players'} in the room`}
                    </span>
                  </div>
                )
              )}
              {!state.players.length && !isTrivia && (
                <p className="empty-copy">No players yet. Scan the code to join.</p>
              )}
            </div>
          </div>
        </main>
        {!isTrivia && (
          <footer className="display-footer">
            Tracy / 10,000 days{' '}
            <span>
              {state.room.mode === 'rehearsal'
                ? 'Connection check · No tokens spent'
                : state.room.marketSource === 'fixture'
                  ? state.room.phase === 'trivia'
                    ? '本地测试派对'
                    : 'Fixture prices · test party'
                  : state.room.phase === 'trivia'
                    ? 'Trivia'
                    : 'Party games'}
            </span>
          </footer>
        )}
      </div>
    </DisplayFrame>
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
