// 세어라: 정해진 동물(판마다 하나)이 지나갈 때마다 스페이스를 눌러서 실시간으로 센다. 다 지나가면 누른 횟수가 내 답.
// 1~2라운드는 그 동물만 걸어가고, 3라운드부터 다른 동물이 섞이고, 4라운드부터는 다른 동물 떼가 우르르 확 지나간다
// (떼 속에도 세는 동물이 한두 마리 숨어 있다). 라운드마다 더 많이·더 빨리.
// 정확히 맞히면 +3, 1마리 차이 +2, 2마리 차이 +1. 5라운드 합산.
// 지나가는 순서·자리·빠르기는 방장이 정해 state에 적고, 모두의 화면이 서버 시각에 맞춰 똑같이 그린다.
// 누른 횟수는 라운드가 끝날 때까지 방장만 안다(secret) → 남의 숫자를 볼 수 없고, 누를 때마다 상태를 안 보내서 렉도 없다.
import { h, isTyping, josa, pick, shuffle, AGAIN_INTRO } from '../util.js';
import { nameTag, podium, scoreboard } from '../ui.js';
import { ANIMALS, MEADOW, artSvg } from './count-art.js';

const ROUNDS = 5;
const INTRO_TIME = 6000;
const COUNT_TIME = 3000;     // 3·2·1
export const SHOW_TIME = 8000; // 동물들이 지나가는 시간
const LATE = 300;            // 다 지나간 직후 이만큼은 눌러도 인정
const GRACE = 900;           // 그다음 늦게 도착하는 신호를 기다린다
const RESULT_TIME = 4500;
const POINTS = [3, 2, 1];    // 오차 0 · 1 · 2마리
const MAX_LAG = 1500;
const MAX_TAPS = 60;

export const TARGETS = ANIMALS.slice(0, 6);
// 휙 지나가면 헷갈리는 짝: 세는 동물이 이 중 하나면 나머지는 그 판에 안 나온다 (어려움은 '많고 빠름'에서만)
const LOOKALIKE = [['deer', 'monkey', 'fox'], ['giraffe', 'deer']];
export const alike = (a, b) => a === b || LOOKALIKE.some(g => g.includes(a) && g.includes(b));

// 라운드별: 세는 동물 수 · 다른 동물 수 · 다른 동물 종류 · 떼 수 · 가로지르는 시간(ms)
const PLAN = [
  null,
  { n: [5, 8], d: [0, 0], kinds: 0, bursts: 0, dur: 2400 },
  { n: [7, 10], d: [0, 0], kinds: 0, bursts: 0, dur: 2000 },
  { n: [9, 12], d: [4, 6], kinds: 2, bursts: 0, dur: 1800 },
  { n: [10, 13], d: [8, 11], kinds: 3, bursts: 1, dur: 1500 },
  { n: [12, 15], d: [12, 16], kinds: 5, bursts: 2, dur: 1300 },
];
const between = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));
const LANES = [30, 45, 60, 75, 90]; // 위아래 자리(%). 하늘 말고 풀밭 위로만 다닌다

// 라운드 r의 행렬. 떼(burst): 다른 동물 4~5 + 세는 동물 1~2마리가 0.25초 안에 한꺼번에, 1.7배 빠르게 같은 쪽으로
export function makeShow(round, targetId) {
  const P = PLAN[Math.min(round, PLAN.length - 1)];
  const count = between(P.n);
  const decoys = between(P.d);
  const pool = shuffle(ANIMALS.filter(a => !alike(a.id, targetId))).slice(0, P.kinds).map(a => a.id);
  const busy = LANES.map(() => []);
  const walker = () => { // 같은 줄에선 시간이 안 겹치게 자리를 고른다 (서로 가리면 못 세니까)
    const dur = Math.round(P.dur * (0.8 + Math.random() * 0.4));
    let at = 0;
    let li = 0;
    for (let k = 0; k < 12; k++) {
      at = Math.round(Math.random() * (SHOW_TIME - dur));
      li = Math.floor(Math.random() * LANES.length);
      if (!busy[li].some(([a, b]) => at < b + 150 && at + dur > a - 150)) break;
    }
    busy[li].push([at, at + dur]);
    return { at, dur, y: LANES[li], dir: Math.random() < 0.5 ? 1 : -1 };
  };
  const items = shuffle([...Array(count).fill(targetId), ...Array.from({ length: decoys }, () => pick(pool))]).map(k => ({ k, ...walker() }));
  // 떼가 둘이면 시간을 나눠서 따로 온다 (겹치면 서로 가려서 셀 수가 없음)
  const slot = (SHOW_TIME - 750) / Math.max(1, P.bursts);
  for (let b = 1; b <= P.bursts; b++) {
    const dur = Math.round(P.dur * 0.6);
    const at0 = Math.round(600 + (b - 1) * slot + Math.random() * (slot - dur - 250));
    const dir = Math.random() < 0.5 ? 1 : -1;
    const free = want => shuffle(items.map((it, i) => [it, i]).filter(([it]) => !it.burst && (it.k === targetId) === want).map(([, i]) => i));
    const group = [...free(false).slice(0, 4 + Math.floor(Math.random() * 2)), ...free(true).slice(0, 1 + Math.floor(Math.random() * 2))];
    const gap = (LANES.at(-1) - LANES[0]) / Math.max(1, group.length - 1); // 위아래로 고르게 (서로 안 가리게)
    shuffle(group).forEach((i, j) => Object.assign(items[i], {
      at: at0 + Math.round(Math.random() * 250), dur, dir, burst: b,
      y: Math.round(LANES[0] + j * gap),
    }));
  }
  items.sort((a, b) => a.at - b.at);
  return { list: items, count, decoys };
}

// 오차 → 점수
export const pointsFor = (n, truth) => POINTS[Math.abs(n - truth)] || 0;

function startRound(ctx, now) {
  const S = ctx.state;
  S.round += 1;
  const startAt = now + COUNT_TIME;
  ctx.secret.taps = {};
  Object.assign(S, {
    phase: 'count',
    show: makeShow(S.round, S.target.id),
    startAt,
    showEnd: startAt + SHOW_TIME,
    counts: null,
    deltas: null,
  });
  return true;
}

function finishRound(ctx, now) {
  const S = ctx.state;
  const truth = S.show.count;
  const taps = ctx.secret.taps || {};
  const counts = Object.fromEntries(S.roster.map(p => [p.id, taps[p.id] || 0]));
  const deltas = {};
  S.scores = { ...(S.scores || {}) };
  S.exacts = { ...(S.exacts || {}) };
  S.overs = { ...(S.overs || {}) };
  for (const [id, n] of Object.entries(counts)) {
    const p = pointsFor(n, truth);
    if (p) {
      deltas[id] = p;
      S.scores[id] = (S.scores[id] || 0) + p;
    }
    if (n === truth) S.exacts[id] = (S.exacts[id] || 0) + 1;
    if (n > truth) S.overs[id] = (S.overs[id] || 0) + n - truth;
  }
  Object.assign(S, { counts, deltas, phase: 'result', phaseEndsAt: now + RESULT_TIME });
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const top = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  const [eye, n] = top(S.exacts);
  if (n >= 2) add(eye, `🦅 매의 눈 (정답 ${n}번)`);
  const [hasty, m] = top(S.overs);
  if (m >= 3) add(hasty, `🔨 손이 먼저 (${m}번 더 누름)`);
  Object.assign(S, { phase: 'final', over: true, titles });
  return true;
}

export default {
  id: 'count',
  title: '세어라',
  emoji: '🐾',
  tag: '타이밍',
  color: '#fab005',
  desc: '정해진 동물이 지나갈 때마다 스페이스로 세기! 갈수록 다른 동물들이 떼로 확 지나가요',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx, prev) {
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + (prev ? AGAIN_INTRO : INTRO_TIME),
      again: !!prev,
      round: 0,
      totalRounds: ROUNDS,
      target: pick(TARGETS.filter(t => t.id !== prev?.state?.target?.id)), // 이번 판에 셀 동물 (한 판 더면 다른 동물로)
      scores: Object.fromEntries(ctx.roster.map(p => [p.id, 0])),
    };
  },

  // 누른 횟수는 secret에만 쌓는다: false를 돌려주니 상태 전송이 없다
  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    if (type !== 'tap' || !['count', 'show'].includes(S.phase) || data.round !== S.round) return false;
    if (!S.roster.some(p => p.id === pid)) return false;
    const rel = ctx.now() - S.startAt;
    if (rel < -150) return false; // 시작 전
    let t = Math.round(Number(data.t));
    if (!Number.isFinite(t)) t = Math.round(rel);
    t = Math.min(rel + 100, Math.max(0, t, rel - MAX_LAG));
    if (t > SHOW_TIME + LATE) return false; // 다 지나간 뒤
    const taps = (ctx.secret.taps ||= {});
    if ((taps[pid] || 0) < MAX_TAPS) taps[pid] = (taps[pid] || 0) + 1;
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intro') return now >= S.phaseEndsAt && startRound(ctx, now);
    if (S.phase === 'count') {
      if (now < S.startAt) return false;
      S.phase = 'show';
      return true;
    }
    if (S.phase === 'show') return now >= S.showEnd + GRACE && finishRound(ctx, now);
    if (S.phase === 'result' && now >= S.phaseEndsAt) return S.round >= S.totalRounds ? finish(ctx) : startRound(ctx, now);
    return false;
  },

  // 봇: 세는 동물이 지나갈 때 대체로 누르지만, 뒤 라운드일수록 놓치거나 다른 동물에 잘못 누른다
  bot(ctx, id, mem) {
    const S = ctx.state;
    if (S.phase !== 'count' && S.phase !== 'show') return null;
    if (mem.round !== S.round) {
      const r = Math.min(S.round, 5);
      const hit = [0, 0.97, 0.95, 0.92, 0.88, 0.84][r];
      const wrong = [0, 0, 0, 0.05, 0.07, 0.09][r];
      mem.round = S.round;
      mem.taps = [];
      for (const c of S.show.list) {
        const mine = c.k === S.target.id;
        if (Math.random() < (mine ? hit : wrong)) mem.taps.push(S.startAt + c.at + c.dur * (0.2 + Math.random() * 0.5));
        if (mine && Math.random() < 0.03) mem.taps.push(S.startAt + c.at + c.dur * 0.75); // 실수로 두 번
      }
      mem.taps.sort((a, b) => a - b);
    }
    if (!mem.taps.length || ctx.now() < mem.taps[0]) return null;
    return { type: 'tap', data: { round: S.round, t: Math.round(mem.taps.shift() - S.startAt) } };
  },

  mount(root, api) {
    const me = api.me;
    const art = (id, cls) => {
      const el = h('span', { class: cls });
      el.innerHTML = artSvg(id);
      return el;
    };
    const bg = h('div', { class: 'cn-bgwrap' });
    bg.innerHTML = MEADOW;
    const head = h('div', { class: 'rx-head' });
    const field = h('div', { class: 'cn-field' });
    const center = h('div', { class: 'cn-center' });
    const bar = h('div', { class: 'cn-bar' });
    const board = h('div', { class: 'rx-board' });
    const stage = h('div', { class: 'cn-stage' }, bg, field, center);
    const pad = h('div', { class: 'rx-pad cn-pad' }, h('div', { class: 'cn-main' }, stage, bar), board);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rx cn' }, h('div', { class: 'rx-main' }, head, pad), side));
    document.activeElement?.blur?.();

    let S = null;
    let taps = 0;
    let tapRound = -1;
    let fieldKey = '';
    let critters = [];
    let centerKey = '';
    let barKey = '';
    let numEl = null;
    const isPlayer = () => S?.roster.some(p => p.id === me);
    const T = () => S?.target || TARGETS[0];
    const myTaps = () => (tapRound === S?.round ? taps : 0);

    function onKey(e) {
      if (isTyping(e) || e.code !== 'Space' || !S || !isPlayer()) return;
      if (S.phase !== 'count' && S.phase !== 'show') return;
      e.preventDefault();
      if (e.repeat) return;
      const now = api.now();
      if (now < S.startAt || now > S.showEnd + LATE) return;
      if (tapRound !== S.round) {
        tapRound = S.round;
        taps = 0;
      }
      if (taps >= MAX_TAPS) return;
      taps += 1;
      api.send('tap', { round: S.round, t: Math.round(now - S.startAt) });
      renderBar();
      if (numEl) {
        numEl.classList.remove('pop');
        void numEl.offsetWidth; // 애니메이션을 처음부터 다시
        numEl.classList.add('pop');
      }
    }
    window.addEventListener('keydown', onKey);

    function buildField() {
      const key = `${S.round}:${S.startAt}`;
      if (key === fieldKey) return;
      fieldKey = key;
      critters = (S.show?.list || []).map(c => {
        const el = art(c.k, `cn-critter${c.dir < 0 ? ' flip' : ''}`);
        el.style.top = `${c.y}%`;
        el.style.zIndex = c.y; // 아래쪽(가까운) 동물이 위로
        el.style.display = 'none';
        el.style.setProperty('--step', `${Math.max(90, Math.round(c.dur / 10))}ms`);
        return { c, el };
      });
      field.replaceChildren(...critters.map(x => x.el));
    }

    function renderCenter(key) {
      const name = T().name;
      if (key === 'intro') {
        center.replaceChildren(h('div', { class: 'cn-card' },
          art(T().id, 'cn-hero'),
          h('h2', { class: 'display' }, `이번 판은 ${name}!`),
          h('p', {}, S.again ? '🔁 한 판 더!' : `${josa(name, '이', '가')} 지나갈 때마다 스페이스 한 번 · 누른 횟수가 내 답`)));
      } else if (key[0] === 'n') {
        center.replaceChildren(h('div', { class: 'cn-card small' },
          h('div', { class: 'cn-num display' }, key.slice(1)),
          art(T().id, 'cn-mini'),
          h('p', {}, `${name}만 세요${S.show?.decoys ? ' · 다른 동물은 빼고' : ''}${S.round >= 4 ? ' · 떼로 확 지나가요' : ''}`)));
      } else if (key === 'end') {
        center.replaceChildren(h('div', { class: 'cn-card small' }, h('p', { class: 'cn-done display' }, '다 지나갔다!')));
      } else center.replaceChildren();
    }

    function renderBar() {
      if (!S) return;
      const live = S.phase === 'count' || S.phase === 'show';
      const key = !isPlayer() ? 'spec' : `${live ? 'live' : 'off'}:${S.target?.id}:${myTaps()}`;
      if (key === barKey) return;
      barKey = key;
      if (!isPlayer()) {
        numEl = null;
        bar.replaceChildren(h('span', { class: 'cn-keyhint' }, '👀 관전 중'));
        return;
      }
      numEl = h('b', { class: 'cn-count display' }, String(myTaps()));
      bar.replaceChildren(
        art(T().id, 'cn-mini'),
        h('span', { class: 'cn-barname' }, `${T().name} ×`),
        numEl,
        h('span', { class: 'cn-keyhint' }, h('kbd', {}, '스페이스'), ' = 한 마리'));
    }

    function paint() {
      if (!S) return;
      const now = api.now();
      const live = S.phase === 'count' || S.phase === 'show';
      const rel = now - S.startAt;
      // 지나가는 동물: 서버 시각 기준이라 모두 같은 장면
      for (const { c, el } of critters) {
        const f = (rel - c.at) / c.dur;
        if (!live || f < 0 || f > 1) {
          if (el.style.display !== 'none') el.style.display = 'none';
          continue;
        }
        if (el.style.display === 'none') el.style.display = '';
        const x = c.dir > 0 ? -9 + f * 118 : 109 - f * 118;
        el.style.transform = `translate(calc(${x.toFixed(2)}cqw - 50%), -50%)`;
      }
      let key = 'off';
      if (S.phase === 'intro') key = 'intro';
      else if (live && now < S.startAt) key = `n${Math.max(1, Math.ceil((S.startAt - now) / 1000))}`;
      else if (live && now >= S.showEnd) key = 'end';
      if (key !== centerKey) {
        centerKey = key;
        renderCenter(key);
      }
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function roundBoard() {
      const truth = S.show.count;
      const counts = S.counts || {};
      const deltas = S.deltas || {};
      const err = id => Math.abs((counts[id] || 0) - truth);
      const rows = [...S.roster].sort((a, b) => err(a.id) - err(b.id));
      return h('div', { class: 'rx-result' },
        h('div', { class: 'cn-answer' }, art(T().id, 'cn-mini'), h('h2', { class: 'display' }, `정답: ${T().name} ${truth}마리`)),
        S.show.decoys ? h('p', { class: 'muted' }, `다른 동물은 ${S.show.decoys}마리 지나갔어요`) : null,
        h('ol', { class: 'rank-list' }, rows.map(p => {
          const n = counts[p.id] || 0;
          const d = deltas[p.id] || 0;
          return h('li', { class: err(p.id) > 2 ? 'bad' : '' },
            nameTag(p, me),
            h('span', { class: 'val' }, `${n}번 누름${n === truth ? ' 🎯' : ` (${n > truth ? '+' : ''}${n - truth})`}`),
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
          h('span', {}, isPlayer() ? `${T().name} 세는 중` : '👀 관전 중'));
        buildField();
        pad.classList.toggle('board', S.phase === 'result' || S.phase === 'final');
        if (S.phase === 'result' || S.phase === 'final') {
          const key = `${S.phase}:${S.round}`;
          if (key !== lastBoard) {
            lastBoard = key;
            board.replaceChildren(S.phase === 'final' ? finalBoard() : roundBoard());
          }
        }
        side.replaceChildren(
          h('h3', {}, '점수'),
          scoreboard(S.roster, S.scores, me, S.phase === 'result' ? S.deltas : null),
          h('h3', {}, '규칙'),
          h('ul', { class: 'rules' },
            h('li', {}, `이번 판은 ${T().name}만 세요`),
            h('li', {}, `${josa(T().name, '이', '가')} 지나갈 때마다 스페이스 한 번`),
            h('li', {}, '다 지나가면 누른 횟수가 내 답'),
            h('li', {}, '정확히 +3 · 1마리 차이 +2 · 2마리 차이 +1'),
            h('li', {}, '3라운드부터 다른 동물이 섞이고, 4라운드부터 떼로 확 지나가요'),
            h('li', {}, `${ROUNDS}라운드 합산`)));
        renderBar();
        paint();
      },
      unmount() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
      },
    };
  },
};
