// 세어라 (2라운드): 정해진 동물만 스페이스로 센다. 스페이스 = +1, 백스페이스 = -1, 끝났을 때 숫자가 내 답.
// 1라운드: 동물들이 풀밭을 가로질러 지나간다. 처음엔 한 마리씩 천천히 오다가, 간격·빠르기가 기하급수로 세지고
//          다른 동물이 섞이고, 뒤로 갈수록 떼가 점점 자주 몰려와서 끝엔 감당이 안 된다. 후반엔 지그재그로 달리는 동물도 섞인다.
// 2라운드: 화면 전체에 동물이 쫙 깔려서 제자리 근처를 조금씩 어슬렁거린다. 그중 정해진 동물을 5초 안에 센다.
// 점수: 정답에 제일 가까운 순으로 +5·+3·+2·+1, 정확히 맞히면 +2 더. 한 번도 안 누르면 0점.
// 동물 행렬은 방장이 정해 state에 적고, 모두의 화면이 서버 시각에 맞춰 똑같이 그린다.
// 누른 횟수는 라운드가 끝날 때까지 방장만 안다(secret) → 남의 숫자를 볼 수 없고, 누를 때마다 상태를 안 보내서 렉도 없다.
import { h, isTyping, josa, pick, shuffle, INTRO_TIME } from '../util.js';
import { nameTag, podium, scoreboard } from '../ui.js';
import { ANIMALS, GRASS, MEADOW, artSvg } from './count-art.js';

const ROUNDS = 2;
const COUNT_TIME = 3000;       // 1라운드 3·2·1
const CROWD_READY = 3000;      // 2라운드도 3·2·1
export const RUSH_TIME = 25000;  // 1라운드 길이
export const CROWD_TIME = 5000;  // 2라운드에 동물을 보는 시간
const LATE = 300;              // 끝난 직후 이만큼은 눌러도 인정
const GRACE = 900;             // 그다음 늦게 도착하는 신호를 기다린다
const REVEAL = 2600;           // 2라운드 끝나고 정답 동물만 밝게 보여 주는 시간 (그동안 늦은 신호도 받는다)
const RESULT_TIME = 5000;
const POINTS = [5, 3, 2, 1];   // 정답에 제일 가까운 순
const EXACT_BONUS = 2;
const MAX_LAG = 1500;
const MAX_TAPS = 300;

export const TARGETS = ANIMALS.slice(0, 6);
// 휙 지나가면 헷갈리는 짝: 세는 동물이 이 중 하나면 나머지는 그 라운드에 안 나온다 (어려움은 '많고 빠름'에서만)
const LOOKALIKE = [['deer', 'monkey', 'fox'], ['giraffe', 'deer']];
export const alike = (a, b) => a === b || LOOKALIKE.some(g => g.includes(a) && g.includes(b));

/* ── 1라운드 행렬: 진행률 f(0~1)에 따라 기하급수로 세진다 ── */
const GAP = [1400, 90];        // 다음 동물이 나올 때까지(ms): 처음 → 끝
const DUR = [3000, 800];       // 화면을 가로지르는 시간(ms): 처음 → 끝
const WAVES = [0.42, 0.58, 0.7, 0.8, 0.88, 0.94]; // 떼가 몰려오는 때: 갈수록 자주
const LANES = [30, 45, 60, 75, 90]; // 위아래 자리(%). 하늘 말고 풀밭 위로만 다닌다
const expo = ([a, b], f) => a * (b / a) ** Math.min(1, f);
// 세는 동물의 비율: 처음 20%는 그 동물만, 끝엔 38%까지 줄어든다
const targetShare = f => (f < 0.2 ? 1 : 0.38 + 0.62 * (1 - (f - 0.2) / 0.8) ** 2);
// 섞이는 동물 종류: 뒤로 갈수록 많아진다
const kindsAt = f => (f < 0.35 ? 1 : f < 0.5 ? 2 : f < 0.65 ? 3 : f < 0.8 ? 5 : 99);
// 후반(진행률 50%~)엔 위아래로 꺾으며 달리는 동물이 섞인다: 갈수록 많아지고(절반 → 전부) 크게 꺾인다(폭 5 → 10%)
const ZIG_FROM = 0.5;
const ZIG_TOP = 30;            // 위아래로 꺾여도 풀밭 안에 있게
const ZIG_BOTTOM = 92;
function zigOf(f, y) {
  if (f < ZIG_FROM || Math.random() > 0.5 + (f - ZIG_FROM)) return { y };
  const zig = Math.round(5 + ((f - ZIG_FROM) / (1 - ZIG_FROM)) * 5);
  return { y: Math.max(ZIG_TOP + zig, Math.min(ZIG_BOTTOM - zig, y)), zig, zc: Math.round((1.5 + Math.random() * 1.5) * 100) / 100, zp: Math.round(Math.random() * 100) / 100 };
}

export function makeRush(targetId) {
  const pool = shuffle(ANIMALS.filter(a => !alike(a.id, targetId))).map(a => a.id);
  const others = f => pick(pool.slice(0, kindsAt(f)));
  const list = [];
  const used = LANES.map(() => -1e9);
  let t = 300;
  for (;;) {
    const f = t / RUSH_TIME;
    const dur = Math.round(expo(DUR, f) * (0.85 + Math.random() * 0.3));
    if (t + dur > RUSH_TIME) break;
    // 제일 오래 비어 있던 줄로 (서로 가리지 않게)
    const order = LANES.map((_, i) => i).sort((a, b) => used[a] - used[b]);
    const li = order[Math.random() < 0.7 ? 0 : 1];
    used[li] = t;
    list.push({ k: Math.random() < targetShare(f) ? targetId : others(f), at: Math.round(t), dur, dir: Math.random() < 0.5 ? 1 : -1, ...zigOf(f, LANES[li]) });
    t += expo(GAP, f) * (0.75 + Math.random() * 0.5);
  }
  // 떼: 다섯 줄을 한꺼번에 같은 쪽으로 (세는 동물이 1~2마리 숨어 있다)
  for (const f of WAVES) {
    const at = Math.round(f * RUSH_TIME);
    const dur = Math.round(expo(DUR, f) * 0.7);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const hidden = 1 + Math.floor(Math.random() * 2);
    shuffle(LANES).forEach((y, i) => list.push({ k: i < hidden ? targetId : others(f), at: at + Math.round(Math.random() * 200), dur, dir, wave: 1, ...zigOf(f, y) }));
  }
  list.sort((a, b) => a.at - b.at);
  const count = list.filter(c => c.k === targetId).length;
  return { list, count, decoys: list.length - count };
}

/* ── 2라운드 행렬: 칸마다 한 마리씩, 빈칸을 조금 두고 쫙 깐다 ── */
const COLS = 13;
const ROWS = 8;
const r2 = v => Math.round(v * 100) / 100;

export function makeCrowd(targetId) {
  const pool = ANIMALS.filter(a => !alike(a.id, targetId)).map(a => a.id);
  const total = 78 + Math.floor(Math.random() * 10);
  const count = 14 + Math.floor(Math.random() * 9);
  const kinds = shuffle([...Array(count).fill(targetId), ...Array.from({ length: total - count }, () => pick(pool))]);
  const cells = shuffle(Array.from({ length: COLS * ROWS }, (_, i) => i));
  const jitter = () => (Math.random() - 0.5) * 0.4;
  const list = kinds.map((k, i) => ({
    k,
    x: r2(4 + (((cells[i] % COLS) + 0.5 + jitter()) / COLS) * 92),
    y: r2(6 + ((Math.floor(cells[i] / COLS) + 0.5 + jitter()) / ROWS) * 89),
    ax: r2(0.5 + Math.random() * 0.9), // 어슬렁거리는 폭 (화면 비율 %)
    ay: r2(0.6 + Math.random() * 1.1),
    px: Math.round(2600 + Math.random() * 3000), // 한 번 왔다 갔다 하는 시간
    py: Math.round(2400 + Math.random() * 3000),
    p1: r2(Math.random()),
    p2: r2(Math.random()),
  }));
  return { list, count, decoys: total - count };
}

// 정답에 가까운 순서로 점수 (같은 오차는 같은 점수, 안 누른 사람은 0점)
export function scoreRound(counts, truth) {
  const rows = Object.entries(counts).filter(([, n]) => n > 0).map(([id, n]) => ({ id, err: Math.abs(n - truth) }));
  const deltas = {};
  for (const r of rows) {
    const p = (POINTS[rows.filter(o => o.err < r.err).length] || 0) + (r.err === 0 ? EXACT_BONUS : 0);
    if (p) deltas[r.id] = p;
  }
  return deltas;
}

function startRound(ctx, now) {
  const S = ctx.state;
  S.round += 1;
  const crowd = S.round === 2;
  if (crowd) S.target = pick(TARGETS.filter(t => t.id !== S.target.id)); // 2라운드는 다른 동물로
  const startAt = now + (crowd ? CROWD_READY : COUNT_TIME);
  ctx.secret.taps = {};
  Object.assign(S, {
    phase: 'count',
    mode: crowd ? 'crowd' : 'rush',
    show: crowd ? makeCrowd(S.target.id) : makeRush(S.target.id),
    startAt,
    showEnd: startAt + (crowd ? CROWD_TIME : RUSH_TIME),
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
  const deltas = scoreRound(counts, truth);
  S.scores = { ...(S.scores || {}) };
  S.exacts = { ...(S.exacts || {}) };
  S.overs = { ...(S.overs || {}) };
  for (const [id, d] of Object.entries(deltas)) S.scores[id] = (S.scores[id] || 0) + d;
  for (const [id, n] of Object.entries(counts)) {
    if (n === truth) S.exacts[id] = (S.exacts[id] || 0) + 1;
    if (n > truth) S.overs[id] = (S.overs[id] || 0) + n - truth;
  }
  S.show = { count: truth, decoys: S.show.decoys }; // 동물 명단은 이제 필요 없다 (상태 전송을 가볍게)
  Object.assign(S, { counts, deltas, phase: 'result', phaseEndsAt: now + RESULT_TIME });
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const top = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  const [eye, n] = top(S.exacts);
  if (n >= 1) add(eye, `🦅 매의 눈 (정답 ${n}번)`);
  const [hasty, m] = top(S.overs);
  if (m >= 5) add(hasty, `🔨 손이 먼저 (${m}번 더 누름)`);
  Object.assign(S, { phase: 'final', over: true, titles });
  return true;
}

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
// 삼각파 -1 ~ 1: 부드러운 물결이 아니라 뾰족하게 꺾이는 지그재그
const tri = u => 1 - 4 * Math.abs((((u % 1) + 1) % 1) - 0.5);

export default {
  id: 'count',
  title: '세어라',
  emoji: '🐾',
  tag: '타이밍',
  color: '#fab005',
  desc: '정해진 동물만 스페이스로 세기! 지나가는 동물은 갈수록 기하급수로 몰려오고, 2라운드는 화면에 쫙 깔린 동물 속에서 찾아요',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx, prev) {
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + INTRO_TIME,
      again: !!prev,
      round: 0,
      totalRounds: ROUNDS,
      target: pick(TARGETS.filter(t => t.id !== prev?.state?.target?.id)), // 이번에 셀 동물 (한 판 더면 다른 동물로)
      scores: Object.fromEntries(ctx.roster.map(p => [p.id, 0])),
    };
  },

  // 누른 횟수는 secret에만 쌓는다: false를 돌려주니 상태 전송이 없다
  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    if ((type !== 'tap' && type !== 'untap') || !['count', 'show'].includes(S.phase) || data.round !== S.round) return false;
    if (!S.roster.some(p => p.id === pid)) return false;
    const rel = ctx.now() - S.startAt;
    if (rel < -150) return false; // 시작 전
    let t = Math.round(Number(data.t));
    if (!Number.isFinite(t)) t = Math.round(rel);
    t = Math.min(rel + 100, Math.max(0, t, rel - MAX_LAG));
    if (t > S.showEnd - S.startAt + LATE) return false; // 끝난 뒤
    const taps = (ctx.secret.taps ||= {});
    const n = taps[pid] || 0;
    taps[pid] = type === 'tap' ? Math.min(MAX_TAPS, n + 1) : Math.max(0, n - 1);
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
    if (S.phase === 'show') return now >= S.showEnd + (S.mode === 'crowd' ? REVEAL : GRACE) && finishRound(ctx, now);
    if (S.phase === 'result' && now >= S.phaseEndsAt) return S.round >= S.totalRounds ? finish(ctx) : startRound(ctx, now);
    return false;
  },

  // 봇: 1라운드는 처음엔 거의 다 누르다가 뒤로 갈수록 놓치고 다른 동물에 잘못 누른다. 2라운드는 몇 마리 차이로 세어서 차근차근 누른다
  bot(ctx, id, mem) {
    const S = ctx.state;
    if ((S.phase !== 'count' && S.phase !== 'show') || !S.show?.list) return null;
    if (mem.round !== S.round) {
      mem.round = S.round;
      mem.taps = [];
      if (S.mode === 'crowd') {
        const n = Math.max(1, S.show.count + Math.round(gauss() * 4)); // 5초뿐이라 어림으로
        const from = 700 + Math.random() * 600;
        const step = (CROWD_TIME - 300 - from) / n;
        for (let i = 0; i < n; i++) mem.taps.push(S.startAt + from + i * step);
      } else {
        for (const c of S.show.list) {
          const f = c.at / RUSH_TIME;
          if (Math.random() < (c.k === S.target.id ? 0.98 - 0.7 * f ** 3 : 0.01 + 0.25 * f ** 3)) mem.taps.push(S.startAt + c.at + c.dur * (0.2 + Math.random() * 0.5));
        }
        mem.taps.sort((a, b) => a - b);
      }
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
    const miniSlot = h('span', { class: 'cn-minislot' });
    const nameEl = h('span', { class: 'cn-barname' });
    const numEl = h('b', { class: 'cn-count display' }, '0');
    const timerEl = h('span', { class: 'cn-timer' });
    const hintEl = h('span', { class: 'cn-keyhint' }, h('kbd', {}, '스페이스'), ' +1 ', h('kbd', {}, 'Backspace'), ' -1');
    const bar = h('div', { class: 'cn-bar' }, miniSlot, nameEl, numEl, timerEl, hintEl);
    const board = h('div', { class: 'rx-board' });
    const stage = h('div', { class: 'cn-stage' }, bg, field, center);
    const main = h('div', { class: 'cn-main' }, stage, bar);
    const pad = h('div', { class: 'rx-pad cn-pad' }, main, board);
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
    let timerText = '';
    const isPlayer = () => S?.roster.some(p => p.id === me);
    const T = () => S?.target || TARGETS[0];
    const myTaps = () => (tapRound === S?.round ? taps : 0);

    function onKey(e) {
      if (isTyping(e) || !S || !isPlayer()) return;
      const add = e.code === 'Space';
      if (!add && e.code !== 'Backspace') return;
      if (S.phase !== 'count' && S.phase !== 'show') return;
      e.preventDefault();
      if (e.repeat) return;
      const now = api.now();
      if (now < S.startAt || now > S.showEnd + LATE) return;
      if (tapRound !== S.round) {
        tapRound = S.round;
        taps = 0;
      }
      if (add ? taps >= MAX_TAPS : taps <= 0) return;
      taps += add ? 1 : -1;
      api.send(add ? 'tap' : 'untap', { round: S.round, t: Math.round(now - S.startAt) });
      // 숫자는 네트워크를 안 기다리고 누른 그 순간 바로 바뀐다
      numEl.textContent = String(taps);
      numEl.animate?.([{ transform: 'scale(1.5)', color: add ? '#ff7a59' : '#7a8aa0' }, { transform: 'scale(1)' }], { duration: 140, easing: 'ease-out' });
    }
    window.addEventListener('keydown', onKey);

    function buildField() {
      const key = `${S.round}:${S.startAt}`;
      if (key === fieldKey) return;
      fieldKey = key;
      const crowd = S.mode === 'crowd';
      field.classList.toggle('cn-still', crowd);
      field.classList.remove('cn-reveal');
      bg.innerHTML = crowd ? GRASS : MEADOW;
      critters = (S.show?.list || []).map(c => {
        const el = art(c.k, `cn-critter${crowd && c.k === S.target.id ? ' tg' : ''}${!crowd && c.dir < 0 ? ' flip' : ''}`);
        el.style.display = 'none';
        el.style.zIndex = Math.round(c.y); // 아래쪽(가까운) 동물이 위로
        if (!crowd) {
          el.style.top = `${c.y}%`;
          el.style.setProperty('--step', `${Math.max(70, Math.round(c.dur / 10))}ms`);
        }
        return { c, el, flip: false };
      });
      field.replaceChildren(...critters.map(x => x.el));
    }

    function renderCenter(key) {
      const name = T().name;
      if (key === 'intro') {
        center.replaceChildren(h('div', { class: 'cn-card' },
          art(T().id, 'cn-hero'),
          h('h2', { class: 'display' }, `1라운드: ${josa(name, '을', '를')} 세요!`),
          h('p', {}, S.again ? '🔁 한 판 더!' : '지나갈 때마다 스페이스 · 갈수록 미친 듯이 몰려와요')));
      } else if (key[0] === 'n') {
        center.replaceChildren(h('div', { class: 'cn-card small' },
          h('div', { class: 'cn-num display' }, key.slice(1)),
          art(T().id, S.mode === 'crowd' ? 'cn-hero' : 'cn-mini'),
          h('p', {}, S.mode === 'crowd' ? `2라운드: 화면에 쫙 깔린 동물 중 ${name}만 세요!` : `${name}만 세요 · 다른 동물은 빼고`)));
      } else if (key === 'end') {
        center.replaceChildren(h('div', { class: 'cn-card small' }, h('p', { class: 'cn-done display' }, '다 지나갔다!')));
      } else center.replaceChildren();
    }

    function renderBar() {
      if (!S) return;
      const key = `${isPlayer() ? 'p' : 's'}:${T().id}`;
      if (key !== barKey) {
        barKey = key;
        miniSlot.replaceChildren(art(T().id, 'cn-mini'));
        nameEl.textContent = `${T().name} ×`;
        numEl.style.display = isPlayer() ? '' : 'none';
        hintEl.style.display = isPlayer() ? '' : 'none';
        if (!isPlayer()) nameEl.textContent = `👀 관전 중 · ${T().name} 세는 판`;
      }
      numEl.textContent = String(myTaps());
    }

    function paint() {
      if (!S) return;
      const now = api.now();
      const live = S.phase === 'count' || S.phase === 'show';
      const crowd = S.mode === 'crowd';
      const rel = now - S.startAt;
      main.classList.toggle('full', crowd && live); // 2라운드는 화면 전체로
      // 동물 위치는 서버 시각의 함수라 모두 같은 장면
      for (const it of critters) {
        const { c, el } = it;
        const on = live && (crowd ? rel >= 0 : rel >= c.at && rel <= c.at + c.dur);
        if (!on) {
          if (el.style.display !== 'none') el.style.display = 'none';
          continue;
        }
        if (el.style.display === 'none') el.style.display = '';
        if (crowd) {
          const u = 2 * Math.PI * (rel / c.px + c.p1);
          const x = c.x + c.ax * Math.sin(u);
          const y = c.y + c.ay * Math.sin(2 * Math.PI * (rel / c.py + c.p2)) - Math.abs(Math.sin(rel / 190 + c.p1 * 7)) * 0.5;
          el.style.transform = `translate(calc(${x.toFixed(2)}cqw - 50%), calc(${y.toFixed(2)}cqh - 50%))`;
          const back = Math.cos(u) < 0; // 가는 쪽을 보게
          if (back !== it.flip) {
            it.flip = back;
            el.classList.toggle('flip', back);
          }
        } else {
          const f = (rel - c.at) / c.dur;
          const x = c.dir > 0 ? -9 + f * 118 : 109 - f * 118;
          const dy = c.zig ? c.zig * tri(f * c.zc + c.zp) : 0; // 후반 지그재그
          el.style.transform = `translate(calc(${x.toFixed(2)}cqw - 50%), calc(${dy.toFixed(2)}cqh - 50%))`;
        }
      }
      // 2라운드 끝: 정답 동물만 밝게
      field.classList.toggle('cn-reveal', crowd && S.phase === 'show' && now >= S.showEnd);
      const timer = crowd && S.phase === 'show' ? (now < S.showEnd ? `⏱ ${Math.ceil((S.showEnd - now) / 1000)}초` : '⏱ 끝!') : '';
      if (timer !== timerText) {
        timerText = timer;
        timerEl.textContent = timer;
      }
      let key = 'off';
      if (S.phase === 'intro') key = 'intro';
      else if (live && now < S.startAt) key = `n${Math.max(1, Math.ceil((S.startAt - now) / 1000))}`;
      else if (live && !crowd && now >= S.showEnd) key = 'end';
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
        S.show.decoys ? h('p', { class: 'muted' }, `다른 동물은 ${S.show.decoys}마리 있었어요`) : null,
        h('ol', { class: 'rank-list' }, rows.map(p => {
          const n = counts[p.id] || 0;
          const d = deltas[p.id] || 0;
          return h('li', { class: !d ? 'bad' : '' },
            nameTag(p, me),
            h('span', { class: 'val' }, `${n}마리${n === truth ? ' 🎯' : ` (${n > truth ? '+' : ''}${n - truth})`}`),
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
            h('li', {}, `지금은 ${T().name}만 세요`),
            h('li', {}, '스페이스 = 한 마리, 백스페이스 = 하나 취소'),
            h('li', {}, '1라운드: 지나가는 동물, 갈수록 몰려오고 후반엔 지그재그'),
            h('li', {}, `2라운드: 화면에 쫙 깔린 동물 속에서 ${CROWD_TIME / 1000}초 안에 찾기`),
            h('li', {}, '정답에 가까운 순 +5·+3·+2·+1, 정확히 맞히면 +2 더')));
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
