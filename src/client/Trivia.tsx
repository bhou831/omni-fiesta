import React, { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { TriviaBoard, TriviaProjection } from '../server/games/trivia.js';
import type { CommandSender } from '../shared/contracts.js';
import { formatTokens } from './format.js';
import { AdventureHost, AdventureStage } from './TriviaAdventure.js';
import { TriviaLocation, type TriviaLocationView } from './TriviaLocation.js';

export type TriviaViewProps = {
  trivia: TriviaProjection;
  command: CommandSender;
  disabled: boolean;
  clockOffset?: number;
  audioUrl?: string;
};
/** Decorative only: it never opens the real buzzer or shows a saved clue. */
function JeopardyIntroArt() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return (
    <svg
      className={`jeopardy-intro-art ${visible ? '' : 'is-paused'}`}
      viewBox="0 0 440 300"
      aria-hidden="true"
    >
      <rect className="intro-board-frame" x="42" y="16" width="356" height="190" rx="16" />
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2, 3, 4].map((column) => (
          <g
            className="intro-clue"
            key={`${row}-${column}`}
            style={{ '--clue-delay': `${(row * 5 + column) * 0.16}s` } as CSSProperties}
          >
            <rect x={58 + column * 66} y={32 + row * 54} width="60" height="46" rx="5" />
            <text x={88 + column * 66} y={63 + row * 54} textAnchor="middle">
              ?
            </text>
          </g>
        )),
      )}
      <ellipse className="intro-buzzer-shadow" cx="220" cy="282" rx="82" ry="9" />
      <path
        className="intro-buzzer-base"
        d="M142 265 Q142 247 161 247 H279 Q298 247 298 265 V274 H142Z"
      />
      <g className="intro-buzzer-cap">
        <path d="M165 247 V234 Q165 208 220 208 Q275 208 275 234 V247Z" />
        <ellipse cx="220" cy="233" rx="55" ry="24" />
      </g>
      <g className="intro-buzzer-rays">
        <path d="M139 224 L122 213 M301 224 L318 213 M220 192 V178" />
      </g>
    </svg>
  );
}
function TeamList({ trivia }: { trivia: TriviaProjection }) {
  return (
    <div className="team-list">
      {trivia.teams.map((team) => (
        <p key={team.id}>
          <strong style={{ color: team.color }}>{team.name}</strong>
          {team.excluded ? ' · 本题已答错' : ''}：
          {team.members.map((p) => `${p.emoji} ${p.name}`).join('、')}
        </p>
      ))}
    </div>
  );
}
function BuzzStatus({ trivia }: { trivia: TriviaProjection }) {
  const team = trivia.teams.find((t) => t.id === trivia.winner?.teamId);
  const winner = team?.members.find((p) => p.id === trivia.winner?.playerId);
  return (
    <p role="status">
      {winner
        ? `${winner.emoji} ${winner.name} 为${team!.name}抢答成功，请口头回答。`
        : trivia.status === 'armed'
          ? '抢答已开启'
          : trivia.teams.length
            ? '看大屏幕，等待主持人。'
            : '等待主持人分队。'}
    </p>
  );
}
export function TriviaPlayer({
  trivia,
  command,
  disabled,
  closed = false,
}: TriviaViewProps & { closed?: boolean }) {
  const team = trivia.teams.find((t) => t.id === trivia.ownTeamId);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const canBuzz =
    team && !team.excluded && trivia.status === 'armed' && !disabled && !pending && !closed;
  const buzz = async () => {
    if (lock.current || !canBuzz) return;
    lock.current = true;
    setPending(true);
    try {
      await command('phase.action', {
        action: 'buzz',
        data: { windowId: trivia.windowId },
      });
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    <section
      lang="zh-CN"
      className="trivia-player"
      style={{ '--team-color': team?.color ?? '#202020' } as CSSProperties}
    >
      <h2>{team ? <span style={{ color: team.color }}>{team.name}</span> : '等待分队'}</h2>
      {trivia.demo && <span className="trivia-phone-demo">演示</span>}
      <p role="status" aria-live="polite">
        {closed
          ? '本轮结束'
          : trivia.adventure &&
              trivia.status !== 'armed' &&
              trivia.adventure.phase !== 'waiting' &&
              trivia.adventure.phase !== 'steal' &&
              !(
                trivia.winner &&
                (trivia.adventure.phase === 'rules' || trivia.adventure.phase === 'active')
              )
            ? `${trivia.adventure.title} · ${trivia.adventure.phase === 'rules' ? '请听规则' : trivia.adventure.phase === 'active' ? '挑战进行中' : trivia.adventure.success ? '挑战成功' : '挑战结束'}`
            : team?.excluded
              ? '本题已答错，等待下一题'
              : trivia.winner
                ? trivia.winner.teamId === trivia.ownTeamId
                  ? '本队抢答成功'
                  : `${trivia.teams.find((other) => other.id === trivia.winner?.teamId)?.name ?? '其他队'}抢答成功`
                : pending
                  ? '提交中…'
                  : trivia.status === 'armed'
                    ? '可以抢答'
                    : '等待主持人'}
      </p>
      <button
        className="button primary trivia-buzzer"
        disabled={!canBuzz}
        onClick={() => void buzz()}
      >
        {pending ? '提交中…' : '抢答'}
      </button>
    </section>
  );
}
function Board({
  board,
  onSelect,
  disabled,
}: {
  board: TriviaBoard;
  onSelect?: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="jeopardy-grid" aria-label="五类五级题板">
      {board.categories.map((category) => (
        <div className="jeopardy-column" key={category.id}>
          <h3>{category.name}</h3>
          {board.cells
            .filter((cell) => cell.categoryId === category.id)
            .map((cell) => {
              const label = `${category.name} ${formatTokens(cell.value)}${cell.used ? ' · 已完成' : !cell.available ? ' · 待准备' : ''}`;
              return onSelect ? (
                <button
                  key={cell.id}
                  aria-label={label}
                  className={`jeopardy-cell ${cell.used ? 'is-used' : ''}`}
                  disabled={disabled || cell.used || !cell.available}
                  onClick={() => onSelect(cell.id)}
                >
                  {formatTokens(cell.value)}
                  <small>{cell.used ? '已完成' : !cell.available ? '待准备' : '选择'}</small>
                </button>
              ) : (
                <div
                  key={cell.id}
                  aria-label={label}
                  className={`jeopardy-cell ${cell.used ? 'is-used' : ''} ${!cell.available ? 'is-unavailable' : ''}`}
                >
                  {cell.used ? <span aria-hidden="true">—</span> : formatTokens(cell.value)}
                  {!cell.used && !cell.available && <small>待准备</small>}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
/** The server supplies role-safe fields; the TV leads with the prompt or revealed answer. */
function Question({ board, host = false }: { board: TriviaBoard; host?: boolean }) {
  const clue = board.selected;
  if (!clue) return null;
  const revealed = !host && !!clue.answer;
  const length = clue.publicPrompt.length;
  return (
    <article
      className={`trivia-question ${revealed ? 'is-revealed' : ''} ${length > 120 ? 'is-long' : length > 60 ? 'is-medium' : ''}`}
    >
      <p className="trivia-question-context">
        {board.categories.find((c) => c.id === clue.categoryId)?.name} · {formatTokens(clue.value)}{' '}
        分
      </p>
      <h2 className="trivia-prompt">{clue.publicPrompt}</h2>
      {clue.questionImage && (
        <img
          className="trivia-question-image"
          src={clue.questionImage}
          alt="题目图片：摩尔庄园角色"
        />
      )}
      {clue.questionVideo && (
        <video
          className="trivia-question-video"
          src={clue.questionVideo}
          controls
          playsInline
          preload="metadata"
          aria-label="题目视频"
        />
      )}
      {clue.answer && (
        <div className="trivia-answer">
          <strong>{host ? '主持人答案（私密）' : '答案'}</strong>
          <p>{clue.answer}</p>
          {host && clue.hostNotes && <p>{clue.hostNotes}</p>}
        </div>
      )}
    </article>
  );
}
function MusicClip({
  url,
  start,
  end,
  playing,
  position,
  changedAt,
  track,
  storeUrl,
  host,
  onHost,
  cellId,
  disabled,
}: {
  url: string;
  start: number;
  end: number;
  playing: boolean;
  position: number;
  changedAt: number;
  track?: NonNullable<TriviaBoard['selected']>['musicTrack'];
  storeUrl?: string;
  host?: boolean;
  onHost?: (action: string, data?: Record<string, unknown>) => Promise<void>;
  cellId?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [clipEnded, setClipEnded] = useState(false);
  const duration = end - start;
  const playbackActive = playing && !clipEnded;
  useEffect(() => {
    setClipEnded(false);
    if (!playing) return;
    const timeout = window.setTimeout(
      () => setClipEnded(true),
      Math.max(0, (duration - position) * 1000),
    );
    return () => window.clearTimeout(timeout);
  }, [playing, position, changedAt, duration]);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.currentTime = Math.min(end, start + position);
    if (playbackActive && enabled) {
      void audio
        .play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    } else audio.pause();
  }, [playbackActive, position, changedAt, enabled, start, end]);
  return (
    <section className="trivia-music-playback" aria-label="听歌识曲播放">
      <audio
        ref={ref}
        preload="metadata"
        aria-label="听歌识曲片段"
        onLoadedMetadata={() => {
          if (ref.current) ref.current.currentTime = start + position;
        }}
        onTimeUpdate={() => {
          if (ref.current && ref.current.currentTime >= end) ref.current.pause();
        }}
        src={url}
      />
      {host && onHost && cellId && (
        <div className="trivia-music-host-controls">
          <button
            className="button primary"
            disabled={disabled}
            onClick={() => void onHost(playbackActive ? 'music-stop' : 'music-start', { cellId })}
          >
            {playbackActive ? '结束播放' : '播放试听'}
          </button>
          <button className="button secondary" disabled={enabled} onClick={() => setEnabled(true)}>
            {enabled ? '本机声音已启用' : '启用本机声音'}
          </button>
        </div>
      )}
      {!enabled && !host && (
        <button className="button secondary" onClick={() => setEnabled(true)}>
          启用大屏声音
        </button>
      )}
      {blocked && <p role="status">浏览器拦截了自动播放，请点“启用大屏声音”。</p>}
      <p role="status">
        {playbackActive
          ? `主持人正在播放 · 约 ${Math.ceil(duration - position)} 秒`
          : position > 0 || clipEnded
            ? '试听已暂停'
            : '等待主持人播放'}
      </p>
      {storeUrl ? (
        <>
          <p>Preview provided courtesy of iTunes.</p>
          <p>
            <a href={storeUrl} target="_blank" rel="noreferrer">
              在 Apple Music 查看此曲
            </a>
          </p>
          {track && (
            <p>
              {track.title} · {track.artist} — {track.album}
            </p>
          )}
        </>
      ) : (
        <p>演示音频</p>
      )}
    </section>
  );
}
function TriviaQuestionPanel({ children }: { children: ReactNode }) {
  return (
    <fieldset className="control-group">
      <legend>题目</legend>
      {children}
    </fieldset>
  );
}
function TriviaBuzzerAndReveal({ children }: { children: ReactNode }) {
  return (
    <fieldset className="control-group">
      <legend>抢答与公布答案</legend>
      {children}
    </fieldset>
  );
}
function TriviaScoreAndCorrections({ children }: { children: ReactNode }) {
  return (
    <fieldset className="control-group">
      <legend>记分与修正</legend>
      {children}
    </fieldset>
  );
}
export function TriviaHost({
  trivia,
  command,
  disabled,
  clockOffset = 0,
  audioUrl,
}: TriviaViewProps) {
  const [count, setCount] = useState(String(trivia.teams.length || trivia.defaultTeamCount || 1));
  const [teamChoice, setTeamChoice] = useState({ context: '', id: '' });
  const [amount, setAmount] = useState('100');
  const [correction, setCorrection] = useState('');
  const [acknowledgedAward, setAcknowledgedAward] = useState<{
    signature: string;
    id: string;
  } | null>(null);
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState('');
  const lock = useRef(false);
  const board = trivia.board;
  const selected = board?.selected;
  const history = trivia.awardHistory ?? [];
  const awardCellId = correction || selected?.id;
  const awardCell = board?.cells.find((c) => c.id === awardCellId);
  // A fresh buzz selects its winner. Manual overrides belong only to that question/window.
  const teamContext = `${trivia.question}:${trivia.windowId}:${trivia.winner?.teamId ?? ''}:${correction}`;
  const team =
    teamChoice.context === teamContext && trivia.teams.some((t) => String(t.id) === teamChoice.id)
      ? teamChoice.id
      : String(
          trivia.winner?.teamId ??
            (trivia.adventure?.success ? trivia.adventure.teamId : null) ??
            '',
        );
  const awardSignature = board ? (awardCellId ?? '') : `${trivia.question}:${team}:${amount}`;
  const alreadyAwarded =
    (board
      ? history.some((a) => !a.undone && a.cellId === awardCellId)
      : history.some(
          (a) =>
            !a.undone &&
            a.question === trivia.question &&
            a.teamId === Number(team) &&
            a.amount === Number(amount),
        )) ||
    (acknowledgedAward?.signature === awardSignature &&
      !history.some((a) => a.id === acknowledgedAward.id));
  const busy = disabled || !!pending;
  const host = async (action: string, data: Record<string, unknown> = {}) => {
    if (disabled || lock.current) return;
    lock.current = true;
    setPending(action);
    setFeedback('');
    try {
      const receipt = await command('phase.host', {
        action,
        data: { ...(selected ? { cellId: selected.id } : {}), ...data },
      });
      if (!receipt) return;
      if (action === 'award' && typeof receipt.result.awardId === 'string')
        setAcknowledgedAward({ signature: awardSignature, id: receipt.result.awardId });
      if (action === 'undo-award') setAcknowledgedAward(null);
      const messages: Record<string, string> = {
        assign: '分队已保存。',
        'show-board': '题板已显示在大屏幕。',
        'set-demo-mode': data.demo ? '演示模式已开启，类别已隐藏。' : '已切换到本机正式题库。',
        'select-cell': '题目已选定。',
        'cancel-selection': '已返回题板，此格仍可选择。',
        arm: '抢答已开启。',
        'close-buzzer': '抢答已关闭。',
        incorrect: '本队本题不可再次抢答，不扣分。',
        award: '计分已保存，每名队员均已获得奖励。',
        'undo-award': '已撤销计分，可选择队伍重新计分。',
        'reveal-answer': '答案已在大屏幕公布。',
        'finish-cell': '本题已完成。',
        'new-question': '新题已准备。',
        'adventure-start': '计时已开始。',
        'adventure-correct': '已记录猜对。',
        'adventure-skip': '已跳过。',
        'adventure-steal': '第二队可以抢答。',
        'adventure-award': '已给挑战队伍计分。',
        'adventure-finish-cell': '本题已提前结束，已返回题板。',
      };
      setFeedback(messages[action] ?? '操作已保存。');
      if (
        action === 'select-cell' ||
        action === 'finish-cell' ||
        action === 'adventure-finish-cell' ||
        action === 'award'
      )
        setCorrection('');
    } finally {
      lock.current = false;
      setPending('');
    }
  };
  const button = (
    action: string,
    label: string,
    blocked = false,
    data: Record<string, unknown> = {},
    primary = false,
  ) => (
    <button
      className={`button ${primary ? 'primary' : 'secondary'}`}
      disabled={busy || blocked}
      onClick={() => void host(action, data)}
    >
      {pending === action ? '保存中…' : label}
    </button>
  );
  const eligible = trivia.teams.filter((t) => !t.excluded);
  const controls = trivia.controls;
  return (
    <section lang="zh-CN" className="host-game-controls trivia-host">
      <p className="trivia-bank-label" role="status">
        {trivia.bankLabel}
      </p>
      {trivia.bankSwitch && (
        <div className="trivia-mode-control">
          <label className="trivia-mode-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="演示模式"
              checked={!!trivia.demo}
              disabled={
                busy ||
                !trivia.bankSwitch.allowed ||
                (!!trivia.demo && !trivia.bankSwitch.eventAvailable)
              }
              onChange={(event) =>
                void host('set-demo-mode', {
                  demo: event.target.checked,
                  expectedBankVersion: board?.version,
                })
              }
            />
            <span>
              演示模式 <strong>{trivia.demo ? '开启' : '关闭'}</strong>
            </span>
          </label>
          <p className="fine-print">开启：示例题，类别 1–5。关闭：本机正式题库。首次选题后锁定。</p>
          {!trivia.bankSwitch.allowed && (
            <p className="fine-print">本轮已经选题或结束，切换题库请新建派对。</p>
          )}
          {trivia.demo && !trivia.bankSwitch.eventAvailable && (
            <p className="fine-print">本机未找到正式题库，暂时只能使用演示模式。</p>
          )}
        </div>
      )}
      <p className="host-action-feedback" role="status" aria-live="polite">
        {feedback ? `✓ ${feedback}` : pending ? '保存中…' : ''}
      </p>
      {board && !trivia.teams.length && (
        <div className="trivia-start-card">
          <strong>{trivia.demo ? '演示题板已就绪' : 'Trivia 题板已就绪'}</strong>
          <p>先分队，然后在题板上选题。</p>
          {button('assign', '开始 Trivia · 随机分队', false, { count: Number(count) }, true)}
        </div>
      )}
      <fieldset className="control-group">
        <legend>1 · 分队</legend>
        <label>
          队伍数量{' '}
          <input
            type="number"
            min="1"
            value={count}
            disabled={busy || trivia.question > 0}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>{' '}
        {button('assign', '随机分队', trivia.question > 0, { count: Number(count) })}
        <details>
          <summary>查看队伍与成员</summary>
          <TeamList trivia={trivia} />
        </details>
      </fieldset>
      <TriviaQuestionPanel>
        {board &&
          trivia.teams.length > 0 &&
          !board.started &&
          !selected &&
          button('show-board', '显示题板 · 开始选题', false, {}, true)}
        {board && !selected && (
          <>
            <p>队伍口头选题，由主持人点击。待准备的题目暂不可选。</p>
            <Board
              board={board}
              disabled={busy || !trivia.teams.length}
              onSelect={(id) => void host('select-cell', { cellId: id })}
            />
          </>
        )}
        {board && selected && !trivia.adventure && <Question board={board} host />}
        {selected?.kind === 'music' && selected.musicClip && audioUrl && selected.musicPlayback && (
          <>
            <MusicClip
              url={audioUrl}
              start={selected.musicClip.start}
              end={selected.musicClip.end}
              playing={selected.musicPlayback.playing}
              position={selected.musicPlayback.position}
              changedAt={selected.musicPlayback.changedAt}
              track={selected.musicTrack}
              storeUrl={selected.musicStoreUrl}
              host
              onHost={host}
              cellId={selected.id}
              disabled={busy || (alreadyAwarded && !selected.musicPlayback.playing)}
            />
            <p className="fine-print">无需等待试听结束；可以随时抢答、公布答案、计分或完成本题。</p>
          </>
        )}
        {trivia.adventure && (
          <AdventureHost
            adventure={trivia.adventure}
            teamName={trivia.teams.find((t) => t.id === trivia.adventure?.teamId)?.name}
            button={button}
            busy={busy}
            teams={trivia.teams}
            clockOffset={clockOffset}
          />
        )}
        {!board &&
          button('new-question', '下一题', !trivia.teams.length || trivia.status === 'armed')}
        <BuzzStatus trivia={trivia} />
      </TriviaQuestionPanel>
      <TriviaBuzzerAndReveal>
        {(!board || selected) && (
          <>
            <p>
              {controls?.disabledReason ??
                `可抢答：${eligible.map((t) => t.name).join('、') || '无。'}`}
            </p>
            <div className="actions">
              {button('arm', '开启抢答', !controls?.canArm, {}, true)}
              {button('close-buzzer', '关闭抢答', !controls?.canCloseBuzzer)}
              {button('incorrect', '答错 · 不扣分', !controls?.canMarkIncorrect)}
              {board && (
                <>
                  {button('reveal-answer', '公布答案', !controls?.canReveal)}
                  {button('cancel-selection', '选错了 · 返回且保留此格', !controls?.canCancel)}
                </>
              )}
            </div>
          </>
        )}
      </TriviaBuzzerAndReveal>
      <TriviaScoreAndCorrections>
        {trivia.adventure && (
          <p>当前大冒险由挑战队伍作答；请在上方确认结果并计分，或选择抢答／跳过。</p>
        )}
        {correction && (
          <p>
            正在修正：{board?.categories.find((c) => c.id === awardCell?.categoryId)?.name} ·{' '}
            {awardCell?.value} 分{' '}
            <button className="button secondary" disabled={busy} onClick={() => setCorrection('')}>
              取消修正
            </button>
          </p>
        )}
        <label>
          获奖队伍{' '}
          <select
            disabled={busy || (!!trivia.adventure && !correction && !controls?.canAward)}
            value={team}
            onChange={(e) => setTeamChoice({ context: teamContext, id: e.target.value })}
          >
            <option value="" disabled>
              选择获奖队伍
            </option>
            {trivia.teams.map((t) => (
              <option
                key={t.id}
                value={t.id}
                disabled={
                  !!trivia.adventure && !correction && !controls?.awardableTeamIds.includes(t.id)
                }
              >
                {t.name}
              </option>
            ))}
          </select>
        </label>{' '}
        {board ? (
          <p>每名队员获得 {awardCell ? formatTokens(awardCell.value) : '—'} 分。答错不扣分。</p>
        ) : (
          <label>
            每名队员奖励{' '}
            <input
              type="number"
              min="1"
              value={amount}
              disabled={busy}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        )}
        {button(
          'award',
          alreadyAwarded
            ? '本题已计分'
            : `答对 · 奖励${trivia.teams.find((t) => String(t.id) === team)?.name ?? '全队'}每人`,
          !trivia.teams.length ||
            !team ||
            (!!trivia.adventure && !correction && !controls?.canAward) ||
            alreadyAwarded ||
            (!!board && (!awardCell || (correction ? false : !controls?.canAward))),
          {
            teamId: Number(team),
            amount: board ? awardCell?.value : Number(amount),
            ...(awardCell ? { cellId: awardCell.id } : {}),
          },
        )}
        {board && selected && !correction && (
          <div className="actions">
            {button(
              'finish-cell',
              alreadyAwarded ? '完成本题 · 返回题板' : '不计分 · 完成本题',
              !controls?.canFinish,
            )}
          </div>
        )}
        {!!history.length && (
          <div className="award-history">
            <h4>计分与撤销记录</h4>
            <ul>
              {history.map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>
                      {trivia.teams.find((t) => t.id === a.teamId)?.name} · 每人 +
                      {formatTokens(a.amount)}
                    </strong>
                    <span>
                      {a.cellId
                        ? `${board?.categories.find((c) => c.id === board.cells.find((cell) => cell.id === a.cellId)?.categoryId)?.name} · ${a.amount} 分`
                        : a.question === null
                          ? '早期计分'
                          : `第 ${a.question} 题`}{' '}
                      · {a.undone ? '已撤销' : '已计分'}
                    </span>
                  </div>
                  <button
                    className="button secondary"
                    disabled={busy || a.undone}
                    onClick={() => void host('undo-award', { awardId: a.id })}
                  >
                    {a.undone ? '已撤销' : '撤销计分'}
                  </button>
                  {a.undone &&
                    a.cellId &&
                    !history.some((other) => other.cellId === a.cellId && !other.undone) && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => {
                          setCorrection(a.cellId!);
                          setTeamChoice({
                            context: `${trivia.question}:${trivia.windowId}:${trivia.winner?.teamId ?? ''}:${a.cellId}`,
                            id: String(a.teamId),
                          });
                        }}
                      >
                        重新计分此题
                      </button>
                    )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </TriviaScoreAndCorrections>
      {!!board?.review?.length && (
        <details className="trivia-review">
          <summary>待确认内容与音乐候选（仅主持人可见）</summary>
          <p>分值暂用配置中的五级数值，正式使用前待确认。音乐播放方案尚未选择。</p>
          {board.review.map((cell) => (
            <p key={cell.id}>
              <strong>
                {board.categories.find((c) => c.id === cell.categoryId)?.name} · {cell.value}
              </strong>
              ：{cell.reason}
              {cell.musicCandidates && ` 候选：${cell.musicCandidates.join('；')}`}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
export function TriviaDisplay({
  trivia,
  closed = false,
  clockOffset = 0,
  audioUrl,
}: {
  trivia: TriviaProjection;
  closed?: boolean;
  clockOffset?: number;
  audioUrl?: string;
}) {
  const board = trivia.board;
  const winningTeam = trivia.teams.find((team) => team.id === trivia.winner?.teamId);
  const winner = winningTeam?.members.find((player) => player.id === trivia.winner?.playerId);
  const answering =
    !closed &&
    trivia.status === 'locked' &&
    !!winningTeam &&
    !board?.revealed &&
    (!trivia.adventure ||
      trivia.adventure.phase === 'rules' ||
      trivia.adventure.phase === 'active');
  const showingGroups = !!board && !board.started && !board.selected && !closed;
  return (
    <section
      lang="zh-CN"
      className={`trivia-board ${board && !showingGroups ? 'has-jeopardy' : ''} ${showingGroups ? 'is-groups' : board?.selected ? 'is-question' : 'is-selection'}`}
    >
      {showingGroups ? (
        <div className="trivia-landing">
          <div className="trivia-introduction">
            <div className="trivia-intro-copy">
              <h2>组队，选题，抢答。</h2>
              <ol className="trivia-intro-rules">
                <li>
                  <strong>选题</strong>
                  <span>队伍选类别与分值，主持人打开题目。</span>
                </li>
                <li>
                  <strong>抢答</strong>
                  <span>抢答开启后按手机，最快的队伍口头回答。</span>
                </li>
                <li>
                  <strong>计分</strong>
                  <span>答对，全队每人获得题目分值。答错不扣分。</span>
                </li>
              </ol>
            </div>
            <JeopardyIntroArt />
          </div>
          {trivia.teams.length > 0 && (
            <div className="trivia-intro-teams">
              <h3>
                今晚的队伍{' '}
                <span>
                  {trivia.teams.length} 支队伍 ·{' '}
                  {trivia.teams.reduce((sum, team) => sum + team.members.length, 0)} 位玩家
                </span>
              </h3>
              <div className="team-board">
                {trivia.teams.map((team) => (
                  <article
                    key={team.id}
                    className="team-card"
                    style={{ '--team-color': team.color } as CSSProperties}
                  >
                    <h3>
                      {team.name}
                      <small>{team.members.length} 人</small>
                    </h3>
                    <ul className="team-members">
                      {team.members.map((player) => (
                        <li key={player.id}>
                          <span aria-hidden="true">{player.emoji}</span>
                          {player.name}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : board ? (
        <>
          <div className="trivia-display-focus">
            {trivia.adventure ? (
              <AdventureStage
                adventure={trivia.adventure}
                teamName={trivia.teams.find((t) => t.id === trivia.adventure?.teamId)?.name}
                clockOffset={clockOffset}
              />
            ) : board.selected ? (
              <>
                <Question board={board} />
                {board.selected.kind === 'location' && board.selected.locationView && (
                  <TriviaLocation scene={board.selected.locationView as TriviaLocationView} />
                )}
                {board.selected.kind === 'music' &&
                  board.selected.musicClip &&
                  board.selected.musicPlayback &&
                  audioUrl && (
                    <MusicClip
                      url={audioUrl}
                      start={board.selected.musicClip.start}
                      end={board.selected.musicClip.end}
                      playing={board.selected.musicPlayback.playing}
                      position={board.selected.musicPlayback.position}
                      changedAt={board.selected.musicPlayback.changedAt}
                      track={board.selected.musicTrack}
                      storeUrl={board.selected.musicStoreUrl}
                    />
                  )}
              </>
            ) : (
              <Board board={board} />
            )}
          </div>
          <footer className="trivia-display-strip">
            <p
              className={`trivia-display-status ${answering ? 'is-answering' : ''}`}
              role="status"
              aria-live="polite"
              style={{ '--team-color': winningTeam?.color } as CSSProperties}
            >
              <span className="trivia-status-dot" aria-hidden="true" />
              {closed ? (
                '本轮结束'
              ) : answering ? (
                <>
                  <strong>{winningTeam.name}</strong>
                  {winner && (
                    <span>
                      {winner.emoji} {winner.name}
                    </span>
                  )}
                  <span className="sr-only">抢答成功</span>
                </>
              ) : trivia.adventure ? (
                trivia.adventure.phase === 'active' ? (
                  '挑战进行中'
                ) : trivia.adventure.phase === 'won' ? (
                  '挑战成功'
                ) : trivia.adventure.phase === 'result' ? (
                  '可开启抢答'
                ) : trivia.adventure.phase === 'closed' ? (
                  '挑战结束'
                ) : trivia.adventure.phase === 'rules' ? (
                  '准备挑战'
                ) : trivia.adventure.phase === 'steal' && trivia.status === 'armed' ? (
                  '抢答开启'
                ) : (
                  '等待主持人'
                )
              ) : board.revealed ? (
                '答案已公布'
              ) : trivia.status === 'armed' ? (
                '抢答开启'
              ) : !trivia.teams.length ? (
                '等待分队'
              ) : board.selected ? (
                '抢答未开启'
              ) : !board.cells.some((cell) => cell.available && !cell.used) ? (
                '题目已完成'
              ) : (
                '选题'
              )}
            </p>
            <ul className="trivia-scores" aria-label="本轮队伍得分">
              {trivia.teams.map((team) => (
                <li
                  key={team.id}
                  style={{ '--team-color': team.color } as CSSProperties}
                  className={`${answering && winningTeam.id === team.id ? 'is-buzzer' : ''} ${team.excluded && board.selected ? 'is-excluded' : ''}`}
                >
                  <span>{team.name}</span>
                  <strong>{formatTokens(team.score ?? 0)}</strong>
                  {team.excluded && board.selected && <small>本题已答错</small>}
                </li>
              ))}
            </ul>
          </footer>
        </>
      ) : (
        <>
          <div className="trivia-landing-title">
            {trivia.winner || trivia.status === 'armed' ? (
              <BuzzStatus trivia={trivia} />
            ) : (
              <h2>Trivia 即将开始</h2>
            )}
          </div>
          <div className="team-board">
            {trivia.teams.map((team) => (
              <article
                key={team.id}
                className={`team-card ${trivia.winner?.teamId === team.id ? 'is-buzzer' : ''} ${team.excluded ? 'is-excluded' : ''}`}
                style={{ '--team-color': team.color } as CSSProperties}
              >
                <h3>
                  {team.name}
                  {team.excluded && <small>本题已答错</small>}
                </h3>
                <ul className="team-members">
                  {team.members.map((p) => (
                    <li key={p.id} className={trivia.winner?.playerId === p.id ? 'is-first' : ''}>
                      <span aria-hidden="true">{p.emoji}</span>
                      {p.name}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
