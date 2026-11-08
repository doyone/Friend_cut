// 멈춰라: 막대 위를 바늘이 왔다 갔다 한다. 스페이스 한 번 = 내 바늘 멈추기. 과녁 한가운데에 제일 가까운 사람이 이긴다.
// 1등 +3 · 2등 +2 · 3등 +1, 정중앙(오차 1% 안)이면 +1 보너스. 6초 안에 안 멈추면 0점. 6라운드 합산.
// 라운드마다 빨라지고 과녁은 작아지며, 4라운드부터는 바늘이 가다가 빨라졌다 느려졌다 한다.
// 바늘 위치는 서버 시각의 함수라 모두 똑같이 보이고, 방장은 각자 노트북이 잰 '누른 시각'으로 위치를 다시 계산한다 → 공정.
import { h, isTyping, AGAIN_INTRO } from '../util.js';
import { avatar, nameTag, podium, scoreboard } from '../ui.js';

const ROUNDS = 6;
const INTRO_TIME = 5000;
const COUNT_TIME = 2500;
const ROUND_TIME = 6000;     // 바늘이 도는 시간 (이 안에 한 번 멈춰야)
const GRACE = 400;
const RESULT_TIME = 3500;
const POINTS = [3, 2, 1];
const BULLSEYE = 0.01;       // 정중앙: 막대 길이의 1% 안
const MAX_LAG = 1500;

// 라운드 r의 바늘·과녁: 한 번 왕복하는 시간이 1.8초에서 0.2초씩 짧아지고(최소 0.7초), 과녁은 좁아진다
export function makeRound(r) {
  return {
    period: Math.max(700, 1800 - (r - 1) * 200),
    phi: Math.random(),
    warp: r >= 4 ? Math.round((0.5 + Math.random() * 0.35) * 100) / 100 : 0,
    center: Math.round((0.15 + Math.random() * 0.7) * 1000) / 1000,
    half: Math.round(Math.max(0.025, 0.07 - (r - 1) * 0.009) * 1000) / 1000,
  };
}

// 시작부터 t(ms)일 때 바늘 자리 0~1: 왕복(삼각파). warp가 있으면 한 바퀴 안에서 빨라졌다 느려졌다 (그래도 늘 앞으로)
export function needleAt(R, t) {
  let u = (t / R.period + R.phi) % 1;
  if (u < 0) u += 1;
  if (R.warp) u += (R.warp / (2 * Math.PI)) * Math.sin(2 * Math.PI * u);
  return 1 - Math.abs(2 * u - 1);
}

function startRound(S, now) {
  S.round += 1;
  Object.assign(S, {
    phase: 'count',
    R: makeRound(S.round),
    startAt: now + COUNT_TIME,
    endAt: now + COUNT_TIME + ROUND_TIME,
    stops: null,
    deltas: null,
  });
  return true;
}

function finishRound(ctx, now) {
  const S = ctx.state;
  const stops = S.stops || {};
  const order = Object.entries(stops).sort((a, b) => a[1].err - b[1].err);
  const deltas = {};
  order.forEach(([id, s], i) => {
    const p = (POINTS[i] || 0) + (s.err <= BULLSEYE ? 1 : 0);
    if (p) deltas[id] = p;
  });
  S.scores = { ...(S.scores || {}) };
  for (const [id, d] of Object.entries(deltas)) S.scores[id] = (S.scores[id] || 0) + d;
  S.bulls = { ...(S.bulls || {}) };
  for (const [id, s] of order) if (s.err <= BULLSEYE) S.bulls[id] = (S.bulls[id] || 0) + 1;
  if (order[0] && (!S.best || order[0][1].err < S.best.err)) S.best = { id: order[0][0], err: order[0][1].err };
  Object.assign(S, { deltas, phase: 'result', phaseEndsAt: now + RESULT_TIME });
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const [bull, n] = Object.entries(S.bulls || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (n >= 1) add(bull, `🎯 정중앙 ${n}번`);
  if (S.best) add(S.best.id, `🔬 최소 오차 ${(S.best.err * 100).toFixed(1)}%`);
  Object.assign(S, { phase: 'final', over: true, titles });
  return true;
}

const pct = err => `${(err * 100).toFixed(1)}%`;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;

export default {
  id: 'stop',
  title: '멈춰라',
  emoji: '🎯',
  tag: '타이밍',
  color: '#e8590c',
  desc: '왔다 갔다 하는 바늘을 스페이스 한 번으로 멈춰서 과녁 한가운데에! 라운드마다 빨라지고 과녁은 작아져요',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx, prev) {
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + (prev ? AGAIN_INTRO : INTRO_TIME),
      again: !!prev,
      round: 0,
      totalRounds: ROUNDS,
      scores: Object.fromEntries(ctx.roster.map(p => [p.id, 0])),
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    const now = ctx.now();
    if (type !== 'stop' || !['count', 'play'].includes(S.phase) || data.round !== S.round) return false;
    if (!S.roster.some(p => p.id === pid) || S.stops?.[pid]) return false;
    const rel = now - S.startAt;
    if (rel < -300) return false;
    let t = Math.round(Number(data.t));
    if (!Number.isFinite(t)) return false;
    t = Math.min(rel + 100, Math.max(0, t, rel - MAX_LAG));
    if (t > ROUND_TIME) return false;
    const p = needleAt(S.R, t);
    S.stops = { ...(S.stops || {}), [pid]: { t, p: Math.round(p * 10000) / 10000, err: Math.round(Math.abs(p - S.R.center) * 10000) / 10000 } };
    return true;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intro') return now >= S.phaseEndsAt && startRound(S, now);
    if (S.phase === 'count') {
      if (now < S.startAt) return false;
      S.phase = 'play';
      return true;
    }
    if (S.phase === 'play') {
      const allIn = S.roster.filter(p => ctx.isOnline(p.id)).every(p => S.stops?.[p.id]);
      return (allIn || now >= S.endAt + GRACE) && finishRound(ctx, now);
    }
    if (S.phase === 'result' && now >= S.phaseEndsAt) return S.round >= S.totalRounds ? finish(ctx) : startRound(S, now);
    return false;
  },

  // 봇: 0.6~3.5초 기다렸다가, 다음에 바늘이 과녁 가운데를 지나는 순간을 노려 누른다 (사람처럼 0.03~0.08초 빗나감)
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase !== 'play' || S.stops?.[id]) return null;
    if (mem.round !== S.round) {
      mem.round = S.round;
      mem.skill ??= 30 + Math.random() * 50;
      const from = 600 + Math.random() * 2900;
      let best = from;
      let bestErr = Infinity;
      for (let t = from; t < Math.min(ROUND_TIME - 50, from + S.R.period); t += 2) {
        const e = Math.abs(needleAt(S.R, t) - S.R.center);
        if (e < bestErr) {
          bestErr = e;
          best = t;
        }
      }
      mem.at = S.startAt + Math.max(0, Math.min(ROUND_TIME - 10, best + gauss() * mem.skill));
    }
    if (now < mem.at) return null;
    // 누른 시각은 사람처럼 '누르려던 그 순간'으로 보낸다 (방장 계산 간격에 맞춰 늦어지면 빠른 라운드에서 엉뚱한 데 멈춤)
    return { type: 'stop', data: { round: S.round, t: Math.round(mem.at - S.startAt) }, say: Math.random() < 0.06 };
  },

  mount(root, api) {
    const me = api.me;
    const head = h('div', { class: 'rx-head' });
    const status = h('div', { class: 'sp-status' });
    const zone = h('div', { class: 'sp-zone' }, h('i', { class: 'sp-mid' }));
    const needle = h('div', { class: 'sp-needle' });
    const marks = h('div', { class: 'sp-marks' });
    const bar = h('div', { class: 'sp-bar' }, zone, marks, needle);
    const hint = h('div', { class: 'rx-sub sp-hint' });
    const board = h('div', { class: 'rx-board' });
    const pad = h('div', { class: 'rx-pad sp-pad' }, h('div', { class: 'sp-main' }, status, bar, hint), board);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rx sp' }, h('div', { class: 'rx-main' }, head, pad), side));
    document.activeElement?.blur?.();

    let S = null;
    let sent = null;
    let lastText = '';
    let marksKey = '';
    const isPlayer = () => S?.roster.some(p => p.id === me);
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };

    function onKey(e) {
      if (isTyping(e) || !S || e.code !== 'Space') return;
      e.preventDefault(); // 스페이스로 페이지가 스크롤되지 않게
      if (e.repeat || !isPlayer() || !['count', 'play'].includes(S.phase)) return;
      const now = api.now();
      if (now < S.startAt || now >= S.endAt || sent?.round === S.round || S.stops?.[me]) return;
      const t = Math.round(now - S.startAt);
      sent = { round: S.round, t, p: needleAt(S.R, t) };
      api.send('stop', { round: S.round, t });
      renderMarks();
      paint();
    }
    window.addEventListener('keydown', onKey);

    function renderMarks() {
      const stops = { ...(S.stops || {}) };
      if (sent?.round === S.round && !stops[me]) stops[me] = { p: sent.p };
      const key = JSON.stringify([S.round, stops]);
      if (key === marksKey) return;
      marksKey = key;
      marks.replaceChildren(...Object.entries(stops).map(([id, s]) => {
        const el = h('span', { class: `sp-mark${id === me ? ' me' : ''}` }, avatar(who(id)));
        el.style.left = `${s.p * 100}%`;
        return el;
      }));
    }

    function paint() {
      if (!S) return;
      const now = api.now();
      const playing = (S.phase === 'count' || S.phase === 'play') && S.R;
      if (S.R) {
        zone.style.left = `${(S.R.center - S.R.half) * 100}%`;
        zone.style.width = `${S.R.half * 200}%`;
      }
      const rel = now - (S.startAt || 0);
      if (playing && rel >= 0 && rel < ROUND_TIME) {
        needle.style.display = '';
        needle.style.left = `${needleAt(S.R, rel) * 100}%`;
      } else if (playing && rel < 0) {
        needle.style.display = '';
        needle.style.left = `${needleAt(S.R, 0) * 100}%`;
      } else needle.style.display = 'none';
      let text = '';
      let sub = '';
      if (S.phase === 'intro') {
        text = '🎯 멈춰라';
        sub = S.again ? '🔁 한 판 더!' : '바늘이 과녁 한가운데에 올 때 스페이스';
      } else if (playing) {
        const mine = S.stops?.[me] || (sent?.round === S.round ? sent : null);
        if (rel < 0) {
          text = String(Math.max(1, Math.ceil(-rel / 1000)));
          sub = S.R.warp ? '😵 이번엔 바늘이 빨라졌다 느려졌다 해요' : `라운드 ${S.round} · 과녁 한가운데를 노리세요`;
        } else {
          text = mine ? (S.stops?.[me] ? `오차 ${pct(S.stops[me].err)}` : '멈춤!') : '멈춰라!';
          sub = !isPlayer() ? '👀 관전 중' : mine ? '다른 친구들 기다리는 중' : `스페이스 = 멈추기 · ${Math.max(0, Math.ceil((ROUND_TIME - rel) / 1000))}초`;
        }
      }
      const key = `${text}|${sub}`;
      if (key !== lastText) {
        lastText = key;
        status.textContent = text;
        hint.textContent = sub;
      }
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function roundBoard() {
      const stops = S.stops || {};
      const deltas = S.deltas || {};
      const err = id => stops[id]?.err ?? 9;
      const rows = [...S.roster].sort((a, b) => err(a.id) - err(b.id));
      return h('div', { class: 'rx-result' },
        h('h2', { class: 'display' }, S.round >= S.totalRounds ? '마지막 라운드 결과' : `라운드 ${S.round} 결과`),
        h('ol', { class: 'rank-list' }, rows.map(p => {
          const s = stops[p.id];
          const d = deltas[p.id] || 0;
          return h('li', {},
            nameTag(p, me),
            h('span', { class: 'val' }, !s ? '안 멈춤' : `오차 ${pct(s.err)}${s.err <= BULLSEYE ? ' 🎯' : ''}`),
            h('b', { class: `delta ${d > 0 ? 'up' : ''}` }, d ? `+${d}` : ''));
        })));
    }

    function finalBoard() {
      return h('div', { class: 'rx-result' }, h('h2', { class: 'display' }, '최종 결과 🏆'), podium(S.roster, S.scores, me));
    }

    let lastBoard = '';
    return {
      update({ state }) {
        S = state;
        head.replaceChildren(
          h('span', {}, S.round ? `라운드 ${S.round} / ${S.totalRounds}` : '곧 시작해요'),
          h('span', {}, isPlayer() ? '과녁 한가운데에 멈추기!' : '👀 관전 중'));
        pad.classList.toggle('board', S.phase === 'result' || S.phase === 'final');
        if (S.phase === 'result' || S.phase === 'final') {
          const key = `${S.phase}:${S.round}`;
          if (key !== lastBoard) {
            lastBoard = key;
            board.replaceChildren(S.phase === 'final' ? finalBoard() : roundBoard());
          }
        }
        if (S.phase === 'count' || S.phase === 'play') renderMarks();
        side.replaceChildren(
          h('h3', {}, '점수'),
          scoreboard(S.roster, S.scores, me, S.phase === 'result' ? S.deltas : null),
          h('h3', {}, '규칙'),
          h('ul', { class: 'rules' },
            h('li', {}, '바늘이 왔다 갔다 해요. 스페이스 한 번 = 내 바늘 멈추기'),
            h('li', {}, '과녁 한가운데에 가까운 순서로 +3 · +2 · +1'),
            h('li', {}, '정중앙(오차 1% 안)이면 +1 🎯'),
            h('li', {}, `${ROUND_TIME / 1000}초 안에 안 멈추면 0점`),
            h('li', {}, '라운드마다 빨라지고, 4라운드부터 바늘 속도가 출렁여요'),
            h('li', {}, `${ROUNDS}라운드 합산`)));
        paint();
      },
      unmount() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
      },
    };
  },
};
