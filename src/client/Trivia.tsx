import React, { useRef, useState, type CSSProperties } from 'react';
import type { TriviaBoard, TriviaProjection } from '../server/games/trivia.js';
import type { CommandSender } from '../shared/contracts.js';
import { formatTokens } from './format.js';

export type TriviaViewProps = {
  trivia: TriviaProjection;
  command: CommandSender;
  disabled: boolean;
};
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
function BuzzStatus({
  trivia,
  showBank = false,
}: {
  trivia: TriviaProjection;
  showBank?: boolean;
}) {
  const team = trivia.teams.find((t) => t.id === trivia.winner?.teamId);
  const winner = team?.members.find((p) => p.id === trivia.winner?.playerId);
  return (
    <p role="status">
      {showBank && trivia.bankLabel && <small>{trivia.bankLabel} · </small>}
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
export function TriviaPlayer({ trivia, command, disabled }: TriviaViewProps) {
  const team = trivia.teams.find((t) => t.id === trivia.ownTeamId);
  const [feedback, setFeedback] = useState({ message: '', windowId: -1 });
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const canBuzz = team && !team.excluded && trivia.status === 'armed' && !disabled && !pending;
  const buzz = async () => {
    if (lock.current || !canBuzz) return;
    lock.current = true;
    setPending(true);
    setFeedback({ message: '', windowId: trivia.windowId });
    try {
      const receipt = await command('phase.action', {
        action: 'buzz',
        data: { windowId: trivia.windowId },
      });
      setFeedback({
        message: receipt ? '抢答成功！请口头回答。' : '本次未抢到，请查看当前抢答状态。',
        windowId: trivia.windowId,
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
      {trivia.bankLabel && <p className="fine-print">{trivia.bankLabel}</p>}
      <p>看大屏幕 · 手机只用于抢答</p>
      <BuzzStatus trivia={trivia} />
      {team?.excluded && <p>本队本题已答错，不扣分。请等待下一题。</p>}
      <button
        className="button primary trivia-buzzer"
        disabled={!canBuzz}
        onClick={() => void buzz()}
      >
        {pending ? '提交中…' : '抢答'}
      </button>
      {feedback.message && feedback.windowId === trivia.windowId && trivia.status !== 'idle' && (
        <p role="status">{feedback.message}</p>
      )}
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
                  {cell.used ? '—' : formatTokens(cell.value)}
                  <small>{cell.used ? '已完成' : !cell.available ? '待准备' : '\u00a0'}</small>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
/** Same full question view on host and TV; the server supplies role-safe fields. */
function Question({ board, host = false }: { board: TriviaBoard; host?: boolean }) {
  const clue = board.selected;
  if (!clue) return null;
  return (
    <article className="trivia-question">
      <p className="trivia-question-context">
        {board.categories.find((c) => c.id === clue.categoryId)?.name} · {formatTokens(clue.value)}{' '}
        分
      </p>
      <h2>{clue.publicPrompt}</h2>
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
export function TriviaHost({ trivia, command, disabled }: TriviaViewProps) {
  const [count, setCount] = useState(String(trivia.teams.length || trivia.defaultTeamCount || 1));
  const [team, setTeam] = useState('1');
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
      };
      setFeedback(messages[action] ?? '操作已保存。');
      if (action === 'select-cell' || action === 'finish-cell' || action === 'award')
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
      <fieldset className="control-group">
        <legend>2 · 选题与抢答</legend>
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
        {board && selected && <Question board={board} host />}
        {!board &&
          button('new-question', '下一题', !trivia.teams.length || trivia.status === 'armed')}
        <BuzzStatus trivia={trivia} />
        {(!board || selected) && (
          <>
            <p>可抢答：{eligible.map((t) => t.name).join('、') || '无。可公布答案并完成本题。'}</p>
            <div className="actions">
              {button(
                'arm',
                '开启抢答',
                !trivia.question ||
                  trivia.status !== 'idle' ||
                  !eligible.length ||
                  !!board?.revealed ||
                  (!!board && history.some((a) => !a.undone && a.cellId === selected?.id)),
                {},
                true,
              )}
              {button('close-buzzer', '关闭抢答', trivia.status !== 'armed')}
              {button(
                'incorrect',
                '答错 · 不扣分',
                trivia.status !== 'locked' ||
                  !!board?.revealed ||
                  (!!board && history.some((a) => !a.undone && a.cellId === selected?.id)),
              )}
              {board && (
                <>
                  {button('reveal-answer', '公布答案', board.revealed)}
                  {button('finish-cell', '完成本题 · 返回题板', trivia.status === 'armed')}
                  {button('cancel-selection', '选错了 · 返回且保留此格', !board.canCancel)}
                </>
              )}
            </div>
          </>
        )}
      </fieldset>
      <fieldset className="control-group">
        <legend>3 · 计分与修正</legend>
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
          <select disabled={busy} value={team} onChange={(e) => setTeam(e.target.value)}>
            {trivia.teams.map((t) => (
              <option key={t.id} value={t.id}>
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
          alreadyAwarded ? '本题已计分' : '答对 · 奖励全队每人',
          !trivia.teams.length ||
            alreadyAwarded ||
            (!!board && (!awardCell || trivia.status === 'armed')),
          {
            teamId: Number(team),
            amount: board ? awardCell?.value : Number(amount),
            ...(awardCell ? { cellId: awardCell.id } : {}),
          },
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
                          setTeam(String(a.teamId));
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
      </fieldset>
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
export function TriviaDisplay({ trivia }: { trivia: TriviaProjection }) {
  return (
    <section lang="zh-CN" className={`trivia-board ${trivia.board ? 'has-jeopardy' : ''}`}>
      {trivia.board ? (
        <>
          <div className="trivia-buzz-status">
            <BuzzStatus trivia={trivia} showBank />
          </div>
          {trivia.board.selected ? (
            <Question board={trivia.board} />
          ) : (
            <Board board={trivia.board} />
          )}
          <div className="trivia-scores" aria-label="本轮队伍得分">
            {trivia.teams.map((team) => (
              <span
                key={team.id}
                style={{ '--team-color': team.color } as CSSProperties}
                className={trivia.winner?.teamId === team.id ? 'is-buzzer' : ''}
              >
                {team.name} · {formatTokens(team.score ?? 0)} 分
                {team.excluded && trivia.board?.selected ? ' · 本题已答错' : ''}
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="trivia-buzz-status">
            <BuzzStatus trivia={trivia} />
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
