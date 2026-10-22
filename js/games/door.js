// 마지막 문: 불길에 쫓기며 방마다 문을 골라 빠져나가는 개인전 눈치 레이스.
// 문마다 지나갈 수 있는 인원(정원)과 전진 칸이 다르다 — 🏃 지름길 1명 +3칸, 🚪 보통 문 2명 +2칸, 🐢 먼 길 무제한 +1칸.
// 정원을 넘기면 그 문에 간 사람 전부 갇힘(이번 방 0칸). 갇혀도 탈락은 아니고, 뒤에서 오는 🔥 불길에 따라잡히면 탈락.
// 방마다 6초: 처음 4.5초는 모두의 위치가 보이고(가는 척), 마지막 1.5초는 🌑 정전 — 남은 안 보이고 나는 계속 움직일 수 있다.
// 걷는 속도가 정해져 있어서 정전 직전 자리에서 닿는 문으로만 바꿀 수 있다. 정전 동안 진짜 위치는 방장만 안다(ctx.secret).
// 출구(12칸)에 먼저 닿은 사람 승리. 갇혀서 불길에 잡히면 그 문에 마지막으로 끼어든 사람의 킬.
import { h, isTyping, shuffle, digitOf } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';

const INTRO = 4500;
const VISIBLE = 4500;   // 다 보이는 시간
const DARK = 1500;      // 🌑 정전
const GRACE = 300;      // 닫히기 직전에 움직인 신호가 늦게 와도 이만큼 기다린다 (그 사람 화면 시계로 닫히기 전이면 인정)
const REVEAL = 2800;    // 공개: 문으로 달려가고 쾅 → 트랙 전진 → 불길
const SPEED = 0.5;      // 방 폭(0~1)을 초당 이만큼 = 끝에서 끝까지 2초
const SEND_EVERY = 150; // 걷는 중 위치 알리는 간격
export const EXIT = 12;
export const FIRE_START = -3;
// 불길: 방마다 1칸씩 다가오고 0.25칸씩 빨라진다 → 먼 길만 가면 6번째 방쯤 잡힌다
export const fireStep = room => 1 + 0.25 * (room - 1);

export const DOORS = {
  short: { name: '지름길', icon: '🏃', cap: 1, go: 3 },
  side: { name: '옆길', icon: '🚪', cap: 1, go: 2 },
  mid: { name: '보통 문', icon: '🚪', cap: 2, go: 2 },
  wide: { name: '넓은 문', icon: '🚪', cap: 3, go: 2 },
  slow: { name: '먼 길', icon: '🐢', cap: 0, go: 1 }, // cap 0 = 무제한
};
// 살아 있는 인원에 맞춰: 정원이 인원보다 작아야 눈치 싸움이 된다
export const doorsFor = n => (n <= 2 ? ['short', 'side', 'slow'] : n <= 5 ? ['short', 'mid', 'slow'] : ['short', 'mid', 'wide', 'slow']);
// 방 폭을 문 수만큼 나눈 칸: 서 있는 칸의 문이 내 선택
export const doorAt = (x, k) => Math.max(0, Math.min(k - 1, Math.floor(x * k)));
const center = (i, k) => (i + 0.5) / k;
const clamp01 = x => Math.max(0, Math.min(1, x));
const r3 = v => Math.round(v * 1000) / 1000;
// 그 시각의 위치: 마지막으로 알려 준 자리에서 방향대로 걸어간 만큼
export const posAt = (p, t) => (p ? clamp01(p.x + ((p.dir || 0) * SPEED * Math.max(0, t - p.t)) / 1000) : 0.5);
const capText = cap => (cap ? `${cap}명` : '무제한');

/* ───────── 진행 (방장) ───────── */

function startRoom(ctx, now) {
  const S = ctx.state;
  S.roomNo = (S.roomNo || 0) + 1;
  const doors = shuffle(doorsFor(S.alive.length));
  S.room = { no: S.roomNo, doors, startAt: now, darkAt: now + VISIBLE, closeAt: now + VISIBLE + DARK };
  S.phase = 'choose';
  S.result = null;
  // 지난 방에서 나온 자리 그대로 다음 방 시작
  const pos = {};
  for (const id of S.alive) {
    const x = posAt(S.pos?.[id], now);
    const z = doorAt(x, doors.length);
    pos[id] = { x: r3(x), dir: 0, t: now, z, za: now };
  }
  S.pos = pos;
  ctx.secret.pos = null;
  return true;
}

// 정전: 지금까지 위치를 비밀 쪽으로 옮기고, 모두에게는 정전 직전 자리만 (멈춘 채로) 보여 준다
function goDark(ctx) {
  const S = ctx.state;
  const at = S.room.darkAt;
  ctx.secret.pos = JSON.parse(JSON.stringify(S.pos));
  S.pos = Object.fromEntries(Object.entries(S.pos).map(([id, p]) => [id, { ...p, x: r3(posAt(p, at)), dir: 0, t: at }]));
  S.room.dark = true;
  return true;
}

function move(ctx, pid, data, now) {
  const S = ctx.state;
  if (!S.alive.includes(pid) || !S.room || !['choose', 'closing'].includes(S.phase)) return false;
  let t = Number(data.t);
  if (!Number.isFinite(t) || t > now + 200 || t < now - 1000) t = now;
  if (t >= S.room.closeAt) return false; // 문 닫힌 뒤에 움직인 건 무효
  const store = S.room.dark ? ctx.secret.pos : S.pos;
  const prev = store?.[pid];
  if (!prev) return false;
  t = Math.max(t, prev.t);
  // 걷는 속도로 그사이 갈 수 있는 만큼만 (순간이동 방지)
  const reach = (SPEED * (t - prev.t)) / 1000 + 0.05;
  const x = Math.max(prev.x - reach, Math.min(prev.x + reach, clamp01(Number(data.x) || 0)));
  const z = doorAt(x, S.room.doors.length);
  store[pid] = { x: r3(x), dir: Math.sign(Number(data.dir) || 0), t, z, za: z === prev.z ? prev.za : t };
  return !S.room.dark; // 정전 중엔 모두에게 보낼 게 없다
}

function resolve(ctx, now) {
  const S = ctx.state;
  const src = ctx.secret.pos || S.pos;
  const kinds = S.room.doors;
  const k = kinds.length;
  const at = S.room.closeAt;
  const alive = [...S.alive];
  const final = {};
  for (const id of alive) {
    const p = src[id];
    const x = posAt(p, at);
    const z = doorAt(x, k);
    final[id] = { x: r3(x), z, za: z === p?.z ? p.za : at };
  }
  const doors = kinds.map((kind, i) => {
    const ids = alive.filter(id => final[id].z === i);
    const cap = DOORS[kind].cap;
    const over = cap > 0 && ids.length > cap;
    // 정원을 넘긴 범인 = 그 문에 마지막으로 들어선 사람
    const last = over ? [...ids].sort((a, b) => final[b].za - final[a].za)[0] : null;
    return { kind, ids, over, last };
  });
  const moves = {};
  const stats = S.stats || {};
  const bump = (id, key) => { stats[id] = { ...(stats[id] || {}), [key]: (stats[id]?.[key] || 0) + 1 }; };
  doors.forEach((d, i) => {
    for (const id of d.ids) {
      const go = d.over ? 0 : DOORS[d.kind].go;
      S.prog[id] = (S.prog[id] || 0) + go;
      moves[id] = { door: i, go };
      if (d.over) bump(id, 'stuck');
      else if (d.kind === 'short' && d.ids.length === 1) bump(id, 'solo');
      else if (d.kind === 'slow') bump(id, 'slow');
    }
  });
  const fireFrom = S.fire;
  S.fire = r3(S.fire + fireStep(S.roomNo));
  // 불길에 잡힌 사람 (출구에 닿았으면 이미 탈출)
  const caught = alive.filter(id => S.prog[id] < EXIT && S.prog[id] <= S.fire);
  for (const id of caught) {
    S.alive = S.alive.filter(x => x !== id);
    S.out = [...(S.out || []), id];
    S.caughtAt = { ...(S.caughtAt || {}), [id]: S.roomNo };
    const d = doors[moves[id].door];
    const killer = d.over && d.last !== id ? d.last : null;
    S.dead = { ...(S.dead || {}), [id]: killer || '-' };
    if (killer) {
      ctx.kill(killer, id, '🚪 막판 끼어들기');
      bump(killer, 'kills');
    } else {
      ctx.announce(`🔥 ${ctx.nameOf(id)} 불길에 잡혔다!`);
    }
  }
  S.stats = stats;
  const escaped = S.alive.filter(id => S.prog[id] >= EXIT);
  S.escaped = escaped;
  for (const id of escaped) ctx.announce(`🏃 ${ctx.nameOf(id)} 탈출!`);
  S.pos = Object.fromEntries(alive.map(id => [id, { x: final[id].x, dir: 0, t: now, z: final[id].z, za: now }]));
  ctx.secret.pos = null;
  S.result = { doors, moves, caught, fireFrom, fireTo: S.fire, at: now };
  S.ending = escaped.length > 0 || S.alive.length <= 1;
  S.phase = 'reveal';
  S.phaseEndsAt = now + REVEAL;
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  // 탈출 > 살아 있는 사람(칸 순) > 불길에 잡힌 사람(늦게 잡힌 순, 같으면 칸 순)
  const score = id => (S.escaped?.includes(id) ? 100000 : S.alive.includes(id) ? 10000 : (S.caughtAt?.[id] || 0) * 100) + (S.prog[id] || 0) * 10;
  const standings = Object.fromEntries(S.roster.map(p => [p.id, score(p.id)]));
  const placement = [...S.roster.map(p => p.id)].sort((a, b) => standings[b] - standings[a]);
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const top = standings[placement[0]];
  for (const id of placement.filter(x => standings[x] === top)) add(id, S.escaped?.length ? '🏃 탈출왕' : '🏁 최후의 생존자');
  const best = key => Object.entries(S.stats || {}).map(([id, s]) => [id, s[key] || 0]).sort((a, b) => b[1] - a[1])[0] || [];
  const [spy, solo] = best('solo');
  if (solo >= 2) add(spy, `🕵️ 눈치 9단 (지름길 ${solo}번)`);
  const [blocker, kills] = best('kills');
  if (kills >= 1) add(blocker, `🚪 문막이 (${kills}킬)`);
  const [turtle, slow] = best('slow');
  if (slow >= 3) add(turtle, `🐢 거북이 (먼 길 ${slow}번)`);
  if (S.out?.[0]) add(S.out[0], '🔥 바베큐');
  Object.assign(S, { standings, placement, titles, phase: 'final', over: true });
  return true;
}

/* ───────── 봇 ───────── */

// 문마다 끌리는 정도: 불길이 가까우면 지름길, 1등이면 먼 길 위주. 이 문으로 가면 불길에 잡히는 문은 거의 안 감
function botWeights(S, id) {
  const prog = S.prog[id] || 0;
  const next = S.fire + fireStep(S.roomNo);
  const lead = prog - Math.max(...S.alive.map(a => S.prog[a] || 0));
  return S.room.doors.map(kind => {
    const d = DOORS[kind];
    if (prog + d.go <= next) return 0.05;
    if (kind === 'slow') return prog + 1 - next <= 1 ? 0.3 : lead >= 0 ? 1.5 : 1;
    if (kind === 'short') return prog - next <= 2 ? 1.2 : lead >= 0 ? 0.5 : 0.7;
    return 1;
  });
}

function weighted(w) {
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return i;
  return w.length - 1;
}

/* ───────── 화면 ───────── */

export default {
  id: 'door',
  title: '마지막 문',
  emoji: '🚪',
  tag: '심리',
  color: '#c2410c',
  desc: '불길에 쫓기며 방마다 문을 골라요. 지름길은 1명만! 몰린 문은 아무도 못 지나가요. 마지막 1.5초는 정전 — 가는 척하다 바꾸기',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx) {
    const now = ctx.now();
    const ids = ctx.roster.map(p => p.id);
    return {
      phase: 'intro',
      phaseEndsAt: now + INTRO,
      alive: ids,
      prog: Object.fromEntries(ids.map(id => [id, 0])),
      fire: FIRE_START,
      roomNo: 0,
      pos: Object.fromEntries(ids.map(id => [id, { x: 0.5, dir: 0, t: now }])),
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    if (type !== 'pos') return false;
    return move(ctx, pid, data, ctx.now());
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    switch (S.phase) {
      case 'intro':
        return now >= S.phaseEndsAt && startRoom(ctx, now);
      case 'choose':
        if (now >= S.room.closeAt) {
          if (!S.room.dark) goDark(ctx);
          S.phase = 'closing';
          return true;
        }
        // 걷는 중인 사람 위치는 화면이 방향대로 이어 그리니 따로 보낼 필요 없다
        return !S.room.dark && now >= S.room.darkAt && goDark(ctx);
      case 'closing':
        if (!S.room.dark) goDark(ctx);
        return now >= S.room.closeAt + GRACE && resolve(ctx, now);
      case 'reveal':
        if (now < S.phaseEndsAt) return false;
        return S.ending ? finish(ctx) : startRoom(ctx, now);
      default:
        return false;
    }
  },

  // 봇: 보이는 동안엔 한 문 앞에 서 있다가(가끔은 미끼), 정전 직전에 보인 줄을 보고 마지막으로 정한다.
  // 정원이 찬 문은 피하는데, 남의 미끼에 속기도 한다. 정전 동안 걸어서 닿는 문만 고른다. 정전 동안 남의 진짜 위치는 모른다.
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase !== 'choose' || !S.alive.includes(id) || now >= S.room.closeAt) return null;
    const k = S.room.doors.length;
    if (mem.room !== S.room.no) {
      const decoy = weighted(botWeights(S, id));
      Object.assign(mem, {
        room: S.room.no, decoy, real: null, honest: Math.random() < 0.67, x: posAt(S.pos[id], now), last: now,
        startAt: now + 300 + Math.random() * 1500, switchAt: S.room.darkAt + Math.random() * 300, sentAt: 0, dir: 0,
      });
    }
    const dt = Math.max(0, now - mem.last) / 1000;
    mem.last = now;
    if (now < mem.startAt) return null;
    if (now >= mem.switchAt && mem.real == null) {
      // 정전 직전에 보인 줄 (모두에게 보이는 멈춘 자리)
      const seen = Array(k).fill(0);
      for (const other of S.alive) if (other !== id) seen[doorAt(S.pos[other]?.x ?? 0.5, k)]++;
      const reach = (SPEED * (S.room.closeAt - now - 150)) / 1000;
      const w = botWeights(S, id).map((v, i) => {
        if (Math.abs(center(i, k) - mem.x) > reach) return 0;
        const cap = DOORS[S.room.doors[i]].cap;
        return v * (cap && seen[i] >= cap ? 0.3 : 1) * (mem.honest && i === mem.decoy ? 2 : 1);
      });
      mem.real = w.some(v => v > 0) ? weighted(w) : doorAt(mem.x, k);
    }
    const target = center(mem.real ?? mem.decoy, k);
    const want = Math.abs(target - mem.x) < 0.01 ? 0 : Math.sign(target - mem.x);
    if (mem.dir) mem.x = clamp01(mem.x + mem.dir * SPEED * dt);
    if (mem.dir && Math.sign(target - mem.x) !== mem.dir) mem.x = target; // 지나쳤으면 그 자리
    const dir = Math.abs(target - mem.x) < 0.01 ? 0 : want;
    if (dir !== mem.dir || (dir && now - mem.sentAt >= SEND_EVERY)) {
      mem.dir = dir;
      mem.sentAt = now;
      return { type: 'pos', data: { x: r3(mem.x), dir, t: now } };
    }
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const top = h('div', { class: 'dr-top' });
    const fireBar = h('div', { class: 'dr-fire' });
    const tokens = h('div', { class: 'dr-tokens' });
    const track = h('div', { class: 'dr-track' },
      h('div', { class: 'dr-rail' }, fireBar, ...Array.from({ length: EXIT - FIRE_START + 1 }, (_, i) => h('i', { class: 'dr-tick', style: `left:${(i / (EXIT - FIRE_START)) * 100}%` })),
        h('div', { class: 'dr-exit' }, '🚪 출구'), tokens));
    const doorsRow = h('div', { class: 'dr-doors' });
    const guides = h('div', { class: 'dr-guides' }); // 문 칸 경계 점선 (사람 줄과 같은 폭)
    const lanes = h('div', { class: 'dr-lanes' }, guides);
    const darkNote = h('div', { class: 'dr-dark-note' }, '🌑 정전! 남들은 안 보여요');
    const fxBox = h('div', { class: 'dr-fx' });
    const room = h('div', { class: 'dr-room' }, doorsRow, lanes, darkNote, fxBox);
    const panel = h('div', { class: 'dr-panel' });
    const box = h('div', { class: 'dr-box' }, top, track, room, panel);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'dr' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    let topKey = '';
    let roomKey = '';
    let panelKey = '';
    let sideKey = '';
    let tokKey = '';
    let seenResult = 0;
    const runners = new Map(); // id → { el, lane }
    const tokEls = new Map();
    // 내 위치는 내 화면에서 바로 움직이고, 방장에게는 방향이 바뀔 때·걷는 중 0.15초마다 알려 준다
    const mine = { x: 0.5, dir: 0, target: null, sentDir: 0, sentAt: 0, last: 0, room: 0 };
    const held = { l: false, r: false };
    const who = id => S?.roster.find(p => p.id === id) || { id, name: '?' };
    const alive = id => (S?.alive || []).includes(id);
    const canMove = () => S?.phase === 'choose' && alive(me) && api.now() < S.room.closeAt;
    const kOf = () => S?.room?.doors?.length || doorsFor(S?.roster?.length || 3).length;

    function send(force) {
      const now = performance.now();
      if (!force && mine.dir === mine.sentDir && (!mine.dir || now - mine.sentAt < SEND_EVERY)) return;
      mine.sentDir = mine.dir;
      mine.sentAt = now;
      api.send('pos', { x: r3(mine.x), dir: mine.dir, t: api.now() });
    }

    function onKey(e) {
      if (isTyping(e) || !S) return;
      const down = e.type === 'keydown';
      const c = e.code;
      const side2 = c === 'ArrowLeft' || c === 'KeyA' ? 'l' : c === 'ArrowRight' || c === 'KeyD' ? 'r' : null;
      if (side2) {
        e.preventDefault();
        held[side2] = down;
        if (down) mine.target = null;
        return;
      }
      // 숫자키 = 그 문으로 걸어가기 (순간이동 아님)
      const d = down && !e.repeat ? digitOf(e) : 0;
      if (d && d <= kOf() && canMove()) {
        e.preventDefault();
        mine.target = center(d - 1, kOf());
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    // 걷기는 화면 그리기와 따로 (브라우저가 그리기를 멈춰도 정확하게)
    const walker = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - (mine.last || now)) / 1000);
      mine.last = now;
      if (!canMove()) {
        if (mine.dir) {
          mine.dir = 0;
          held.l = held.r = false;
        }
        return;
      }
      let dir = (held.r ? 1 : 0) - (held.l ? 1 : 0);
      if (!dir && mine.target != null) {
        dir = Math.abs(mine.target - mine.x) < 0.01 ? 0 : Math.sign(mine.target - mine.x);
        if (!dir) mine.target = null;
      }
      const before = mine.x;
      mine.x = clamp01(mine.x + dir * SPEED * dt);
      if (mine.target != null && Math.sign(mine.target - mine.x) !== Math.sign(mine.target - before)) {
        mine.x = mine.target;
        mine.target = null;
        dir = 0;
      }
      if ((mine.x === 0 && dir < 0) || (mine.x === 1 && dir > 0)) dir = 0;
      mine.dir = dir;
      send(false);
    }, 30);

    function buildRoom() {
      const key = `${S.room?.no}:${(S.room?.doors || []).join()}:${S.roster.length}`;
      if (key === roomKey) return;
      roomKey = key;
      const kinds = S.room?.doors || doorsFor(S.roster.length);
      doorsRow.replaceChildren(...kinds.map((kind, i) => {
        const d = DOORS[kind];
        return h('div', { class: `dr-door dr-${kind}` },
          h('kbd', {}, String(i + 1)),
          h('div', { class: 'dr-door-icon' }, d.icon),
          h('b', {}, d.name),
          h('span', { class: 'dr-cap' }, `정원 ${capText(d.cap)}`),
          h('span', { class: 'dr-go' }, `+${d.go}칸`),
          h('div', { class: 'dr-door-result' }));
      }));
      guides.replaceChildren(...kinds.slice(1).map((_, i) => h('i', { style: `left:${((i + 1) / kinds.length) * 100}%` })));
      if (!runners.size) {
        S.roster.forEach((p, lane) => {
          const el = h('div', { class: `dr-runner${p.id === me ? ' me' : ''}`, style: `top:${lane * 34 + 8}px` }, avatar(p), h('span', {}, p.id === me ? '나' : p.name));
          lanes.append(el);
          runners.set(p.id, { el, lane });
        });
        lanes.style.height = `${S.roster.length * 34 + 16}px`;
      }
    }

    function paint() {
      raf = requestAnimationFrame(paint);
      if (!S) return;
      const t = api.now();
      const k = kOf();
      const dark = S.phase === 'closing' || (S.phase === 'choose' && t >= S.room.darkAt);
      room.classList.toggle('dark', dark);
      for (const [id, r] of runners) {
        const show = alive(id) || (S.phase === 'reveal' && S.result?.caught?.includes(id));
        r.el.hidden = !show;
        if (!show) continue;
        const x = id === me && canMove() ? mine.x : S.phase === 'reveal' ? S.pos[id]?.x ?? 0.5 : posAt(S.pos[id], t);
        r.el.style.left = `${x * 100}%`;
        r.el.classList.toggle('hidden-dark', dark && id !== me);
      }
      // 내가 서 있는 문
      const myZ = doorAt(canMove() ? mine.x : posAt(S.pos[me], t), k);
      [...doorsRow.children].forEach((el, i) => el.classList.toggle('mine', alive(me) && S.phase !== 'reveal' && i === myZ));
      // 불길이 가까울수록 방 아래가 뜨겁게
      const next = S.fire + fireStep((S.roomNo || 0) + (S.phase === 'reveal' ? 1 : 0));
      const gap = (S.prog?.[me] || 0) - next;
      room.style.setProperty('--heat', alive(me) ? String(Math.max(0, Math.min(1, 1 - (gap - 1) / 4))) : '0');
    }
    let raf = requestAnimationFrame(paint);

    function flash(text, cls = '') {
      const el = h('div', { class: `dr-flash ${cls}` }, text);
      fxBox.append(el);
      setTimeout(() => el.remove(), 2000);
    }

    // 공개: 문마다 몇 명 왔는지, 넘친 문은 쾅
    function playResult() {
      const r = S.result;
      if (!r || r.at === seenResult) return;
      const first = seenResult === 0 && api.now() - r.at > 1500;
      seenResult = r.at;
      (r.doors || []).forEach((d, i) => {
        const el = doorsRow.children[i]?.querySelector('.dr-door-result');
        if (!el) return;
        const n = (d.ids || []).length;
        const cap = DOORS[d.kind].cap;
        el.textContent = d.over ? `💥 ${n}/${cap} 쾅!` : n ? `✅ ${n}${cap ? `/${cap}` : '명'}` : '';
        doorsRow.children[i].classList.toggle('over', !!d.over);
        doorsRow.children[i].classList.toggle('used', !!n && !d.over);
      });
      for (const [id, m] of Object.entries(r.moves || {})) {
        const el = runners.get(id)?.el;
        if (!el) continue;
        el.classList.remove('go', 'stuck');
        void el.offsetWidth;
        el.classList.add(m.go ? 'go' : 'stuck');
      }
      if (first) return;
      const mineMove = r.moves?.[me];
      const overs = (r.doors || []).filter(d => d.over);
      if (overs.length) flash(`💥 쾅! ${overs.map(d => `${DOORS[d.kind].name}에 ${(d.ids || []).length}명`).join(' · ')}`, 'bad');
      if (mineMove && !(r.caught || []).includes(me)) flash(mineMove.go ? `+${mineMove.go}칸!` : '😵 갇혔다!', mineMove.go ? '' : 'bad');
      for (const id of r.caught || []) setTimeout(() => flash(`🔥 ${who(id).name} 잡혔다!`, 'bad'), 900);
      for (const id of S.escaped || []) setTimeout(() => flash(`🏃 ${who(id).name} 탈출!`), 900);
    }

    function renderTrack() {
      const key = JSON.stringify([S.prog, S.fire, S.alive, S.escaped]);
      if (key === tokKey) return;
      tokKey = key;
      const span = EXIT - FIRE_START;
      fireBar.style.width = `${Math.max(0, Math.min(1, (S.fire - FIRE_START) / span)) * 100}%`;
      // 같은 칸에 여럿이면 위아래로 쌓기
      const stack = {};
      for (const p of S.roster) {
        let el = tokEls.get(p.id);
        if (!el) {
          el = h('div', { class: `dr-tok${p.id === me ? ' me' : ''}` }, avatar(p));
          tokens.append(el);
          tokEls.set(p.id, el);
        }
        const v = Math.min(EXIT, S.prog?.[p.id] || 0);
        const n = (stack[v] = (stack[v] || 0) + 1) - 1;
        el.style.left = `${((v - FIRE_START) / span) * 100}%`;
        el.style.top = `${-n * 8}px`; // 같은 칸이면 위로 쌓기
        el.style.zIndex = String(10 - n);
        el.classList.toggle('dead', !alive(p.id) && !(S.escaped || []).includes(p.id));
        el.classList.toggle('out', (S.escaped || []).includes(p.id));
      }
    }

    function renderTop() {
      const timer = S.phase === 'choose' && api.now() < S.room.darkAt ? [S.room.darkAt, VISIBLE, '👀 정전까지']
        : S.phase === 'choose' ? [S.room.closeAt, DARK, '🌑 정전!'] : null;
      const key = JSON.stringify([S.phase, S.roomNo, timer, S.fire, S.prog?.[me], alive(me)]);
      if (key === topKey) return;
      topKey = key;
      const gap = Math.round(((S.prog?.[me] || 0) - S.fire) * 100) / 100;
      top.replaceChildren(...[
        h('span', {}, S.roomNo ? `${S.roomNo}번째 방` : '곧 시작'),
        h('span', {}, alive(me) ? `내 위치 ${S.prog?.[me] || 0}/${EXIT}칸 · 🔥 ${gap}칸 뒤` : `🔥 불길 ${Math.round(S.fire * 100) / 100}칸`),
        timer ? h('span', { class: timer[2].startsWith('🌑') ? 'dr-hot' : '' }, timer[2]) : null,
        timer ? countdown(timer[0], timer[1]) : null,
      ].filter(Boolean));
    }

    function panelView() {
      if (S.phase === 'intro') {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '🚪 마지막 문'),
          h('ul', { class: 'rules big' },
            h('li', {}, '방마다 문 하나를 골라 지나가요. 🏃 지름길(1명 +3칸) · 🚪 보통 문(2명 +2칸) · 🐢 먼 길(무제한 +1칸)'),
            h('li', {}, '정원을 넘긴 문은 💥 쾅! 그 문에 간 사람 전부 갇혀요 (그 방은 0칸)'),
            h('li', {}, '뒤에서 🔥 불길이 점점 빨라지며 쫓아와요. 따라잡히면 탈락, 출구(12칸)에 먼저 닿으면 승리'),
            h('li', {}, '← → 꾹 = 걷기 · 숫자키 = 그 문으로 걷기. 서 있는 문이 내 선택'),
            h('li', {}, '마지막 1.5초는 🌑 정전: 남들은 안 보이고 나는 아직 움직일 수 있어요 — 가는 척하다 바꾸기!')),
          countdown(S.phaseEndsAt, INTRO));
      }
      if (S.phase === 'final') {
        const win = S.placement?.[0];
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, S.escaped?.length ? `🏃 ${S.escaped.map(id => who(id).name).join(' · ')} 탈출!` : `🏁 ${who(win).name} 최후의 생존자!`),
          podium(S.roster, S.standings, me));
      }
      if (!alive(me) && !(S.escaped || []).includes(me)) {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '🔥 불길에 잡혔어요'),
          h('p', { class: 'muted' }, S.dead?.[me] && S.dead[me] !== '-' ? `${who(S.dead[me]).name}이(가) 막판에 끼어들어서… 🚪` : '구경하면서 누가 갇히나 보세요'));
      }
      if (S.phase === 'choose' || S.phase === 'closing') {
        const prog = S.prog?.[me] || 0;
        const next = S.fire + fireStep(S.roomNo);
        const danger = S.room.doors.filter(kind => prog + DOORS[kind].go <= next).map(kind => DOORS[kind].name);
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title hot' }, S.phase === 'closing' ? '🚪 문 닫힘!' : '어느 문으로?'),
          h('p', {}, '← → 꾹 = 걷기 · 숫자키 = 그 문으로 · 서 있는 문이 내 선택'),
          h('p', { class: danger.length ? 'dr-warn' : 'muted' },
            danger.length ? `🔥 ${danger.join('·')}(으)로 가거나 갇히면 불길에 잡혀요!` : prog - next <= 1 ? '🔥 갇히면 불길에 잡혀요!' : `불길까지 ${Math.floor(prog - S.fire)}칸 여유`));
      }
      if (S.phase === 'reveal') {
        const m = S.result?.moves?.[me];
        const d = m ? S.result.doors[m.door] : null;
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, !m ? '공개!' : m.go ? `✅ ${DOORS[d.kind].name} 통과 +${m.go}칸` : `💥 ${DOORS[d.kind].name}에 ${(d.ids || []).length}명 — 갇혔다!`),
          h('p', { class: 'muted' }, (S.escaped || []).includes(me) ? '🏃 탈출!' : S.ending ? '끝!' : '다음 방으로…'));
      }
      return h('div');
    }

    function renderPanel() {
      const key = [S.phase, S.roomNo, alive(me), S.result?.at, (S.escaped || []).join()].join('|');
      if (key === panelKey) return;
      panelKey = key;
      panel.replaceChildren(panelView());
    }

    function renderSide() {
      const key = JSON.stringify([S.prog, S.alive, S.dead, S.escaped]);
      if (key === sideKey) return;
      sideKey = key;
      const order = [...S.roster].sort((a, b) => (alive(b.id) ? 1 : 0) - (alive(a.id) ? 1 : 0) || (S.prog?.[b.id] || 0) - (S.prog?.[a.id] || 0));
      side.replaceChildren(
        h('h3', {}, `생존 ${S.alive.length}명 · 출구까지`),
        h('ol', { class: 'tw-bag dr-rank' }, order.map(p => h('li', { class: alive(p.id) ? (p.id === me ? 'now' : '') : 'dead' },
          avatar(p), h('span', {}, p.name),
          h('em', {}, alive(p.id) || (S.escaped || []).includes(p.id) ? `${S.prog?.[p.id] || 0}/${EXIT}칸` : S.dead?.[p.id] && S.dead[p.id] !== '-' ? `🚪 ${who(S.dead[p.id]).name}` : '🔥')))),
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '← → (A D) 꾹 = 걷기 (끝에서 끝까지 2초)'),
          h('li', {}, '숫자키 = 그 문 앞으로 걷기'),
          h('li', {}, '서 있는 문이 내 선택 · 마지막 1.5초는 🌑 정전')),
        h('h3', {}, '문'),
        h('ul', { class: 'rules' },
          h('li', {}, '🏃 지름길 1명 +3칸 · 🚪 보통 문 2명 +2칸 · 🐢 먼 길 무제한 +1칸'),
          h('li', {}, '정원 넘치면 💥 전부 갇힘. 갇혀서 불길에 잡히면 마지막에 끼어든 사람 킬')));
    }

    return {
      update({ state }) {
        S = state;
        if (S.room && mine.room !== S.room.no) {
          mine.room = S.room.no;
          mine.x = posAt(S.pos?.[me], api.now());
          mine.target = null;
          mine.dir = 0;
          mine.sentDir = 0;
          for (const r of runners.values()) r.el.classList.remove('go', 'stuck');
          [...doorsRow.children].forEach(el => el.classList.remove('over', 'used'));
        }
        buildRoom();
        if (S.phase === 'reveal') playResult();
        renderTop();
        renderTrack();
        renderPanel();
        renderSide();
      },
      unmount() {
        cancelAnimationFrame(raf);
        clearInterval(walker);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
      },
    };
  },
};
