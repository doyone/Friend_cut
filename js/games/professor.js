// 교수님 몰래 게임하기: 교수님이 칠판을 보는 동안 스페이스를 꾹 눌러 몰래 게임 (누른 시간만큼 기록).
// 교수님은 예고 없이 돌아본다 — 돌아보는 순간 누르고 있던 사람은 C+ (탈락). 30초 뒤 살아남은 사람 중 기록이 가장 긴 사람이 승리.
// 칠판으로 돌아선 뒤 1.6초는 안전하다 (다음 돌아보기까지 1.6~4.1초). 그다음부터는 욕심과 눈치 싸움.
// 걸린 사람(유령)은 한 번 '🙋 고자질': 0.7초 뒤 교수님이 돌아본다. 말풍선이 떠서 눈치 빠르면 피할 수 있고, 그걸로 걸리면 고자질한 사람 킬.
// 돌아보는 시각은 방장만 안다(ctx.secret). 손 뗀 시각은 누른 사람 화면 시계로 받아서(최대 0.3초 전까지 인정)
// 와이파이가 느려도 '돌아보기 전에 뗐는데 걸림'이 없게 한다.
import { AGAIN_INTRO } from '../util.js';
import { mountProfessor } from './professor-view.js';

const INTRO = 5000;
const DURATION = 30000;
const LEASE = 1200;          // 누르는 중이면 화면이 0.4초마다 다시 알려 준다. 끊긴 탭이 계속 기록을 쌓지 못하게
const GRACE = 300;           // 손 뗀 신호가 늦게 와도 이만큼은 봐준다 (돌아본 순간보다 먼저 뗐으면 무사)
const RESULT_DELAY = 1800;   // 마지막 C+가 떨어지는 걸 보고 결과 화면으로
const BOARD = [1600, 4100];  // 칠판 보는 시간
const WATCH = [850, 1800];   // 돌아보는 시간
const SNITCH_DELAY = 700;    // 고자질하면 이만큼 뒤에 돌아봄
const SNITCH_GAP = 3000;     // 고자질끼리 간격
const randomMs = ([min, max]) => Math.round(min + Math.random() * (max - min));

function normalize(S) {
  S.holds ||= {};
  S.seq ||= {};
  S.caught ||= {};
  S.scores ||= {};
  S.pending ||= {};
  S.snitched ||= {};
}

function catchPlayer(ctx, id, at) {
  const S = ctx.state;
  if (!S.alive.includes(id)) return;
  S.alive = S.alive.filter(pid => pid !== id);
  delete S.holds[id];
  delete S.pending[id];
  S.caught[id] = at;
  // 고자질로 돌아본 순간에 걸렸으면 고자질한 사람 킬
  const by = S.snitch?.turnAt === at && S.snitch.by !== id ? S.snitch.by : null;
  if (by) {
    ctx.kill(by, id, '🙋 고자질');
    S.kills = { ...(S.kills || {}), [by]: (S.kills?.[by] || 0) + 1 };
  } else {
    ctx.announce(`📉 ${ctx.nameOf(id)} 딱 걸렸어! C+ 확정`);
  }
}

function endRound(S, at) {
  Object.assign(S, { phase: 'result', endedAt: at, resultUntil: at + RESULT_DELAY, holds: {}, pending: {} });
  S.allCaught = S.alive.length === 0;
  // 살아남은 사람 > 걸린 사람. 살아남은 사람끼리는 기록 순, 걸린 사람끼리는 늦게 걸린 순. 전원 C+면 우승자 없음
  S.standings = Object.fromEntries(S.roster.map(p => [p.id,
    S.allCaught ? 0 : S.alive.includes(p.id) ? DURATION * 2 + (S.scores[p.id] || 0) : Math.max(1, (S.caught[p.id] || S.startAt) - S.startAt)]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const best = [...S.alive].sort((a, b) => (S.scores[b] || 0) - (S.scores[a] || 0))[0];
  for (const id of S.alive) add(id, id === best ? `🎮 프로게이머 (${((S.scores[id] || 0) / 1000).toFixed(1)}초)` : '😇 모범생인 척 성공');
  const first = Object.entries(S.caught).sort((a, b) => a[1] - b[1])[0]?.[0];
  for (const id of Object.keys(S.caught)) add(id, id === first ? '🚨 1빠로 걸림' : '📉 C+');
  const [snitch, n] = Object.entries(S.kills || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (n >= 1) add(snitch, `🙋 고자질왕 (${n}명)`);
  S.titles = titles;
}

function start(ctx, now) {
  const S = ctx.state;
  Object.assign(S, { phase: 'play', startAt: now, endAt: now + DURATION, lastAt: now, look: 'board', lookAt: now });
  // 돌아보기 전에는 아무 신호도 보여 주지 않는다 (시각은 방장만)
  ctx.secret.professorAt = now + randomMs(BOARD);
}

// 입력을 처리하기 전에 먼저 지금까지 시간을 흘린다: 돌아본 뒤에 손을 떼도 걸린 건 못 무른다
export function advanceProfessor(ctx, now) {
  const S = ctx.state;
  normalize(S);
  if (S.phase === 'intro') {
    if (now < S.introUntil) return false;
    start(ctx, now);
    return true;
  }
  if (S.phase === 'result') {
    if (now < S.resultUntil) return false;
    S.phase = 'final';
    S.over = true;
    return true;
  }
  if (S.phase !== 'play' || now <= S.lastAt) return false;
  // 방장이 바뀌어 비밀 시각을 잃었으면 다시 정한다 (보여 주지 않고, 멈추지도 않게)
  if (!Number.isFinite(ctx.secret.professorAt) || ctx.secret.professorAt < S.lastAt) {
    ctx.secret.professorAt = S.lastAt + randomMs(BOARD);
  }
  const stop = Math.min(now, S.endAt);
  let cursor = S.lastAt;
  while (cursor < stop) {
    const boundary = Math.min(stop, ctx.secret.professorAt);
    if (S.look === 'board') {
      for (const id of S.alive) {
        if (S.pending[id] != null) continue;
        const earned = Math.max(0, Math.min(boundary, S.holds[id] || 0) - cursor);
        S.scores[id] = Math.min(DURATION, (S.scores[id] || 0) + earned);
      }
    }
    cursor = boundary;
    // 종이 먼저: 30초가 지나는 순간엔 돌아봐도 안 걸린다
    if (cursor >= S.endAt || cursor !== ctx.secret.professorAt) break;
    S.look = S.look === 'board' ? 'watch' : 'board';
    S.lookAt = cursor;
    for (const [id, at] of Object.entries(S.pending)) if (cursor - at >= GRACE) catchPlayer(ctx, id, at);
    // 돌아본 순간 누르고 있던 사람은 '걸린 후보' — 그보다 먼저 뗀 신호가 늦게 오면 봐준다
    if (S.look === 'watch') for (const id of S.alive) if ((S.holds[id] || 0) > cursor) S.pending[id] = cursor;
    ctx.secret.professorAt = cursor + randomMs(S.look === 'watch' ? WATCH : BOARD);
  }
  S.lastAt = cursor;
  // 봐주는 시간이 지난 후보는 C+ 확정 (종이 쳤으면 남은 후보도 바로)
  const over = cursor >= S.endAt;
  for (const [id, at] of Object.entries(S.pending)) if (over || now - at >= GRACE) catchPlayer(ctx, id, at);
  for (const [id, until] of Object.entries(S.holds)) if (until <= cursor) delete S.holds[id];
  if (over) endRound(S, S.endAt);
  else if (!S.alive.length) endRound(S, Math.max(...Object.values(S.caught)));
  return true;
}

// 손 뗀(누른) 시각: 그 사람 화면 시계로, 너무 옛날이나 미래는 못 쓰게
const inputAt = (now, t) => (Number.isFinite(t) ? Math.max(now - GRACE, Math.min(now, t)) : now);

function hold(ctx, pid, data, now) {
  const S = ctx.state;
  const at = inputAt(now, Number(data.t));
  if (!data.down) {
    delete S.holds[pid];
    if (S.pending[pid] != null && at <= S.pending[pid]) delete S.pending[pid]; // 돌아보기 전에 뗐다: 무사
    return true;
  }
  if (S.look === 'watch') {
    if (S.pending[pid] != null) return true; // 이미 걸린 후보
    // 돌아본 뒤에 누름 = 바로 C+. 돌아보기 전에 누른 신호가 늦게 왔으면 돌아본 순간의 후보로
    if (at >= S.lookAt) catchPlayer(ctx, pid, at);
    else S.pending[pid] = S.lookAt;
    if (!S.alive.length) endRound(S, at);
    return true;
  }
  S.holds[pid] = now + LEASE;
  return true;
}

// 고자질은 칠판으로 돌아선 뒤 안전한 1.6초가 지나야 쓸 수 있다: '돌아선 직후엔 안전'은 늘 통하고, 욕심부리는 사람만 잡힌다
export const canSnitchAt = (S, pid, now) => S.phase === 'play' && !!S.caught?.[pid] && !S.snitched?.[pid] && S.look === 'board'
  && now - S.lookAt >= BOARD[0] && now - (S.snitch?.at || 0) >= SNITCH_GAP;

function snitch(ctx, pid, now) {
  const S = ctx.state;
  if (!canSnitchAt(S, pid, now)) return false;
  const turnAt = now + SNITCH_DELAY;
  if (turnAt >= S.endAt || ctx.secret.professorAt <= turnAt) return false; // 어차피 곧 돌아보면 쓸 필요 없음
  ctx.secret.professorAt = turnAt;
  S.snitch = { by: pid, at: now, turnAt };
  S.snitched = { ...S.snitched, [pid]: true };
  ctx.announce(`🙋 ${ctx.nameOf(pid)}: 교수님! 쟤네 게임해요!`);
  return true;
}

export default {
  id: 'professor',
  title: '교수님 몰래 게임하기',
  emoji: '🧑‍🏫',
  tag: '심리',
  color: '#32856a',
  desc: '스페이스 꾹 눌러 몰래 게임! 교수님이 예고 없이 돌아볼 때 누르고 있으면 즉시 C+. 걸린 사람은 고자질 한 번. 30초 동안 가장 오래 몰래 한 사람이 승리!',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: 50,

  setup(ctx, prev) {
    return {
      phase: 'intro',
      introUntil: ctx.now() + (prev ? AGAIN_INTRO : INTRO),
      again: !!prev,
      look: 'board',
      alive: ctx.roster.map(p => p.id),
      scores: Object.fromEntries(ctx.roster.map(p => [p.id, 0])),
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    if (data.run !== S.run || !ctx.roster.some(p => p.id === pid)) return false;
    const now = ctx.now();
    const changed = advanceProfessor(ctx, now);
    if (S.phase !== 'play') return changed;
    if (type === 'snitch') return snitch(ctx, pid, now) || changed;
    // 누름·뗌은 순서 번호로: 늦게 도착한 옛 신호가 새 신호를 덮지 않게
    if (type !== 'hold' || typeof data.down !== 'boolean' || !Number.isSafeInteger(data.seq) || data.seq < 1) return changed;
    if (!S.alive.includes(pid) || data.seq <= (S.seq[pid] || 0)) return changed;
    S.seq[pid] = data.seq;
    return hold(ctx, pid, data, now);
  },

  tick: ctx => advanceProfessor(ctx, ctx.now()),

  // 봇: 모두에게 보이는 것(교수님이 보는 쪽, 고자질 말풍선)만 보고 움직인다. 비밀 시각은 모른다.
  // 칠판으로 돌아서면 0.25~0.75초 뒤부터 '안전한 1.6초' 언저리까지 쭉 누르고(봇마다 욕심이 달라 가끔 넘김),
  // 그 뒤로는 가끔만 짧게 욕심낸다. 고자질이 뜨면 0.3~0.9초 뒤 손을 뗀다(가끔 늦음). 걸리면 가끔 고자질.
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase !== 'play') return null;
    if (!S.alive.includes(id)) {
      if (!canSnitchAt(S, id, now)) return null;
      mem.snitchAt ||= now + 1000 + Math.random() * 5000;
      return now >= mem.snitchAt && Math.random() < 0.2 ? { type: 'snitch', data: { run: S.run }, say: Math.random() < 0.3 } : null;
    }
    const act = down => ({ type: 'hold', data: { down, seq: (S.seq?.[id] || 0) + 1, run: S.run, t: now } });
    if (S.look === 'watch') return S.holds?.[id] ? act(false) : null;
    if (S.snitch && now - S.snitch.at < SNITCH_DELAY + 300) {
      mem.dodge ??= now + 300 + Math.random() * 600; // 사람처럼 가끔은 늦는다
      if (now >= mem.dodge) {
        mem.until = 0;
        return S.holds?.[id] ? act(false) : null;
      }
    } else {
      mem.dodge = undefined;
    }
    if (mem.lookAt !== S.lookAt) {
      mem.lookAt = S.lookAt;
      mem.from = now + 250 + Math.random() * 500;
      mem.until = S.lookAt + 1250 + Math.random() * 700; // 안전한 1.6초 언저리까지
      mem.retry = 0;
    }
    if (now >= mem.from && now < mem.until) {
      if (S.holds?.[id] && now - (mem.sentAt || 0) < 400) return null; // 누르는 중이면 0.4초마다만 다시 알림
      mem.sentAt = now;
      return act(true);
    }
    if (S.holds?.[id]) return act(false);
    // 안전 구간이 지나면 가끔만 짧게 욕심
    if (now >= mem.until && now >= mem.retry) {
      mem.retry = now + 600 + Math.random() * 1000;
      if (Math.random() < 0.3) {
        mem.from = now;
        mem.until = now + 250 + Math.random() * 450;
        mem.sentAt = now;
        return act(true);
      }
    }
    return null;
  },

  mount: mountProfessor,
};
