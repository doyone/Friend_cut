// 불어라: 각자 풍선에 스페이스로 바람을 한 번씩 넣는다 (넣을 때마다 커지는 양은 들쭉날쭉).
// 풍선마다 숨은 한계가 있어서 넘으면 💥 펑 (그 라운드 0점). ↓(S) = 묶기: 지금 크기로 확정. 10초가 끝나면 자동으로 묶인다.
// 안 터진 풍선 중 제일 큰 사람 +3 · 2등 +2 · 3등 +1. 5라운드 합산. 라운드가 끝나면 각자 한계가 공개된다.
// 한계는 사람마다 다르고 방장만 안다(ctx.secret). 커질수록 풍선이 떨리지만 크기 기준이라 한계를 알려 주진 않는다.
// 바람 넣기는 누를 때마다 방장에게 가지만, 상태는 0.1초에 한 번만 모두에게 보낸다(commitMs) → 여럿이 연달아 눌러도 렉 없음.
import { h, isTyping, AGAIN_INTRO } from '../util.js';
import { avatar, nameTag, podium, scoreboard } from '../ui.js';

const ROUNDS = 5;
const INTRO_TIME = 5000;
const COUNT_TIME = 2500;
const ROUND_TIME = 10000;
const RESULT_TIME = 3800;
const POINTS = [3, 2, 1];
const PUMP_MIN = 3;          // 한 번 넣을 때 커지는 양 (크기 0~100 기준)
const PUMP_MAX = 9;
const LIMIT_MIN = 45;        // 풍선마다 숨은 한계
const LIMIT_MAX = 100;
const MIN_GAP = 90;          // 같은 사람 바람 넣기 사이 최소 간격 (ms): 매크로로 마구 누르기 막기
const r1 = v => Math.round(v * 10) / 10;

function startRound(ctx, now) {
  const S = ctx.state;
  S.round += 1;
  ctx.secret.limits = Object.fromEntries(S.roster.map(p => [p.id, r1(LIMIT_MIN + Math.random() * (LIMIT_MAX - LIMIT_MIN))]));
  Object.assign(S, {
    phase: 'count',
    startAt: now + COUNT_TIME,
    endAt: now + COUNT_TIME + ROUND_TIME,
    size: null,
    done: null,
    pumpAt: null,
    limits: null,   // 라운드가 끝나면 공개
    deltas: null,
  });
  return true;
}

function finishRound(ctx, now) {
  const S = ctx.state;
  const done = { ...(S.done || {}) };
  for (const p of S.roster) if (!done[p.id]) done[p.id] = 'tied'; // 시간 끝: 자동으로 묶임
  const sizes = S.size || {};
  const ranked = Object.entries(done).filter(([id, d]) => d === 'tied' && (sizes[id] || 0) > 0)
    .map(([id]) => [id, sizes[id]]).sort((a, b) => b[1] - a[1]);
  const deltas = {};
  ranked.forEach(([id], i) => { if (POINTS[i]) deltas[id] = POINTS[i]; });
  S.scores = { ...(S.scores || {}) };
  for (const [id, d] of Object.entries(deltas)) S.scores[id] = (S.scores[id] || 0) + d;
  S.pops = { ...(S.pops || {}) };
  for (const [id, d] of Object.entries(done)) if (d === 'pop') S.pops[id] = (S.pops[id] || 0) + 1;
  if (ranked[0] && (!S.biggest || ranked[0][1] > S.biggest.size)) S.biggest = { id: ranked[0][0], size: ranked[0][1] };
  Object.assign(S, { done, deltas, limits: { ...ctx.secret.limits }, phase: 'result', phaseEndsAt: now + RESULT_TIME });
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  if (S.biggest) add(S.biggest.id, `🎈 왕풍선 (${Math.round(S.biggest.size)})`);
  const [pop, n] = Object.entries(S.pops || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (n >= 2) add(pop, `💥 펑펑 (${n}번)`);
  Object.assign(S, { phase: 'final', over: true, titles });
  return true;
}

export default {
  id: 'balloon',
  title: '불어라',
  emoji: '🎈',
  tag: '우정파괴',
  color: '#e64980',
  desc: '스페이스로 풍선에 바람을 넣고 ↓로 묶기! 안 터진 풍선 중 제일 크면 승리. 풍선마다 숨은 한계가 있어서 욕심내면 💥',
  minPlayers: 2,
  maxPlayers: 8,
  commitMs: 100, // 바람은 자주 들어오니 상태는 0.1초에 한 번만 보낸다

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
    if (!['count', 'play'].includes(S.phase) || data.round !== S.round) return false;
    if (!S.roster.some(p => p.id === pid) || S.done?.[pid] || now < S.startAt - 300 || now >= S.endAt) return false;
    if (type === 'pump') {
      if (now - (S.pumpAt?.[pid] || 0) < MIN_GAP) return false;
      const size = r1((S.size?.[pid] || 0) + PUMP_MIN + Math.random() * (PUMP_MAX - PUMP_MIN));
      S.size = { ...(S.size || {}), [pid]: size };
      S.pumpAt = { ...(S.pumpAt || {}), [pid]: now };
      if (size > ctx.secret.limits[pid]) S.done = { ...(S.done || {}), [pid]: 'pop' };
      return true;
    }
    if (type === 'tie') {
      if (!(S.size?.[pid] > 0)) return false; // 빈 풍선은 못 묶음 (실수로 처음부터 묶지 않게)
      S.done = { ...(S.done || {}), [pid]: 'tied' };
      return true;
    }
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intro') return now >= S.phaseEndsAt && startRound(ctx, now);
    if (S.phase === 'count') {
      if (now < S.startAt) return false;
      S.phase = 'play';
      return true;
    }
    if (S.phase === 'play') {
      const allDone = S.roster.filter(p => ctx.isOnline(p.id)).every(p => S.done?.[p.id]);
      return (allDone || now >= S.endAt) && finishRound(ctx, now);
    }
    if (S.phase === 'result' && now >= S.phaseEndsAt) return S.round >= S.totalRounds ? finish(ctx) : startRound(ctx, now);
    return false;
  },

  // 봇: 라운드마다 50~80 사이 목표를 정하고 0.25~0.5초마다 바람. 남이 더 크게 묶으면 반쯤은 욕심내서 목표를 올린다
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase !== 'play' || S.done?.[id]) return null;
    if (mem.round !== S.round) Object.assign(mem, { round: S.round, target: 50 + Math.random() * 30, next: 0, raised: false });
    const others = Object.entries(S.done || {}).filter(([pid, d]) => pid !== id && d === 'tied').map(([pid]) => S.size?.[pid] || 0);
    const best = others.length ? Math.max(...others) : 0;
    if (best > mem.target && !mem.raised) {
      mem.raised = true;
      if (Math.random() < 0.5) mem.target = best + 2 + Math.random() * 5;
    }
    const size = S.size?.[id] || 0;
    if (size > 0 && (size >= mem.target || now >= S.endAt - 400)) return { type: 'tie', data: { round: S.round }, say: Math.random() < 0.08 };
    if (now < mem.next) return null;
    mem.next = now + 250 + Math.random() * 250;
    return { type: 'pump', data: { round: S.round } };
  },

  mount(root, api) {
    const me = api.me;
    const head = h('div', { class: 'rx-head' });
    const status = h('div', { class: 'bl-status' });
    const row = h('div', { class: 'bl-row' });
    const hint = h('div', { class: 'rx-sub bl-hint' });
    const board = h('div', { class: 'rx-board' });
    const pad = h('div', { class: 'rx-pad bl-pad' }, h('div', { class: 'bl-main' }, status, row, hint), board);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rx bl' }, h('div', { class: 'rx-main' }, head, pad), side));
    document.activeElement?.blur?.();

    let S = null;
    let lastText = '';
    let rowKey = '';
    let lastSend = 0;
    const els = new Map(); // id → { wrap, svg, tag }
    const isPlayer = () => S?.roster.some(p => p.id === me);
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const myTurnOn = () => isPlayer() && ['count', 'play'].includes(S.phase) && api.now() >= S.startAt && api.now() < S.endAt && !S.done?.[me];

    function onKey(e) {
      if (isTyping(e) || !S) return;
      if (e.code !== 'Space' && e.code !== 'ArrowDown' && e.code !== 'KeyS') return;
      if (e.code !== 'KeyS') e.preventDefault(); // 스페이스·방향키로 페이지가 스크롤되지 않게
      if (e.repeat || !myTurnOn()) return;
      if (e.code === 'Space') {
        if (performance.now() - lastSend < MIN_GAP) return;
        lastSend = performance.now();
        api.send('pump', { round: S.round });
        puff();
      } else {
        api.send('tie', { round: S.round });
      }
    }
    window.addEventListener('keydown', onKey);

    // 내 풍선 위에 '+' 잠깐 (방장 답이 오기 전에도 눌렀다는 느낌)
    function puff() {
      const it = els.get(me);
      if (!it) return;
      const el = h('i', { class: 'bl-puff' }, '+');
      it.wrap.append(el);
      setTimeout(() => el.remove(), 450);
    }

    function balloon(p) {
      const wrap = h('div', { class: `bl-one${p.id === me ? ' me' : ''}` });
      const color = /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#bdc3c7';
      wrap.innerHTML = `<svg viewBox="-50 -110 100 160" aria-hidden="true">
        <g class="bl-b"><ellipse cx="0" cy="-50" rx="34" ry="40" fill="${color}" stroke="#2c3e50" stroke-width="3"/>
        <ellipse cx="-12" cy="-66" rx="7" ry="11" fill="#fff" opacity=".45"/>
        <path d="M -5 -10 L 5 -10 L 0 -3 Z" fill="${color}" stroke="#2c3e50" stroke-width="2"/></g>
        <path class="bl-string" d="M 0 -3 Q -6 15 0 30 Q 6 42 0 48" fill="none" stroke="#868e96" stroke-width="2"/>
        <text class="bl-mark" x="0" y="-50"></text></svg>`;
      const tag = h('div', { class: 'bl-tag' }, avatar(p), p.name);
      wrap.append(tag);
      return { wrap, svg: wrap.querySelector('svg'), b: wrap.querySelector('.bl-b'), mark: wrap.querySelector('.bl-mark'), tag };
    }

    function renderRow() {
      const key = `${S.round}:${S.roster.map(p => p.id).join(',')}`;
      if (key !== rowKey) {
        rowKey = key;
        els.clear();
        row.replaceChildren(...S.roster.map(p => {
          const it = balloon(p);
          els.set(p.id, it);
          return it.wrap;
        }));
      }
      for (const p of S.roster) {
        const it = els.get(p.id);
        const size = S.size?.[p.id] || 0;
        const d = S.done?.[p.id];
        // 크기 0~100 → 0.35배~1.3배. 커질수록 떨림 (크기 기준이라 한계를 알려 주진 않음)
        const k = 0.35 + (Math.min(size, 110) / 100) * 0.95;
        it.b.style.transform = `scale(${d === 'pop' ? 0.05 : k.toFixed(3)})`; // 꼭지(0,-10) 기준으로 스르륵 (css .bl-b)
        it.mark.setAttribute('y', d === 'tied' ? 10 : -50);
        it.wrap.classList.toggle('w1', size >= 55 && !d);
        it.wrap.classList.toggle('w2', size >= 75 && !d);
        it.wrap.classList.toggle('pop', d === 'pop');
        it.wrap.classList.toggle('tied', d === 'tied');
        it.mark.textContent = d === 'pop' ? '💥' : d === 'tied' ? '🎀' : '';
      }
    }

    function paint() {
      if (!S) return;
      const now = api.now();
      let text = '';
      let sub = '';
      if (S.phase === 'intro') {
        text = '🎈 불어라';
        sub = S.again ? '🔁 한 판 더!' : '스페이스 = 바람 넣기 · ↓ = 묶기';
      } else if (S.phase === 'count' || S.phase === 'play') {
        if (now < S.startAt) {
          text = String(Math.max(1, Math.ceil((S.startAt - now) / 1000)));
          sub = `라운드 ${S.round} · 풍선마다 숨은 한계가 있어요`;
        } else {
          const d = S.done?.[me];
          text = d === 'pop' ? '💥 펑!' : d === 'tied' ? '🎀 묶었다!' : '불어라!';
          sub = !isPlayer() ? '👀 관전 중' : d ? '다른 친구들 기다리는 중' : `스페이스 = 바람 · ↓ = 묶기 · ${Math.max(0, Math.ceil((S.endAt - now) / 1000))}초`;
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
      const sizes = S.size || {};
      const done = S.done || {};
      const deltas = S.deltas || {};
      const val = id => (done[id] === 'pop' ? -1 : sizes[id] || 0);
      const rows = [...S.roster].sort((a, b) => val(b.id) - val(a.id));
      return h('div', { class: 'rx-result' },
        h('h2', { class: 'display' }, S.round >= S.totalRounds ? '마지막 라운드 결과' : `라운드 ${S.round} 결과`),
        h('ol', { class: 'rank-list' }, rows.map(p => {
          const d = deltas[p.id] || 0;
          const lim = S.limits?.[p.id];
          return h('li', { class: done[p.id] === 'pop' ? 'bad' : '' },
            nameTag(p, me),
            h('span', { class: 'val' }, `${done[p.id] === 'pop' ? '💥 펑' : `🎈 ${Math.round(sizes[p.id] || 0)}`}${lim ? ` · 한계 ${Math.round(lim)}` : ''}`),
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
          h('span', {}, isPlayer() ? '안 터지게, 제일 크게!' : '👀 관전 중'));
        pad.classList.toggle('board', S.phase === 'result' || S.phase === 'final');
        if (S.phase === 'result' || S.phase === 'final') {
          const key = `${S.phase}:${S.round}`;
          if (key !== lastBoard) {
            lastBoard = key;
            board.replaceChildren(S.phase === 'final' ? finalBoard() : roundBoard());
          }
        } else {
          renderRow();
        }
        side.replaceChildren(
          h('h3', {}, '점수'),
          scoreboard(S.roster, S.scores, me, S.phase === 'result' ? S.deltas : null),
          h('h3', {}, '규칙'),
          h('ul', { class: 'rules' },
            h('li', {}, '스페이스 = 바람 한 번 (커지는 양은 그때그때 달라요)'),
            h('li', {}, '↓ (S) = 묶기: 지금 크기로 확정'),
            h('li', {}, '풍선마다 숨은 한계가 있어서 넘으면 💥 펑, 그 라운드 0점'),
            h('li', {}, '안 터진 풍선 중 큰 순서로 +3 · +2 · +1'),
            h('li', {}, `${ROUND_TIME / 1000}초가 끝나면 자동으로 묶여요`),
            h('li', {}, `${ROUNDS}라운드 합산 · 라운드가 끝나면 한계 공개`)));
        paint();
      },
      unmount() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
      },
    };
  },
};
