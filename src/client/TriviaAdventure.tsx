import React, { useEffect, useState } from 'react';
import type { AdventureProjection } from '../server/games/trivia-adventure.js';

function Countdown({
  deadlineAt,
  clockOffset,
}: {
  deadlineAt: number | null;
  clockOffset: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadlineAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadlineAt]);
  if (!deadlineAt) return null;
  const seconds = Math.max(0, Math.ceil((deadlineAt - now - clockOffset) / 1000));
  return (
    <p className="adventure-timer" role="timer">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </p>
  );
}

export function AdventureStage({
  adventure: a,
  teamName,
  clockOffset = 0,
}: {
  adventure: AdventureProjection;
  teamName?: string;
  clockOffset?: number;
}) {
  return (
    <article className="adventure-stage" lang="zh-CN">
      <h2>{a.title}</h2>
      <p>
        {teamName ?? (a.attempt === 1 ? '等待主持人选择队伍' : '等待队伍抢答')} · 第 {a.attempt}{' '}
        次尝试
      </p>
      {a.phase === 'waiting' || a.phase === 'rules' || a.phase === 'steal' ? (
        <>
          <h3>挑战规则</h3>
          <ol>
            {a.rules.map((rule, i) => (
              <li key={i}>{rule}</li>
            ))}
          </ol>
          {a.variant.startsWith('yes-no') && a.item && <p className="trivia-prompt">{a.item}</p>}
          <p>
            {a.phase === 'rules'
              ? '主持人准备好后开始计时。'
              : a.attempt === 1
                ? '等待主持人选择队伍。'
                : '等待抢答。'}
          </p>
        </>
      ) : (
        <>
          <Countdown deadlineAt={a.deadlineAt} clockOffset={clockOffset} />
          {a.item &&
            (a.variant === 'photo-recreation' ? (
              <img className="adventure-reference" src={a.item} alt="人体还原参考图" />
            ) : (
              <h3 className="trivia-prompt">{a.item}</h3>
            ))}
          {a.variant.startsWith('charades') && (
            <p>
              猜对 {a.correct} / {a.target} · 跳过 {a.skipped}
            </p>
          )}
          {a.score !== null && (
            <p>
              AI 评分：{a.score}/100 · {a.reason}
            </p>
          )}
          {a.phase === 'result' || a.phase === 'won' || a.phase === 'closed' ? (
            <p role="status">
              {a.success
                ? '挑战成功'
                : a.phase === 'result'
                  ? '挑战未达标，可开启抢答'
                  : '挑战结束，未得分'}
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

export function AdventureHost({
  adventure: a,
  teamName,
  button,
  busy,
  buzzerStatus,
  teams,
  clockOffset = 0,
}: {
  adventure: AdventureProjection;
  teamName?: string;
  button: (
    action: string,
    label: string,
    blocked?: boolean,
    data?: Record<string, unknown>,
    primary?: boolean,
  ) => React.ReactNode;
  busy: boolean;
  buzzerStatus: 'idle' | 'armed' | 'locked';
  teams: { id: number; name: string }[];
  clockOffset?: number;
}) {
  const [score, setScore] = useState('');
  const [reason, setReason] = useState('');
  const [chosenTeam, setChosenTeam] = useState(teams[0]?.id ?? 0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (a.variant !== 'photo-recreation' || a.phase !== 'active') return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [a.variant, a.phase]);
  const data = { attempt: a.attempt };
  return (
    <div className="adventure-host" lang="zh-CN">
      <AdventureStage adventure={a} teamName={teamName} clockOffset={clockOffset} />
      <p>题库剩余：{a.remaining ?? '—'}。已展示、跳过及换掉的题不会再次出现。</p>
      {a.phase === 'waiting' && (
        <div className="actions">
          <label>
            首轮挑战队伍{' '}
            <select value={chosenTeam} onChange={(e) => setChosenTeam(Number(e.target.value))}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          {button(
            'adventure-choose-team',
            '确认队伍 · 查看规则',
            !chosenTeam,
            { ...data, teamId: chosenTeam },
            true,
          )}
        </div>
      )}
      {a.phase === 'rules' && (
        <div className="actions">
          {a.variant.startsWith('yes-no') &&
            button(
              'adventure-display-prompt',
              a.displayPrompt ? '从大屏幕隐藏题目' : '在大屏幕显示题目',
              false,
              { ...data, visible: !a.displayPrompt },
            )}
          {button(
            'adventure-start',
            '开始计时',
            a.variant.startsWith('charades') && a.remaining === 0,
            data,
            true,
          )}
          {a.variant.startsWith('yes-no') &&
            button('adventure-replace', '未获同意 · 换题', a.remaining === 0, data)}
          {button('adventure-abort', '结束本题 · 不计分', false, data)}
        </div>
      )}
      {a.phase === 'active' && (
        <div className="actions">
          {a.variant.startsWith('yes-no') &&
            button(
              'adventure-display-prompt',
              a.displayPrompt ? '从大屏幕隐藏题目' : '在大屏幕显示题目',
              false,
              { ...data, visible: !a.displayPrompt },
            )}
          {a.variant.startsWith('charades') ? (
            <>
              {button(
                'adventure-correct',
                '猜对 · 下一题',
                a.remaining === 0 && a.correct + 1 < (a.target ?? 0),
                data,
                true,
              )}
              {button('adventure-skip', '跳过 · 下一题', a.remaining === 0, data)}
            </>
          ) : a.variant.startsWith('yes-no') ? (
            <>
              {button('adventure-success', '猜出并完成 · 成功', false, data, true)}
              {button('adventure-replace', '未获同意 · 换题', a.remaining === 0, data)}
            </>
          ) : (
            <>
              <p>{a.scoringPrompt}</p>
              <label>
                AI 分数{' '}
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                />
              </label>
              <label>
                简短理由{' '}
                <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              </label>
              {button(
                'adventure-score',
                '保存评分',
                !Number.isInteger(Number(score)) ||
                  score === '' ||
                  Number(score) < 0 ||
                  Number(score) > 100 ||
                  (a.deadlineAt !== null && now + clockOffset < a.deadlineAt),
                { ...data, score: Number(score), reason },
                true,
              )}
            </>
          )}
          {button('adventure-fail', '挑战失败 / 时间到', false, data)}
        </div>
      )}
      {a.phase === 'result' && (
        <div className="actions">
          {a.success ? (
            <>
              <p>本题由 {teamName} 挑战成功。确认后，每位队员获得本题分值。</p>
              {button(
                'adventure-award',
                `答对 · 给${teamName ?? '本队'}计分`,
                false,
                { ...data, teamId: a.teamId },
                true,
              )}
            </>
          ) : a.attempt === 1 ? (
            button('adventure-steal', '开启抢答 · 仅限另一队', false, data, true)
          ) : null}
          {button('adventure-abort', '跳过本题 · 不计分', false, data)}
        </div>
      )}
      {a.phase === 'steal' && (
        <div className="actions">
          {button('arm', '开启第二队抢答', buzzerStatus !== 'idle', {}, true)}
          {buzzerStatus === 'armed'
            ? button('close-buzzer', '无人抢答 · 关闭')
            : button('adventure-abort', '无人挑战 · 结束本题', false, data)}
        </div>
      )}
      {(a.phase === 'won' || a.phase === 'closed') &&
        button('finish-cell', '完成本题 · 返回题板', false, {}, true)}
      {a.phase !== 'won' &&
        a.phase !== 'closed' &&
        button('adventure-finish-cell', '提前结束本题 · 返回题板', false, data)}
      {busy && <span className="sr-only">正在保存</span>}
    </div>
  );
}
