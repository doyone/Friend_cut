// 카트 그랑프리: 3경기를 서로 다른 맵(도심 골목·설산 지그재그·해변 동굴·공사장 미로, 좌우 반전도)으로, 합산 점수.
// 맵마다 보이는 갈래길과 미니맵에 없는 숨은 지름길(좁고 위험, 실패하면 손해)이 있다 (kart-maps.js).
// 방장이 모든 카트의 이동·충돌을 함께 계산한다. 내 화면은 입력을 즉시 예측하고 방장 상태로 보정한다.
// SPACE 드리프트를 놓으면 충전에 비례한 부스트. 같은 층의 카트끼리 부딪혀 밀려난다.
import { h, isTyping, shuffle, AGAIN_INTRO } from '../util.js';
import { avatar, nameTag } from '../ui.js';
import { createRacePrediction } from './race-prediction.js';
import { createBumperAudio } from './bumper-audio.js';
import { buildTrack, newCar, stepCar, locate, botInput, gateAngle, ballAt, pointAt, roadWallOpen, branchesOf, roadOf, LAPS, CAR_R, KART, resolveKartContacts } from './race-core.js';
import { buildKartMap, KART_MAP_KEYS } from './kart-maps.js';

// 경기마다 맵이 바뀐다: S.maps[라운드-1] = 'city' | 'beach~'(좌우 반전) … 'wide' = 예전 와이드 8자(테스트용)
let T = null;
let trackSpec = null;
let L = 0;
let CPS = 0;                      // 체크포인트 = 구간 시작 (출발 직선 빼고). 다 지나고 결승선을 넘으면 한 바퀴
let RUNS = [];
let BOUNDS = null;
let RAILS = [];
let KERBS = [];                   // 카트 맵 코너의 연석 (본선 점 묶음)
const builtTracks = new Map();
const LEGACY_NAMES = ['추월 직선', '첫 번째 코너', '와이드 헤어핀', '드리프트 S자', '고가 직선', '지름길 갈림길', '합류 코너', '결승 직선'];
const specOf = S => S?.maps?.[(S.round || 1) - 1] || 'wide';
function useTrack(spec) {
  if (spec === trackSpec && T) return;
  trackSpec = spec;
  T = builtTracks.get(spec) || (spec === 'wide' ? buildTrack(true) : buildKartMap(spec));
  builtTracks.set(spec, T);
  L = T.main.len;
  CPS = T.secStart.length - 1;
  RUNS = makeRuns();
  BOUNDS = makeBounds();
  RAILS = makeRails();
  KERBS = makeKerbs();
}
// 테스트용: 맵 순서 고정 (예: ['wide'])
let forcedMaps = null;
export function useKartMaps(list) { forcedMaps = list; }
function pickMaps() {
  if (forcedMaps) return [0, 1, 2].map(i => forcedMaps[i % forcedMaps.length]);
  return shuffle(KART_MAP_KEYS).slice(0, 3).map(k => (Math.random() < 0.5 ? `${k}~` : k));
}
const mapName = spec => {
  const t = builtTracks.get(spec) || (spec === 'wide' ? null : buildKartMap(spec));
  return t ? `${t.name}${t.mirror ? ' (반전)' : ''}` : '와이드 8자';
};
const sectionNames = () => T.sections || LEGACY_NAMES;
useTrack('wide');
const INTRO = 4500;
const LIGHT = 1000;               // 신호등 한 칸
const READY = LIGHT * 2;          // 빨강 → 주황 → 초록이 켜지는 순간 출발
const FINISH_WAIT = 10000;       // 첫 완주 뒤 이 안에 들어와야 완주
const MAX_RACE = 45000;
const maxRace = () => T.maxRace || MAX_RACE;
const laps = () => T.laps || LAPS;   // 카트 맵은 두 바퀴 (예전 와이드 트랙은 한 바퀴)
const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
const SEND_EVERY = 100;
const STEP = 1 / 60;
const INPUT_LEASE = 600;
const r2 = v => Math.round(v * 100) / 100;
const fmt = ms => (ms == null ? '-' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`);

/* ───────── 심판 (방장) ───────── */

// 출발 줄: 한 줄에 4대까지, 5대부터는 4.5m 뒤에 둘째 줄 (차끼리 겹치지 않게)
function gridCars(roster) {
  const start = pointAt(T.main, T.start);
  const perRow = Math.min(4, roster.length);
  const spacing = Math.min(3, (start.half - KART.radius - 0.1) * 2 / Math.max(1, perRow - 1));
  return Object.fromEntries(roster.map((p, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, roster.length - row * perRow);
    const at = row ? pointAt(T.main, T.start - row * 4.5) : start;
    const car = newCar(T);
    const lat = (i % perRow - (inRow - 1) / 2) * spacing;
    Object.assign(car, { x: at.x - at.ty * lat, y: at.y + at.tx * lat, seg: at.i, s: at.s, ms: at.s, lat });
    return [p.id, { ...car, dist: 0, lap: 0, cp: 0, spl: 0, sh: 0, jmp: 0, jf: 0, seq: 0, throttle: 0, steerIntent: 0, braking: false, held: false, inputAt: 0, t: 0 }];
  }));
}

// 위치가 바뀔 때마다: 큰 길 거리(ms)로 체크포인트·결승선 통과를 센다
function advance(S, id, ms, t) {
  const c = S.cars[id];
  let d = ms - c.ms;
  if (d > L / 2) d -= L;
  if (d < -L / 2) d += L;
  if (!c.fin) c.dist = r2(c.dist + d);
  if (!c.fin && d > 0 && d < 40) {
    if (c.cp < CPS) {
      // c.ms는 0.01m로 반올림해 저장한다. 비교도 같은 반올림으로 해야 체크포인트 바로 앞(0.005m 안)에 멈춘 걸음에서
      // 저장값이 체크포인트를 넘어 버려 통과를 놓치는 일이 없다
      const s = r2(T.secStart[c.cp + 1]);
      if (c.ms < s && r2(ms) >= s) {
        c.cp++;
        split(S, c, t);
      }
    } else if (c.ms > L - 40 && ms < 40) {
      const lapMs = t - (c.lapAt || S.startAt);
      c.best = Math.min(c.best || Infinity, lapMs);
      c.lap++;
      c.cp = 0;
      c.lapAt = t;
      split(S, c, t);
      if (c.lap >= laps()) {
        c.fin = Math.max(1, t - S.startAt);
        Object.assign(c, { vx: 0, vy: 0, charge: 0, boostLeft: 0, dr: 0 });
        S.finishBy ??= t + FINISH_WAIT;
      }
    }
  }
  c.ms = r2(ms);
}

// 구간 기록: 그 구간을 제일 먼저 지난 사람과 몇 초 차이
function split(S, c, t) {
  const key = `${c.lap}:${c.cp}`;
  S.firsts ||= {};
  S.firsts[key] ??= t;
  c.split = Math.round((t - S.firsts[key]) / 100) / 10;
}

function onDrive(ctx, pid, data, now) {
  const S = ctx.state;
  const c = S.cars?.[pid];
  if (!c || c.fin || !['ready', 'race'].includes(S.phase) || data.round !== S.round ||
      S.roster.find(p => p.id === pid)?.bot || !ctx.isOnline(pid)) return false;
  if (!Number.isSafeInteger(data.seq) || data.seq <= (c.seq || 0) ||
      !Number.isFinite(data.throttle) || data.throttle < 0 || data.throttle > 1 ||
      !Number.isFinite(data.steer) || data.steer < -1 || data.steer > 1 || typeof data.brake !== 'boolean' || typeof data.drift !== 'boolean') return false;
  // Consume elapsed time under the previous input before installing this one.
  if (S.phase === 'race') stepWorld(ctx, now);
  if (c.fin) return true;
  Object.assign(c, { throttle: data.throttle, steerIntent: data.steer, braking: data.brake, held: data.drift, seq: data.seq, inputAt: now });
  return true;
}

// Shared host world: all drivers move once, then contacts resolve in the same 60Hz step.
function stepWorld(ctx, now) {
  const S = ctx.state;
  const end = Math.min(now, S.startAt + maxRace(), S.finishBy || Infinity);
  let at = S.worldAt ?? S.startAt;
  const count = Math.min(30, Math.floor((end - at + 0.00001) / (STEP * 1000)));
  if (count <= 0) return false;
  if (end - at > 500) at = end - count * STEP * 1000;
  ctx.drivers ||= new Map();
  for (let i = 0; i < count; i++) {
    at += STEP * 1000;
    const live = S.roster.filter(p => !S.cars[p.id].fin);
    const prev = new Map(live.map(p => {
      const c = S.cars[p.id];
      return [p.id, { x: c.x, y: c.y, hx: c.hx, hy: c.hy, ms: c.ms }];
    }));
    for (const p of live) {
      const c = S.cars[p.id];
      let input = null;
      if (p.bot) {
        let driver = ctx.drivers.get(p.id);
        // bold = 숨은 길을 겁 없이 밟는 봇 (자주 떨어져서 위험하다는 걸 보여 준다)
        if (!driver) ctx.drivers.set(p.id, driver = { mem: { short: false, bold: Math.random() < 0.45 }, skill: .88 + Math.random() * .1 });
        input = botInput(T, c, driver.mem, driver.skill, at);
      } else if (ctx.isOnline(p.id) && at - c.inputAt <= INPUT_LEASE) {
        input = { throttle: c.throttle || 0, steer: c.steerIntent || 0, brake: !!c.braking, drift: !!c.held };
      }
      if (p.bot) Object.assign(c, { throttle: input?.throttle || 0, steerIntent: input?.steer || 0, braking: !!input?.brake, held: !!input?.drift, inputAt: at });
      if (!input) { c.charge = 0; c.driftHeld = false; }
      const events = stepCar(T, c, input, STEP, at);
      if (events.includes('splash')) c.spl++;
      if (events.includes('land')) c.jmp++;
    }
    const impacts = resolveKartContacts(T, live.map(p => ({ id: p.id, car: S.cars[p.id], prev: prev.get(p.id) })), STEP);
    for (const hit of impacts) {
      const a = S.cars[hit.a], b = S.cars[hit.b];
      if (at - Math.max(a.hitAt || 0, b.hitAt || 0) < 140) continue;
      a.hitAt = b.hitAt = at;
      S.fxNo = (S.fxNo || 0) + 1;
      S.fx = [...(S.fx || []), { n: S.fxNo, at, ...hit }].slice(-12);
    }
    for (const p of live) {
      const c = S.cars[p.id];
      const place = locate(T, c, c.x, c.y);
      if (place && !c.sp && !c.air) {
        Object.assign(c, { path: place.path, seg: place.seg, s: place.s, lat: place.lat });
        c.ms = prev.get(p.id).ms;
        advance(S, p.id, place.ms, at);
      }
      c.t = at;
      c.h = Math.atan2(c.hy, c.hx);
      c.boost = c.boostLeft > 0 ? 1 : 0;
    }
    S.worldAt = at;
    if (S.roster.every(p => S.cars[p.id].fin) || S.finishBy && at >= S.finishBy) break;
  }
  return true;
}

function rank(S) {
  return [...S.roster].sort((a, b) => {
    const A = S.cars[a.id];
    const B = S.cars[b.id];
    if (A.fin && B.fin) return A.fin - B.fin;
    if (A.fin || B.fin) return A.fin ? -1 : 1;
    return B.dist - A.dist;
  }).map(p => p.id);
}

function finish(ctx) {
  const S = ctx.state;
  const order = rank(S);
  S.points ||= {};
  const earned = {};
  order.forEach((id, i) => {
    earned[id] = S.cars[id].fin || S.cars[id].dist > 5 ? POINTS[i] : 0;
    S.points[id] = (S.points[id] || 0) + earned[id];
  });
  S.roundResults ||= [];
  S.roundResults.push({ round: S.round, order, earned });
  S.totalOrder = [...order].sort((a, b) => S.points[b] - S.points[a] || order.indexOf(a) - order.indexOf(b));
  S.order = order;
  if (S.round < 3) {
    S.phase = 'intermission';
    S.nextAt = ctx.now() + 5000;
  } else {
    S.order = S.totalOrder;
    S.standings = Object.fromEntries(S.order.map((id, i) => [id, S.points[id] > 0 ? S.points[id] * 10 + S.order.length - i : 0]));
    S.titles = { [S.order[0]]: ['🏁 우승', `🏆 ${S.points[S.order[0]]}점`] };
    S.phase = 'final';
    S.over = true;
  }
  return true;
}

/* ───────── 화면 ───────── */

// 트랙 그리기용: 구간·층이 같은 점들을 이어 둔다
function makeRuns() {
  const runs = [];
  const pts = T.main.pts;
  let cur = null;
  pts.forEach((p, i) => {
    const key = `${p.sec}:${p.layer}`;
    if (!cur || cur.key !== key) {
      // 이음매는 한 칸씩 겹쳐서 칠한다 (딱 맞닿으면 가는 틈이 보임)
      if (cur) cur.pts.push(p, pts[(i + 1) % pts.length]);
      cur = { key, sec: p.sec, layer: p.layer, pts: i ? [pts[i - 1]] : [] };
      runs.push(cur);
    }
    cur.pts.push(p);
    if (i === pts.length - 1) cur.pts.push(pts[0]);
  });
  return runs;
}
// 미니맵 범위: 본선과 보이는 갈래길만 (숨은 지름길은 미니맵에 없다)
function makeBounds() {
  const edges = [...T.main.pts, ...branchesOf(T).filter(b => !b.hidden).flatMap(b => b.pts)].flatMap(p => [-1, 1].map(side => ({
    x: p.x - p.ty * side * (p.half + 2), y: p.y + p.tx * side * (p.half + 2),
  })));
  return { x0: Math.min(...edges.map(p => p.x)), x1: Math.max(...edges.map(p => p.x)),
    y0: Math.min(...edges.map(p => p.y)), y1: Math.max(...edges.map(p => p.y)) };
}
// 실제 열린 이음새와 같은 판정으로 난간을 끊는다. 화면에만 막힌 입구를 만들지 않는다.
// 벽이 없는 길(낭떠러지)은 난간도 없다
// 코너(9m 사이에 15도 넘게 꺾이는 곳)마다 양쪽 가장자리에 빨강·하양 연석
function makeKerbs() {
  if (!T.kart) return [];
  const pts = T.main.pts;
  const n = pts.length;
  const runs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 3 + n) % n];
    const b = pts[(i + 3) % n];
    if (Math.abs(a.tx * b.ty - a.ty * b.tx) > 0.25) (cur ||= []).push(pts[i]);
    else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs.filter(run => run.length > 3);
}

function makeRails() {
  const rails = [];
  for (const [path, road] of [['main', T.main], ...branchesOf(T).map(b => [b.id, b])].filter(([, road]) => road.pts[0].walls)) {
    for (const side of [-1, 1]) {
      let run = null;
      const count = road.closed ? road.n : road.n - 1;
      for (let i = 0; i < count; i++) {
        const a = road.pts[i], b = road.pts[(i + 1) % road.n];
        if (a.layer !== b.layer) { run = null; continue; }
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(length / .35));
        const at = t => {
          const tx = a.tx + (b.tx - a.tx) * t, ty = a.ty + (b.ty - a.ty) * t;
          const norm = Math.hypot(tx, ty) || 1;
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
            tx: tx / norm, ty: ty / norm, half: a.half + (b.half - a.half) * t,
            s: a.s + length * t, layer: a.layer };
        };
        for (let j = 0; j < steps; j++) {
          // 열린 경계를 잘게 잘라, 끝점 하나의 판정으로 바깥 난간까지 지우지 않는다.
          if (roadWallOpen(T, path, at((j + .5) / steps), side)) { run = null; continue; }
          if (!run) { run = { path, layer: a.layer, side, pts: [at(j / steps)] }; rails.push(run); }
          run.pts.push(at((j + 1) / steps));
        }
      }
    }
  }
  return rails;
}
const TAU = Math.PI * 2;
// 몸통 방향 (라디안): 내 차는 hx·hy, 남의 차는 받은 h
const heading = c => (c.hx !== undefined ? Math.atan2(c.hy, c.hx) : Number.isFinite(c.h) ? c.h : Math.atan2(c.vy || 0, c.vx || 1));
const COLORS = { water: '#344552', waterHi: '#425563', edge: '#202a36', ice: '#657382', snow: '#657382', wall: '#ffcf67', bridge: '#7b8998', rail: '#f8f9fa' };
// 맵 테마: 바닥·길·난간 색
// 카트 맵 길은 벽 없이 바닥보다 높게 떠 있다 (밖으로 나가면 떨어짐): edge = 길 가장자리 턱, side = 아래로 보이는 옆면.
// kerb = 코너 연석 두 색
const THEMES = {
  wide: { bg: COLORS.water, edge: COLORS.edge, road: COLORS.ice, rail: COLORS.wall, dash: '#e86656', ripple: true },
  city: { bg: '#363d4a', edge: '#ced4da', side: '#22262e', road: '#565d69', rail: '#ced4da', dash: '#9aa1ab', kerb: ['#e03131', '#f1f3f5'] },
  snow: { bg: '#e6eff6', edge: '#ffffff', side: '#8197ab', road: '#6b7886', rail: '#ffffff', dash: '#e03131', kerb: ['#e03131', '#f8f9fa'] },
  beach: { bg: '#ecd29a', edge: '#f3e2b5', side: '#8f6b38', road: '#78838f', rail: '#ffffff', dash: '#1c7ed6', kerb: ['#1c7ed6', '#f8f9fa'] },
  site: { bg: '#9a7445', edge: '#fcc419', side: '#3b2a17', road: '#666a71', rail: '#fcc419', dash: '#212529', kerb: ['#fcc419', '#212529'] },
};
// 칸 (i, j)마다 정해진 0~1 값 (바닥 잔무늬가 모두에게, 매 프레임 같게)
const hash2 = (i, j) => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const frac = x => x - Math.floor(x);
// 갈림길 노면 색
const LOOKS = { alley: '#3b4048', ice: '#d4ebf7', cave: '#6b5b4b', sand: '#e6c487', steel: '#a3acb6', plank: '#b07f55' };
const themeOf = () => THEMES[T.theme] || THEMES.wide;

export default {
  id: 'race',
  title: '카트 그랑프리',
  emoji: '🏁',
  tag: '액션',
  color: '#1c7ed6',
  desc: '경기마다 바뀌는 맵 3개로 합산 승부! 헤어핀은 Shift/Space 드리프트, 아는 사람만 타는 숨은 지름길로 역전.',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: 50,

  setup(ctx, prev) {
    const now = ctx.now();
    const maps = pickMaps();
    useTrack(maps[0]);
    return {
      phase: 'intro', round: 1, maps, points: Object.fromEntries(ctx.roster.map(p => [p.id, 0])), roundResults: [],
      introUntil: now + (prev ? AGAIN_INTRO : INTRO),
      again: !!prev,
      cars: gridCars(ctx.roster), fx: [], fxNo: 0,
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    if (type !== 'drive') return false;
    useTrack(specOf(ctx.state));
    return onDrive(ctx, pid, data, ctx.now());
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    useTrack(specOf(S));
    if (S.phase === 'intermission') {
      if (now < S.nextAt) return false;
      S.round++;
      useTrack(specOf(S));
      S.cars = gridCars(S.roster); S.fx = []; S.fxNo = 0;
      S.firsts = {}; S.finishBy = null; S.order = S.roster.map(p => p.id);
      S.phase = 'ready'; S.startAt = now + READY;
      ctx.drivers = new Map(); S.worldAt = S.startAt;
      return true;
    }
    if (S.phase === 'intro') {
      if (now < S.introUntil) return false;
      Object.assign(S, { phase: 'ready', startAt: now + READY, worldAt: now + READY });
      return true;
    }
    if (S.phase === 'ready') {
      if (now < S.startAt) return false;
      S.phase = 'race';
      S.worldAt = S.startAt;
      for (const c of Object.values(S.cars)) c.t = S.startAt;
      return true;
    }
    if (S.phase !== 'race') return false;
    stepWorld(ctx, now);
    S.order = rank(S);
    const all = S.roster.every(p => S.cars[p.id].fin);
    if (all || (S.finishBy && now >= S.finishBy) || now - S.startAt >= maxRace()) return finish(ctx);
    return true;
  },

  // 봇은 tick에서 방장이 직접 움직인다 (입력을 보낼 필요 없음)
  bot() {
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const audio = createBumperAudio();
    const top = h('div', { class: 'rc-top' });
    const canvas = h('canvas', { class: 'rc-canvas' });
    const mini = h('canvas', { class: 'rc-mini', width: 200, height: 150 });
    const overlay = h('div', { class: 'rc-overlay' });
    const fxBox = h('div', { class: 'rc-fx' });
    const wheel = h('span', { class: 'rc-steering-wheel', 'aria-hidden': 'true' });
    wheel.innerHTML = '<svg viewBox="0 0 48 48" width="38" height="38"><circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="6"/><path d="M8 20L24 27 40 20M24 27V42" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="24" cy="25" r="5" fill="currentColor"/></svg>';
    const gasKey = h('span', { class: 'rc-pedal gas' }, h('kbd', {}, 'W / ↑'), '가속');
    const brakeKey = h('span', { class: 'rc-pedal brake' }, h('kbd', {}, 'S / ↓'), '제동·후진');
    const gear = h('span', { class: 'rc-gear', 'aria-label': '기어' }, 'N');
    const steerLabel = h('span', { class: 'rc-steering-label' }, h('kbd', {}, 'A ←'), wheel, h('kbd', {}, '→ D'));
    const driveHud = h('div', { class: 'rc-drivehud', hidden: true }, gasKey, steerLabel, brakeKey, gear);
    const sound = h('button', { class: 'rc-sound', type: 'button', tabindex: '-1' });
    const soundLabel = () => { sound.textContent = audio.enabled ? '🔊' : '🔇'; };
    soundLabel();
    sound.addEventListener('click', () => { audio.toggle(); soundLabel(); sound.blur(); });
    const stage = h('div', { class: 'rc-stage' }, canvas, mini, overlay, fxBox, sound, driveHud);
    const box = h('div', { class: 'rc-box' }, top, stage);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rc' }, box, side));
    document.activeElement?.blur?.();
    const g = canvas.getContext('2d');
    const mg = mini.getContext('2d');

    let S = null;
    let raf = 0;
    let last = performance.now();
    let drawnAt = 0;
    let acc = 0;
    let sentAt = 0;
    let inputSeq = 0;
    let prediction = createRacePrediction(T, me);
    let predTrack = T;
    let seenFx = 0;
    let impactFlashAt = 0;
    let cam = { x: 0, y: 0, z: 18, goal: 18, vx: 0, vy: 0, at: null, shake: 0 };
    let topKey = '';
    let sideKey = '';
    let overlayKey = '';
    let seenFin = false;
    let seenLap = 0;
    let rumbleAt = 0;
    let lastRound = null;
    let litLamp = -1;
    let car = newCar(T);                        // 내 차와 상대 차를 같은 시각으로 예측
    const keys = { l: false, r: false, u: false, d: false, drift: false };
    const pressed = new Set();
    const parts = [];                           // 효과 알갱이
    const skids = [];                           // 미끄러진 자국 { x0, y0, x1, y1, layer, t } (뒷바퀴 둘)
    const skidAt = new Map();                   // id → 지난 뒷바퀴 자리
    let wasDrift = 0;
    const splashes = [];
    const who = id => S?.roster.find(p => p.id === id) || { id, name: '?' };
    const mine = () => S?.cars?.[me];
    // 방장이 'race'로 바꾸는 걸 기다리지 않고, 초록불 시각이 되면 바로 달린다
    const racing = () => S?.phase === 'race' || (S?.phase === 'ready' && api.now() >= S.startAt);

    const KEY = { Space: 'drift', ShiftLeft: 'drift', ShiftRight: 'drift', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };
    function onKey(e) {
      if (isTyping(e) && e.type !== 'keyup') return;
      const k = KEY[e.code];
      if (!k) return;
      e.preventDefault();
      if (e.type === 'keydown') pressed.add(e.code); else pressed.delete(e.code);
      const next = [...pressed].some(code => KEY[code] === k);
      if (keys[k] === next) return;
      keys[k] = next;
      if (e.type === 'keydown') void audio.unlock();
      sendDrive(performance.now(), true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    function resetControls(send = true) {
      pressed.clear();
      keys.l = keys.r = keys.u = keys.d = keys.drift = false;
      car.charge = 0; car.driftHeld = false;
      if (send) sendDrive(performance.now(), true);
    }
    const onBlur = () => resetControls();
    window.addEventListener('blur', onBlur);
    const onFocus = e => { if (isTyping(e)) onBlur(); };
    const onVisibility = () => { if (document.hidden) onBlur(); };
    window.addEventListener('focusin', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.dataset.dpr = dpr;
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function flash(text, cls = '') {
      const el = h('div', { class: `rc-flash ${cls}` }, text);
      fxBox.append(el);
      setTimeout(() => el.remove(), 1800);
    }

    function rawInput() {
      return { throttle: keys.u ? 1 : 0, steer: (keys.r ? 1 : 0) - (keys.l ? 1 : 0), brake: keys.d, drift: keys.drift };
    }

    function sendDrive(now, force = false) {
      if (!S || !['ready', 'race'].includes(S.phase) || !mine() || mine().fin || now - sentAt < SEND_EVERY && !force) return;
      sentAt = now;
      const input = rawInput();
      const t = api.now();
      prediction.recordInput({ ...input, seq: ++inputSeq }, t);
      api.send('drive', { round: S.round, seq: inputSeq, ...input });
    }

    // 내 차 물리: 1/60초 고정 걸음 (노트북 속도와 상관없이 같은 결과)
    function drive(dtMs) {
      acc = Math.min(acc + dtMs, 200);
      while (acc >= STEP * 1000) {
        acc -= STEP * 1000;
        const t = api.now() - acc;
        const result = prediction.step(STEP, t);
        car = prediction.car(me) || car;
        for (const e of result.events) onEvent(e);
        for (const hit of result.impacts) {
          if (hit.a === me || hit.b === me) cam.shake = Math.max(cam.shake, Math.min(.6, hit.strength / 35));
        }
        // 꼬리가 빠지면(드리프트): 끼익 + 얼음 가루
        if (car.dr && !wasDrift) audio.skid();
        wasDrift = car.dr;
        if (car.dr && Math.random() < 0.6) parts.push({ x: car.x - car.hx * 0.6, y: car.y - car.hy * 0.6, vx: -car.vx * 0.2 + (Math.random() - 0.5) * 4, vy: -car.vy * 0.2 + (Math.random() - 0.5) * 4, life: 0.5, c: '#ffffff' });
      }
    }

    function onEvent(e) {
      if (e === 'splash') {
        splashes.push({ x: car.x, y: car.y, t: performance.now() });
        audio.impact(true, true);
        cam.shake = 0.6;
        flash(T.kart && T.theme !== 'beach' ? '😵 추락!' : '🌊 풍덩!', 'bad');
      } else if (e === 'respawn') {
        car.charge = 0;
      } else if (e === 'land') {
        cam.shake = 0.35;
        audio.impact(false, true);

      } else if (e === 'wall' || e === 'gate') {
        cam.shake = Math.max(cam.shake, 0.3);
        audio.impact(e === 'gate', true);
      } else if (e === 'boost') {
        flash('⚡ 부스트!');
        for (let i = 0; i < 12; i++) parts.push({ x: car.x, y: car.y, vx: (Math.random() - 0.5) * 6 - car.vx * 0.3, vy: (Math.random() - 0.5) * 6 - car.vy * 0.3, life: 0.6, c: '#ffd43b' });
      }
    }

    // All karts come from one predicted world at the same timestamp, including contact resolution.
    function ghostAt(id) {
      return prediction.car(id);
    }

    /* 그리기 */
    function poly(pts, close) {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      if (close) g.closePath();
    }
    // 가장자리에서 extra만큼 더 바깥 선 (side: 오른쪽 +1, 왼쪽 -1)
    const edgeLine = (pts, side, extra) => pts.map(p => ({ x: p.x - p.ty * side * (p.half + extra), y: p.y + p.tx * side * (p.half + extra) }));

    // 트랙 바닥 = 양쪽 가장자리를 이은 면 (점마다 폭이 달라도 매끈하게)
    function band(pts, extra) {
      g.beginPath();
      pts.forEach((p, i) => {
        const o = p.half + extra;
        if (i) g.lineTo(p.x - p.ty * o, p.y + p.tx * o);
        else g.moveTo(p.x - p.ty * o, p.y + p.tx * o);
      });
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        const o = p.half + extra;
        g.lineTo(p.x + p.ty * o, p.y - p.tx * o);
      }
      g.closePath();
    }

    function drawTrackLayer(layer) {
      g.lineJoin = 'round';
      g.lineCap = 'round';
      const runs = RUNS.filter(run => run.layer === layer);
      if (layer) {
        // 고가 다리: 그림자 → 테두리 → 바닥 → 가운데 점선
        g.save();
        g.translate(1.2, 1.8);
        g.fillStyle = 'rgba(0,0,0,.28)';
        for (const run of runs) {
          band(run.pts, 0.6);
          g.fill();
        }
        g.restore();
      }
      // 테두리를 다 그린 다음 바닥 (구간 이음매에서 테두리가 바닥 위로 올라오지 않게)
      const th = themeOf();
      // 카트 맵: 벽 없는 길은 바닥에서 떠 있다 → 바닥 그림자, 아래쪽으로 보이는 옆면
      if (!layer && T.kart) {
        const floating = [...runs.map(run => run.pts), ...branchesOf(T).filter(b => !b.pts[0].walls).map(b => b.pts)];
        g.save();
        g.translate(1.6, 2.4);
        g.fillStyle = 'rgba(0,0,0,.22)';
        for (const pts of floating) {
          band(pts, 0.6);
          g.fill();
        }
        g.restore();
        g.save();
        g.translate(0, 1.1);
        g.fillStyle = th.side;
        for (const pts of floating) {
          band(pts, 0.4);
          g.fill();
        }
        g.restore();
      }
      g.fillStyle = layer ? '#6c757d' : th.edge;
      for (const run of runs) {
        band(run.pts, layer ? 0.6 : 0.4);
        g.fill();
      }
      if (!layer) for (const b of branchesOf(T)) { band(b.pts, .4); g.fill(); }
      for (const run of runs) {
        g.fillStyle = layer ? COLORS.bridge : th.road;
        band(run.pts, 0);
        g.fill();
      }
      if (!layer) {
        for (const b of branchesOf(T)) {
          g.fillStyle = LOOKS[b.look] || '#426b70';
          band(b.pts, 0);
          g.fill();
          // 철판 이음새·판자 줄
          if (b.look === 'steel' || b.look === 'plank') {
            g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = .08;
            for (let k = 0; k < b.n; k += 2) {
              const p = b.pts[k];
              g.beginPath(); g.moveTo(p.x + p.ty * p.half, p.y - p.tx * p.half); g.lineTo(p.x - p.ty * p.half, p.y + p.tx * p.half); g.stroke();
            }
          }
        }
      }
      if (layer) {
        g.setLineDash([0.6, 0.9]);
        g.strokeStyle = '#9aa1a9';
        g.lineWidth = 0.15;
        for (const run of runs) {
          poly(run.pts);
          g.stroke();
        }
        g.setLineDash([]);
      }
      if (!layer) {
        g.setLineDash([1.8, 2.6]); g.strokeStyle = 'rgba(255,255,255,.26)'; g.lineWidth = .13;
        for (const run of runs) { poly(run.pts); g.stroke(); }
        g.setLineDash([]);
        // 직선의 보조 차선은 나란히 달릴 공간을 보여 준다.
        g.setLineDash([2.8, 3.6]); g.strokeStyle = 'rgba(255,255,255,.15)';
        for (const run of runs.filter(run => T.kart || [0, 4, 7].includes(run.sec))) {
          for (const side of [-1, 1]) {
            poly(run.pts.map(p => ({ x: p.x - p.ty * side * p.half / 2, y: p.y + p.tx * side * p.half / 2 })));
            g.stroke();
          }
        }
        g.setLineDash([]);
      }
      if (!layer && T.kart) {
        if (T.theme === 'site') {
          g.setLineDash([1, 1]); g.strokeStyle = '#212529'; g.lineWidth = 0.3; g.lineCap = 'butt';
          for (const run of runs) {
            for (const side of [-1, 1]) {
              poly(edgeLine(run.pts, side, 0.2));
              g.stroke();
            }
          }
          g.setLineDash([]); g.lineCap = 'round';
        }
        drawMarkings();
      }
      // 벽: 타이어 색상의 보호 난간 (숨은 길의 벽은 건물·바위처럼 어둡게). 카트 맵은 그림자를 깔아 입체감
      for (const run of RAILS.filter(run => run.layer === layer)) {
        const hiddenRoad = run.path !== 'main' && roadOf(T, run.path)?.hidden;
        if (!layer && T.kart) {
          g.save();
          g.translate(0.25, 0.35);
          g.strokeStyle = 'rgba(0,0,0,.28)';
          g.lineWidth = 0.7;
          poly(edgeLine(run.pts, run.side, 0.35));
          g.stroke();
          g.restore();
        }
        g.strokeStyle = hiddenRoad ? '#1d2024' : layer ? COLORS.rail : themeOf().rail;
        g.lineWidth = layer ? 0.35 : 0.7;
        poly(edgeLine(run.pts, run.side, layer ? 0.1 : 0.35));
        g.stroke();
        if (!layer && !hiddenRoad) {
          g.setLineDash([1.1, 1.1]); g.strokeStyle = themeOf().dash;
          g.lineWidth = .48; g.stroke(); g.setLineDash([]);
        }
      }
    }

    const circle = (x, y, r) => {
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    };
    const oval = (x, y, rx, ry, a = 0) => {
      g.beginPath();
      g.ellipse(x, y, rx, ry, a, 0, TAU);
      g.fill();
    };

    // 바닥: 칸마다 정해진 잔무늬(눈 더미·모래 물결·자갈) → 바다·호수·공원. v = 화면에 보이는 영역
    function drawGround(v, now) {
      const th = T.theme;
      const C = 4;
      for (let i = Math.floor(v.x0 / C); i <= v.x1 / C; i++) {
        for (let j = Math.floor(v.y0 / C); j <= v.y1 / C; j++) {
          const r = hash2(i, j);
          if (r > 0.55) continue;
          const x = (i + hash2(j, i)) * C;
          const y = (j + hash2(i + 7, j - 3)) * C;
          const a = r * 40;
          if (th === 'snow') {
            if (r < 0.25) {
              g.fillStyle = 'rgba(255,255,255,.9)'; oval(x, y, 1.3, 0.7, a);
              g.strokeStyle = 'rgba(130,155,182,.35)'; g.lineWidth = 0.14;
              g.beginPath(); g.ellipse(x + 0.1, y + 0.15, 1.3, 0.7, a, 0.2, Math.PI - 0.2); g.stroke();
            } else if (r < 0.4) {
              g.fillStyle = 'rgba(255,255,255,.95)'; g.fillRect(x, y, 0.18, 0.18);
            } else {
              g.fillStyle = 'rgba(120,145,172,.2)'; circle(x, y, 0.3);
            }
          } else if (th === 'beach') {
            if (r < 0.3) {
              g.strokeStyle = 'rgba(170,132,72,.32)'; g.lineWidth = 0.14;
              g.beginPath(); g.arc(x, y, 1.6, a, a + 1.1); g.stroke();
              g.beginPath(); g.arc(x, y, 2.1, a + 0.1, a + 1); g.stroke();
            } else if (r < 0.38) {
              g.fillStyle = '#fff8e8'; circle(x, y, 0.13);
            } else {
              g.fillStyle = 'rgba(205,168,100,.22)'; oval(x, y, 1.5, 0.8, a);
            }
          } else if (th === 'site') {
            if (r < 0.25) {
              g.fillStyle = 'rgba(85,80,75,.45)'; circle(x, y, 0.18 + r * 0.6);
            } else if (r < 0.42) {
              g.fillStyle = 'rgba(105,76,42,.35)'; oval(x, y, 1.3, 0.7, a);
            } else if (r < 0.48) {
              // 바퀴 자국 한 쌍
              g.strokeStyle = 'rgba(70,52,30,.3)'; g.lineWidth = 0.3;
              const ux = Math.cos(a);
              const uy = Math.sin(a);
              for (const o of [-0.6, 0.6]) {
                g.beginPath(); g.moveTo(x - ux * 2.5 - uy * o, y - uy * 2.5 + ux * o); g.lineTo(x + ux * 2.5 - uy * o, y + uy * 2.5 + ux * o); g.stroke();
              }
            }
          } else if (th === 'city') {
            if (r < 0.1) {
              g.fillStyle = 'rgba(0,0,0,.14)'; oval(x, y, 1.1, 0.7, a);
            } else if (r < 0.16) {
              g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x - 1.5, y - 1.5, 3, 3);
            }
          }
        }
      }
      // 바다: 젖은 모래 → 물 → 얕은 물 → 밀려왔다 빠지는 거품
      if (T.sea) {
        const k = (Math.sin(now / 1100) + 1) / 2;
        g.save();
        g.lineJoin = 'round';
        g.strokeStyle = '#d6b97f'; g.lineWidth = 6 + 3 * k;
        poly(T.sea.shore); g.stroke();
        g.fillStyle = '#2f8fd8';
        poly(T.sea.poly, true); g.fill();
        g.clip();
        poly(T.sea.shore);
        g.strokeStyle = '#4ea6e6'; g.lineWidth = 26; g.stroke();
        g.strokeStyle = '#7cc4f2'; g.lineWidth = 10; g.stroke();
        g.strokeStyle = `rgba(255,255,255,${0.5 + 0.35 * k})`; g.lineWidth = 1.5 + 3 * k;
        g.setLineDash([2.4, 1.2]); g.lineDashOffset = now / 300; g.stroke(); g.setLineDash([]);
        // 먼바다 잔물결
        g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 0.18;
        for (let i = Math.floor(v.x0 / 7); i <= v.x1 / 7; i++) {
          for (let j = Math.floor(v.y0 / 5); j <= v.y1 / 5; j++) {
            const r = hash2(i * 3 + 1, j * 5 + 2);
            if (r > 0.35) continue;
            const x = (i + r * 2) * 7 + Math.sin(now / 700 + r * 9) * 0.6;
            const y = j * 5 + r * 4;
            g.beginPath(); g.moveTo(x - 1.2, y); g.quadraticCurveTo(x, y - 0.5, x + 1.2, y); g.stroke();
          }
        }
        g.restore();
      }
      for (const l of T.lakes || []) {
        if (l.x + l.rx < v.x0 || l.x - l.rx > v.x1 || l.y + l.ry < v.y0 || l.y - l.ry > v.y1) continue;
        g.save();
        if (l.kind === 'ice') {
          g.fillStyle = '#ffffff'; oval(l.x, l.y, l.rx + 1.6, l.ry + 1.6);
          g.fillStyle = '#b9dff3'; oval(l.x, l.y, l.rx, l.ry);
          g.clip();
          g.fillStyle = '#d3ecf8'; oval(l.x - l.rx * 0.12, l.y - l.ry * 0.12, l.rx * 0.75, l.ry * 0.7);
          g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 0.18;
          for (let k = 0; k < 9; k++) {
            const x = l.x + (hash2(k, 11) - 0.5) * l.rx * 1.6;
            const y = l.y + (hash2(11, k) - 0.5) * l.ry * 1.6;
            const a = hash2(k, k) * TAU;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4); g.lineTo(x + Math.cos(a + 0.6) * 7, y + Math.sin(a + 0.6) * 7); g.stroke();
          }
          g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 0.6;
          for (let k = 0; k < 5; k++) {
            const x = l.x - l.rx * 0.5 + k * l.rx * 0.25;
            g.beginPath(); g.moveTo(x, l.y - l.ry * 0.4); g.lineTo(x + 3, l.y - l.ry * 0.4 - 3); g.stroke();
          }
        } else if (l.kind === 'mud') {
          g.fillStyle = '#4a331d'; oval(l.x, l.y, l.rx + 1, l.ry + 1);
          g.fillStyle = '#5e4227'; oval(l.x, l.y, l.rx, l.ry);
          g.fillStyle = '#6d4f30'; oval(l.x - l.rx * 0.15, l.y - l.ry * 0.15, l.rx * 0.6, l.ry * 0.55);
          g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 0.2;
          for (let k = 0; k < 3; k++) {
            const q = frac(now / 3000 + k / 3);
            g.globalAlpha = 1 - q;
            g.beginPath(); g.ellipse(l.x + (k - 1) * l.rx * 0.4, l.y + (k % 2) * 3, 0.5 + q * 3, 0.3 + q * 1.8, 0, 0, TAU); g.stroke();
          }
          g.globalAlpha = 1;
        } else {
          // 공원: 잔디 + 산책로 + 작은 연못
          g.fillStyle = '#3f6a3a'; oval(l.x, l.y, l.rx + 1, l.ry + 1);
          g.fillStyle = '#4f7f45'; oval(l.x, l.y, l.rx, l.ry);
          g.clip();
          g.strokeStyle = '#c8b68a'; g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(l.x - l.rx, l.y + l.ry * 0.3); g.quadraticCurveTo(l.x, l.y - l.ry * 0.4, l.x + l.rx, l.y + l.ry * 0.1); g.stroke();
          g.beginPath(); g.moveTo(l.x - l.rx * 0.2, l.y - l.ry); g.quadraticCurveTo(l.x + l.rx * 0.2, l.y, l.x - l.rx * 0.1, l.y + l.ry); g.stroke();
          g.fillStyle = '#74c0fc'; oval(l.x + l.rx * 0.35, l.y + l.ry * 0.4, 3.5, 2.4);
        }
        g.restore();
      }
    }

    // 카트 맵 노면 표시: 하얀 가장자리 선, 코너 연석, 출발 칸, 도심 횡단보도
    function drawMarkings() {
      const th = themeOf();
      g.lineCap = 'butt';
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 0.14;
      for (const run of RUNS.filter(run => !run.layer)) {
        for (const side of [-1, 1]) {
          poly(edgeLine(run.pts, side, -1.05));
          g.stroke();
        }
      }
      g.lineWidth = 0.9;
      g.setLineDash([1.3, 1.3]);
      for (const run of KERBS) {
        for (const side of [-1, 1]) {
          poly(edgeLine(run, side, -0.5));
          g.strokeStyle = th.kerb[0]; g.lineDashOffset = 0; g.stroke();
          g.strokeStyle = th.kerb[1]; g.lineDashOffset = 1.3; g.stroke();
        }
      }
      g.setLineDash([]); g.lineDashOffset = 0;
      // 출발 칸 (한 줄 4칸 × 두 줄, gridCars와 같은 자리)
      const start = pointAt(T.main, T.start);
      const spacing = Math.min(3, (start.half - KART.radius - 0.1) * 2 / 3);
      g.strokeStyle = 'rgba(255,255,255,.65)'; g.lineWidth = 0.16;
      for (let row = 0; row < 2; row++) {
        const p = pointAt(T.main, T.start - row * 4.5);
        const at = (ds, l) => [p.x + p.tx * ds - p.ty * l, p.y + p.ty * ds + p.tx * l];
        for (let k = 0; k < 4; k++) {
          const lat = (k - 1.5) * spacing;
          g.beginPath();
          g.moveTo(...at(1.5, lat - 1.2)); g.lineTo(...at(-1.4, lat - 1.2)); g.lineTo(...at(-1.4, lat + 1.2)); g.lineTo(...at(1.5, lat + 1.2));
          g.stroke();
        }
      }
      // 도심: 곧은 길 가운데 횡단보도
      if (T.theme === 'city') {
        g.fillStyle = 'rgba(255,255,255,.62)';
        for (const s of T.secStart.slice(1).map(s0 => s0 + 14)) {
          const p = pointAt(T.main, s);
          const q = pointAt(T.main, s + 6);
          if (Math.abs(p.tx * q.ty - p.ty * q.tx) > 0.05) continue;
          g.save();
          g.translate(p.x, p.y);
          g.rotate(Math.atan2(p.ty, p.tx));
          for (let u = -p.half + 1.2; u < p.half - 1.4; u += 1.3) g.fillRect(-1.6, u, 3.2, 0.65);
          g.restore();
        }
      }
      g.lineCap = 'round';
    }

    // 맵 장식 (길에서 떨어진 곳, 화면 안만): 그림자(해는 왼쪽 위) → 건물 옥상·나무·소나무·바위·파라솔·야자수·자재
    function drawDeco(v) {
      const th = T.theme;
      const list = (T.deco || []).filter(d => d.x > v.x0 - 10 && d.x < v.x1 + 10 && d.y > v.y0 - 10 && d.y < v.y1 + 10);
      const bld = d => [d.size * 2 * (0.75 + 0.5 * frac(d.v * 7.3)), d.size * 2 * (0.75 + 0.5 * frac(d.v * 13.7))];
      const isTree = d => d.tree || (th === 'city' && d.v > 0.84);
      g.fillStyle = 'rgba(0,0,0,.2)';
      for (const d of list) {
        const r = d.size;
        if (th === 'city' && !isTree(d)) {
          const [w, h] = bld(d);
          const up = 0.6 + d.v * 1.8;
          g.fillRect(d.x - w / 2 + up, d.y - h / 2 + up * 1.3, w, h);
        } else oval(d.x + r * 0.25, d.y + r * 0.35, r * 0.8, r * 0.65);
      }
      for (const d of list) {
        const r = d.size;
        const { x, y } = d;
        if (isTree(d)) {
          const k = r * 0.65;
          g.fillStyle = '#2b8a3e'; circle(x, y, k);
          g.fillStyle = '#40c057'; circle(x - k * 0.22, y - k * 0.22, k * 0.62);
          g.fillStyle = 'rgba(255,255,255,.14)'; circle(x - k * 0.38, y - k * 0.38, k * 0.25);
        } else if (th === 'city') {
          const [w, h] = bld(d);
          const x0 = x - w / 2;
          const y0 = y - h / 2;
          g.fillStyle = ['#4a5263', '#565068', '#3f4b5e', '#5b6170'][Math.floor(d.v * 4)];
          g.fillRect(x0, y0, w, h);
          g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 0.25;
          g.strokeRect(x0 + 0.3, y0 + 0.3, w - 0.6, h - 0.6);
          g.fillStyle = '#9aa1ab'; g.fillRect(x0 + w * 0.18, y0 + h * 0.22, w * 0.24, h * 0.18);
          g.fillStyle = '#6c737d'; g.fillRect(x0 + w * 0.18, y0 + h * 0.4, w * 0.24, 0.12);
          if (d.v > 0.35) {
            g.fillStyle = '#7d8590'; circle(x0 + w * 0.7, y0 + h * 0.66, Math.min(w, h) * 0.13);
          }
          g.fillStyle = 'rgba(255,224,130,.4)';
          for (let k = 0; k < 3; k++) g.fillRect(x0 + w * (0.14 + k * 0.22), y0 + h * 0.78, w * 0.12, h * 0.08);
        } else if (th === 'snow') {
          if (d.v < 0.65) {
            g.fillStyle = '#1e4d33'; circle(x, y, r * 0.75);
            g.fillStyle = '#2a6644'; circle(x - r * 0.1, y - r * 0.1, r * 0.55);
            g.fillStyle = '#3a8558'; circle(x - r * 0.18, y - r * 0.18, r * 0.32);
            g.fillStyle = 'rgba(255,255,255,.92)';
            for (let k = 0; k < 4; k++) {
              const a = d.v * 20 + k * 1.7;
              circle(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, r * 0.13);
            }
          } else {
            g.fillStyle = '#7f8a96'; oval(x, y, r * 0.85, r * 0.6, d.v * 3);
            g.fillStyle = '#98a3ae'; oval(x - r * 0.12, y - r * 0.1, r * 0.6, r * 0.4, d.v * 3);
            g.fillStyle = '#f8fbff'; oval(x - r * 0.2, y - r * 0.18, r * 0.42, r * 0.24, d.v * 3);
          }
        } else if (th === 'beach') {
          if (d.v < 0.3) {
            const [c1, c2] = [['#ff6b6b', '#fff5f5'], ['#4dabf7', '#f8f9fa'], ['#ffd43b', '#ff922b'], ['#51cf66', '#f8f9fa']][Math.floor(d.v * 13) % 4];
            g.fillStyle = 'rgba(230,73,128,.8)'; g.fillRect(x + r * 0.45, y - r * 0.1, r * 0.45, r * 0.8);
            g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(x + r * 0.45, y + r * 0.15, r * 0.45, r * 0.12);
            for (let k = 0; k < 8; k++) {
              g.fillStyle = k % 2 ? c1 : c2;
              g.beginPath(); g.moveTo(x, y); g.arc(x, y, r * 0.6, (k / 8) * TAU, ((k + 1) / 8) * TAU); g.closePath(); g.fill();
            }
            g.fillStyle = '#495057'; circle(x, y, 0.15);
          } else {
            for (let k = 0; k < 7; k++) {
              const a = (k / 7) * TAU + d.v * 6;
              g.fillStyle = k % 2 ? '#2f9e44' : '#237a36';
              oval(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, r * 0.48, r * 0.15, a);
            }
            g.fillStyle = '#6b4423'; circle(x + 0.25, y + 0.1, 0.22); circle(x - 0.15, y + 0.25, 0.22);
            g.fillStyle = '#8a5a2b'; circle(x, y, r * 0.12);
          }
        } else if (th === 'site') {
          if (d.v < 0.4) {
            const k = r * 0.7;
            g.fillStyle = '#8a6036'; g.fillRect(x - k, y - k, k * 2, k * 2);
            g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 0.15;
            g.strokeRect(x - k, y - k, k * 2, k * 2);
            g.beginPath(); g.moveTo(x - k, y - k); g.lineTo(x + k, y + k); g.moveTo(x + k, y - k); g.lineTo(x - k, y + k); g.stroke();
            g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x - k, y - k, k * 2, k * 0.3);
          } else if (d.v < 0.55) {
            g.fillStyle = '#212529'; circle(x, y, r * 0.6);
            g.strokeStyle = '#495057'; g.lineWidth = 0.18;
            g.beginPath(); g.arc(x, y, r * 0.42, 0, TAU); g.stroke();
            g.fillStyle = '#7a5a36'; circle(x, y, r * 0.2);
          } else if (d.v < 0.72) {
            for (let k = 0; k < 5; k++) {
              const px = x + ((k % 3) - 1) * r * 0.42 + (k > 2 ? r * 0.21 : 0);
              const py = y + (k > 2 ? -r * 0.36 : 0);
              g.fillStyle = '#868e96'; circle(px, py, r * 0.21);
              g.fillStyle = '#343a40'; circle(px, py, r * 0.12);
            }
          } else {
            for (let k = 0; k < 3; k++) {
              const cx = x + (k - 1) * r * 0.5;
              const cy = y + (k % 2) * r * 0.3;
              g.fillStyle = '#ff922b'; circle(cx, cy, r * 0.22);
              g.fillStyle = '#ffffff'; circle(cx, cy, r * 0.14);
              g.fillStyle = '#ff922b'; circle(cx, cy, r * 0.07);
            }
          }
        }
      }
    }

    // 숨은 지름길 입구 가림막 (그림만, 지나갈 수 있음): 철망·눈 더미·폭포·출입금지 판자
    function drawCovers(now) {
      for (const b of branchesOf(T)) {
        if (!b.hidden || !b.inner) continue;
        for (const s of b.inner) {
          const p = pointAt(b, s);
          const nx = -p.ty;
          const ny = p.tx;
          const w = p.half + 0.6;
          g.save();
          if (b.look === 'alley') {
            g.strokeStyle = 'rgba(200,205,212,.85)'; g.lineWidth = 0.18; g.setLineDash([0.35, 0.25]);
            g.beginPath(); g.moveTo(p.x - nx * w, p.y - ny * w); g.lineTo(p.x + nx * w, p.y + ny * w); g.stroke();
          } else if (b.look === 'ice') {
            g.fillStyle = 'rgba(255,255,255,.92)';
            for (let k = -2; k <= 2; k++) { g.beginPath(); g.arc(p.x + nx * k * w / 2.5, p.y + ny * k * w / 2.5, 0.9, 0, TAU); g.fill(); }
          } else if (b.look === 'cave') {
            for (let k = 0; k < 9; k++) {
              const u = (k / 8 - 0.5) * 2 * w;
              const ph = ((now / 260 + k * 0.37) % 1);
              g.strokeStyle = `rgba(${k % 2 ? '165,216,255' : '255,255,255'},${0.55 + ph * 0.4})`; g.lineWidth = 0.35;
              g.beginPath(); g.moveTo(p.x + nx * u - p.tx * 1.2, p.y + ny * u - p.ty * 1.2); g.lineTo(p.x + nx * u + p.tx * 1.2, p.y + ny * u + p.ty * 1.2); g.stroke();
            }
          } else {
            g.lineWidth = 0.45; g.setLineDash([0.5, 0.5]);
            g.strokeStyle = '#fcc419'; g.beginPath(); g.moveTo(p.x - nx * w, p.y - ny * w); g.lineTo(p.x + nx * w, p.y + ny * w); g.stroke();
            g.lineDashOffset = 0.5; g.strokeStyle = '#212529'; g.stroke();
          }
          g.restore();
        }
      }
    }

    // 동굴 지붕 (남이 보면 바위, 안의 차는 안 보임). 내 차가 안에 있으면 대신 어둡게 + 전조등
    function drawRoofs(now, mineInside) {
      for (const b of branchesOf(T)) {
        if (!b.dark || !b.inner || mineInside === b) continue;
        const pts = b.pts.filter(p => p.s >= b.inner[0] && p.s <= b.inner[1]);
        if (pts.length < 2) continue;
        g.fillStyle = '#4a3f35'; band(pts, 1.4); g.fill();
        g.fillStyle = '#5c4f42'; band(pts, 0.4); g.fill();
        g.fillStyle = 'rgba(0,0,0,.18)';
        for (let k = 0; k < pts.length; k += 3) { const p = pts[k]; g.beginPath(); g.arc(p.x - p.ty * ((k * 7) % 5 - 2) * 0.6, p.y + p.tx * ((k * 7) % 5 - 2) * 0.6, 0.7, 0, TAU); g.fill(); }
      }
    }
    function insideDark(c) {
      if (!c || c.path === 'main') return null;
      const b = roadOf(T, c.path);
      return b?.dark && b.inner && c.s >= b.inner[0] - 1 && c.s <= b.inner[1] + 1 ? b : null;
    }

    function drawFeatures(now) {
      // 카트 맵 점프: 노란 경사로 → 틈(크레바스·공사 구덩이)
      for (const j of T.jumps || []) {
        const b = roadOf(T, j.path);
        if (!b) continue;
        const ramp = [];
        for (let s = j.gap0 - 4; s <= j.gap0; s += 0.5) ramp.push(pointAt(b, s));
        g.fillStyle = '#fab005';
        band(ramp, 0); g.fill();
        g.strokeStyle = '#e67700'; g.lineWidth = 0.12;
        for (const p of ramp) { g.beginPath(); g.moveTo(p.x + p.ty * p.half, p.y - p.tx * p.half); g.lineTo(p.x - p.ty * p.half, p.y + p.tx * p.half); g.stroke(); }
        const gap = [];
        for (let s = j.gap0; s <= j.gap1; s += 0.5) gap.push(pointAt(b, s));
        g.fillStyle = b.look === 'ice' ? '#0b1d2e' : '#1a120b';
        band(gap, 1.2); g.fill();
      }
      // 열린 맨홀: 빠지면 추락
      for (const h of T.holes || []) {
        g.fillStyle = '#868e96'; circle(h.x, h.y, h.r + 0.2);
        g.fillStyle = '#050607'; circle(h.x, h.y, h.r);
        g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 0.1;
        g.beginPath(); g.arc(h.x, h.y, h.r * 0.7, 0, TAU); g.stroke();
      }
      // 장애물: 골목은 쓰레기통, 동굴은 바위 (위에서 본 모습)
      for (const o of T.posts || []) {
        g.fillStyle = 'rgba(0,0,0,.3)'; circle(o.x + 0.2, o.y + 0.3, o.r);
        if (roadOf(T, o.path)?.look === 'cave') {
          g.fillStyle = '#7b6f63'; circle(o.x, o.y, o.r);
          g.fillStyle = '#9a8d7f'; circle(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.5);
        } else {
          g.fillStyle = '#2b8a3e'; circle(o.x, o.y, o.r);
          g.strokeStyle = '#1b5e2a'; g.lineWidth = 0.12; g.beginPath(); g.arc(o.x, o.y, o.r * 0.65, 0, TAU); g.stroke();
        }
      }
      // 파도: 덮치는 동안 하얀 물결, 덮치기 직전엔 거품 예고
      for (const w of T.waves || []) {
        const b = roadOf(T, w.path);
        if (!b) continue;
        const t = api.now();
        const ph = t % w.period;
        const on = ph < w.dur;
        const soon = ph > w.period - 900;
        if (!on && !soon) continue;
        const pts = [];
        for (let s = w.s0; s <= w.s1; s += 0.5) pts.push(pointAt(b, s));
        g.fillStyle = on ? 'rgba(165,216,255,.85)' : 'rgba(255,255,255,.35)';
        band(pts, on ? 0.8 : 0); g.fill();
        if (on) {
          g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 0.25;
          for (let k = 0; k < pts.length; k += 3) { const p = pts[k]; const o = Math.sin(now / 120 + k) * p.half; g.beginPath(); g.arc(p.x - p.ty * o, p.y + p.tx * o, 0.5, 0, TAU); g.stroke(); }
        }
      }
      // 부스트 발판: 노란 화살표
      for (const bo of T.boosts) {
        const road = roadOf(T, bo.path || 'main') || T.main;
        for (let k = 0; k < 3; k++) {
          const p = pointAt(road, bo.s + k * 1.1);
          g.fillStyle = (Math.floor(now / 150) + k) % 3 === 0 ? '#fff3bf' : '#fcc419';
          g.beginPath();
          g.moveTo(p.x + p.tx * 0.6, p.y + p.ty * 0.6);
          g.lineTo(p.x - p.tx * 0.4 - p.ty * 2.2, p.y - p.ty * 0.4 + p.tx * 2.2);
          g.lineTo(p.x - p.tx * 0.1, p.y - p.ty * 0.1);
          g.lineTo(p.x - p.tx * 0.4 + p.ty * 2.2, p.y - p.ty * 0.4 - p.tx * 2.2);
          g.closePath();
          g.fill();
        }
      }
      // 기름
      for (const o of T.oil) {
        g.fillStyle = 'rgba(33,37,41,.75)';
        g.beginPath();
        g.ellipse(o.x, o.y, o.r, o.r * 0.7, 0.5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(132,94,247,.35)';
        g.beginPath();
        g.ellipse(o.x - 0.4, o.y - 0.3, o.r * 0.4, o.r * 0.2, 0.5, 0, Math.PI * 2);
        g.fill();
      }
      // 결승선 체크무늬 (트랙 방향으로 돌려서)
      const f = pointAt(T.main, 0);
      const half = f.half;
      g.save();
      g.translate(f.x, f.y);
      g.rotate(Math.atan2(f.ty, f.tx));
      const n = Math.round((half * 2) / 0.7);
      for (let k = 0; k < n; k++) {
        for (let r = 0; r < 2; r++) {
          g.fillStyle = (k + r) % 2 ? '#212529' : '#ffffff';
          g.fillRect(-0.7 + r * 0.7, -half + k * (half * 2 / n), 0.7, half * 2 / n);
        }
      }
      g.restore();
    }

    // 머리 위: 크레인 보에 매달려 좌우로 흔들리는 쇳덩이 (차보다 위에 그린다)
    function drawOverhead(t) {
      for (const o of T.balls || []) {
        const b = ballAt(o, t);
        const reach = o.amp + 1.6;
        g.save();
        g.translate(o.x, o.y);
        g.rotate(Math.atan2(o.ny, o.nx));
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(-reach + 0.5, 0.25, reach * 2, 0.9);
        g.fillStyle = '#f59f00'; g.fillRect(-reach, -0.45, reach * 2, 0.9);
        g.strokeStyle = '#a35f00'; g.lineWidth = 0.1;
        g.beginPath();
        for (let x = -reach; x < reach - 0.1; x += 0.9) {
          g.moveTo(x, -0.45);
          g.lineTo(x + 0.9, 0.45);
        }
        g.stroke();
        g.restore();
        g.fillStyle = 'rgba(0,0,0,.3)'; oval(b.x + 0.6, b.y + 0.9, o.r, o.r * 0.8);
        g.strokeStyle = '#343a40'; g.lineWidth = 0.14;
        g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(b.x, b.y); g.stroke();
        const shine = g.createRadialGradient(b.x - o.r * 0.35, b.y - o.r * 0.35, o.r * 0.1, b.x, b.y, o.r);
        shine.addColorStop(0, '#ced4da');
        shine.addColorStop(0.45, '#495057');
        shine.addColorStop(1, '#16191c');
        g.fillStyle = shine; circle(b.x, b.y, o.r);
      }
    }

    function drawGates(t) {
      for (const gt of T.gates) {
        const a = gateAngle(gt, t);
        g.save();
        g.translate(gt.x, gt.y);
        g.rotate(a);
        g.fillStyle = '#e03131';
        g.fillRect(-gt.len, -0.22, gt.len * 2, 0.44);
        g.fillStyle = '#ffffff';
        for (let k = -gt.len; k < gt.len; k += 1.2) g.fillRect(k, -0.22, 0.6, 0.44);
        g.restore();
        g.fillStyle = '#343a40';
        g.beginPath();
        g.arc(gt.x, gt.y, 0.5, 0, Math.PI * 2);
        g.fill();
      }
    }

    // 꼬리가 빠져 미끄러지는 동안 뒷바퀴 두 개가 얼음에 긁힌 자국을 남긴다 (3초 동안 옅어짐)
    function addSkid(id, c, layer, now) {
      if (!c.dr || c.air || c.sp) {
        skidAt.delete(id);
        return;
      }
      const a = heading(c);
      const hx = Math.cos(a);
      const hy = Math.sin(a);
      const rx = c.x - hx * 0.55;
      const ry = c.y - hy * 0.55;
      const w = [[rx - hy * 0.45, ry + hx * 0.45], [rx + hy * 0.45, ry - hx * 0.45]];
      const prev = skidAt.get(id);
      if (prev && Math.hypot(w[0][0] - prev[0][0], w[0][1] - prev[0][1]) < 0.35) return;
      if (prev && Math.hypot(w[0][0] - prev[0][0], w[0][1] - prev[0][1]) < 2) {
        for (let k = 0; k < 2; k++) skids.push({ x0: prev[k][0], y0: prev[k][1], x1: w[k][0], y1: w[k][1], layer, t: now });
        while (skids.length > 900) skids.shift();
      }
      skidAt.set(id, w);
    }

    function drawSkids(layer, now) {
      while (skids.length && now - skids[0].t > 3000) skids.shift();
      g.lineWidth = 0.22;
      g.lineCap = 'round';
      for (const k of skids) {
        if (k.layer !== layer) continue;
        g.strokeStyle = `rgba(116,143,173,${(0.5 * (1 - (now - k.t) / 3000)).toFixed(3)})`;
        g.beginPath();
        g.moveTo(k.x0, k.y0);
        g.lineTo(k.x1, k.y1);
        g.stroke();
      }
    }

    function drawCar(p, c, ghost, z) {
      if (c.sp) return;
      const air = c.air ? 1.3 : 1;
      if (c.air) {
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.beginPath();
        g.arc(c.x + 0.8, c.y + 1.2, CAR_R, 0, Math.PI * 2);
        g.fill();
      }
      g.save();
      g.globalAlpha = 1;
      g.translate(c.x, c.y);
      g.scale(air * 1.2, air * 1.2);
      g.rotate(heading(c));
      const color = p.color || '#4dabf7';
      const charge = ghost ? c.charge || 0 : car.charge || 0;
      const boosting = ghost ? c.boost : car.boostLeft > 0;
      const rect = (x, y, w, h, r, fill) => {
        g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
      };
      // Four exposed tires, chassis, front bumper and rear engine: a kart silhouette.
      rect(-1.08, -0.66, 2.2, 1.4, 0.35, 'rgba(0,0,0,.25)');
      rect(-0.75, -0.58, 1.4, 1.16, 0.12, '#202a36');
      for (const x of [-0.72, 0.65]) for (const y of [-0.69, 0.69]) {
        g.save(); g.translate(x, y);
        if (x > 0) g.rotate(c.steer || 0);
        rect(-0.32, -0.19, 0.64, 0.38, 0.09, '#141b24');
        rect(-0.17, -0.13, 0.09, 0.26, 0.02, '#566474');
        g.restore();
      }
      rect(-0.65, -0.43, 1.65, 0.86, 0.22, color);
      rect(0.88, -0.67, 0.3, 1.34, 0.1, color);
      rect(0.94, -0.49, 0.12, 0.98, 0.03, '#f8f9fa');
      rect(-1.02, -0.38, 0.38, 0.76, 0.07, '#2c3544');
      for (let j = 0; j < 3; j++) rect(-0.96 + j * 0.1, -0.3, 0.035, 0.6, 0.01, '#8995a3');
      rect(-0.48, -0.32, 0.64, 0.64, 0.18, '#19222e');
      // Helmet and visor, with a steering wheel in front of the driver.
      g.fillStyle = '#fff4dc'; g.beginPath(); g.arc(-0.12, 0, 0.29, 0, TAU); g.fill();
      rect(-0.02, -0.23, 0.16, 0.46, 0.06, '#263a52');
      g.strokeStyle = '#18202b'; g.lineWidth = 0.08;
      g.beginPath(); g.arc(0.34, 0, 0.17, 0, TAU); g.stroke();
      rect(0.48, -0.2, 0.29, 0.4, 0.04, '#ffffff');
      g.fillStyle = '#172331'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold .28px system-ui';
      g.fillText(String((S?.roster.findIndex(v => v.id === p.id) ?? 0) + 1), 0.63, 0);
      if (boosting) {
        g.fillStyle = '#ff922b'; g.beginPath(); g.moveTo(-1, -0.25); g.lineTo(-2.3 - Math.random() * 0.7, 0); g.lineTo(-1, 0.25); g.fill();
        g.fillStyle = '#fff3bf'; g.beginPath(); g.moveTo(-1, -0.12); g.lineTo(-1.9, 0); g.lineTo(-1, 0.12); g.fill();
      }
      if (charge >= 0.45) {
        g.fillStyle = charge >= 1.15 ? '#ff922b' : '#4ddcff';
        for (const y of [-0.75, 0.75]) {
          g.beginPath(); g.arc(-0.85 - Math.random() * 0.15, y, 0.14 + Math.random() * 0.1, 0, TAU); g.fill();
        }
      }
      g.restore();
      // 이름표 (화면 크기 그대로)
      if (ghost) {
        g.save();
        g.translate(c.x, c.y - 1.5);
        g.scale(1 / z, 1 / z);
        g.font = '800 12px system-ui, sans-serif';
        g.textAlign = 'center';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(255,255,255,.9)';
        g.strokeText(p.name, 0, 0);
        g.fillStyle = '#212529';
        g.fillText(p.name, 0, 0);
        g.restore();
      }
    }

    function draw(now) {
      drawnAt = now;
      const dpr = Number(canvas.dataset.dpr) || 1;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      if (!W || !H) return;
      const t = api.now();
      // 카메라: 내 차(완주했으면 아직 달리는 1등)를 따라가고, 빠를수록 앞을 더 보여 주며 살짝 멀어진다
      let focus = car;
      if (S && (mine()?.fin || !mine())) {
        const id = (S.order || []).find(x => !S.cars[x].fin) || S.order?.[0];
        focus = (id && id !== me ? ghostAt(id, t) : null) || car;
      }
      // 속도는 충돌·드리프트·방장 보정으로 프레임마다 조금씩 출렁인다. 날것으로 줌을 정하면 매 프레임 미세하게
      // 확대·축소돼 가는 선·점선이 지지직거린다 → 걸러진 속도로, 줌은 단계(1px/m 넘게 달라질 때만)로 바꾸고
      // 부드럽게 다가간 뒤 딱 멈춘다. 모든 따라가기는 프레임 간격과 상관없이 같은 빠르기.
      const fdt = cam.at == null ? 0 : Math.min(0.1, Math.max(0, (now - cam.at) / 1000));
      cam.at = now;
      const ease = tau => 1 - Math.exp(-fdt / tau);
      cam.vx += ((focus.vx || 0) - cam.vx) * ease(0.35);
      cam.vy += ((focus.vy || 0) - cam.vy) * ease(0.35);
      const sp = Math.hypot(cam.vx, cam.vy);
      const wantZ = Math.max(11.5, 21 - sp * 0.35) * Math.min(1, Math.max(0.6, Math.min(W, H) / 520));
      if (Math.abs(wantZ - cam.goal) > 1) cam.goal = wantZ;
      cam.z += (cam.goal - cam.z) * ease(0.3);
      if (Math.abs(cam.goal - cam.z) < 0.03) cam.z = cam.goal;
      cam.x += (focus.x + cam.vx * 0.5 - cam.x) * ease(0.13);
      cam.y += (focus.y + cam.vy * 0.5 - cam.y) * ease(0.13);
      cam.shake = cam.shake > 0.01 ? cam.shake * Math.exp(-fdt / 0.13) : 0;
      const sx = (Math.random() - 0.5) * cam.shake;
      const sy = (Math.random() - 0.5) * cam.shake;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = themeOf().bg;
      g.fillRect(0, 0, W, H);
      // 화면 픽셀에 맞춰 옮긴다 (선이 픽셀 사이를 미끄러지며 번쩍이지 않게). 화면 = (ox, oy) + 세상 좌표 × 줌
      const ox = Math.round((W / 2 + (sx - cam.x) * cam.z) * dpr) / dpr;
      const oy = Math.round((H / 2 + (sy - cam.y) * cam.z) * dpr) / dpr;
      g.translate(ox, oy);
      g.scale(cam.z, cam.z);
      // 물결 (예전 와이드 8자)
      const vx0 = -ox / cam.z;
      const vy0 = -oy / cam.z;
      if (themeOf().ripple) {
        g.fillStyle = COLORS.waterHi;
        for (let x = Math.floor(vx0 / 6) * 6; x < vx0 + W / cam.z + 6; x += 6) {
          for (let y = Math.floor(vy0 / 5) * 5; y < vy0 + H / cam.z + 5; y += 5) g.fillRect(x + ((y / 5) % 2) * 3, y, 1.4, 0.18);
        }
      }
      const view = { x0: vx0, y0: vy0, x1: vx0 + W / cam.z, y1: vy0 + H / cam.z };
      if (T.kart) drawGround(view, now);
      drawDeco(view);
      // 차: 아래층 → 고가 다리 → 위층. 내 차는 맨 위
      const list = [];
      for (const p of S?.roster || []) {
        if (p.id === me) continue;
        const c = ghostAt(p.id, t);
        if (c) list.push([p, c, T.main.pts[c.seg]?.layer && c.path === 'main' ? 1 : 0]);
      }
      const myLayer = car.path === 'main' && T.main.pts[car.seg]?.layer ? 1 : 0;
      for (const [p, c, layer] of list) addSkid(p.id, c, layer, now);
      if (mine()) addSkid(me, car, myLayer, now);
      drawTrackLayer(0);
      drawFeatures(now);
      drawSkids(0, now);
      drawGates(t);
      for (const [p, c, layer] of list) if (!layer) drawCar(p, c, true, cam.z);
      if (!myLayer && mine()) drawCar(who(me), car, false, cam.z);
      const darkMine = mine() ? insideDark(car) : null;
      drawOverhead(t);
      drawRoofs(now, darkMine);
      drawCovers(now);
      drawTrackLayer(1);
      drawSkids(1, now);
      for (const [p, c, layer] of list) if (layer) drawCar(p, c, true, cam.z);
      if (myLayer && mine()) drawCar(who(me), car, false, cam.z);
      // 동굴 안: 화면이 어둡고 내 전조등 둘레만 보인다
      if (darkMine) {
        g.save();
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cx = ox + car.x * cam.z;
        const cy = oy + car.y * cam.z;
        const lx = cx + car.hx * cam.z * 3.5;
        const ly = cy + car.hy * cam.z * 3.5;
        const glow = g.createRadialGradient(lx, ly, cam.z * 1.5, lx, ly, cam.z * 7);
        glow.addColorStop(0, 'rgba(0,0,0,0)');
        glow.addColorStop(1, 'rgba(5,5,10,.93)');
        g.fillStyle = glow;
        g.fillRect(0, 0, W, H);
        g.restore();
      }
      // 속도선
      const mySp = Math.hypot(car.vx, car.vy);
      if (mySp > 15 && !car.sp && mine()) {
        g.strokeStyle = `rgba(255,255,255,${Math.min(0.6, (mySp - 15) / 14)})`;
        g.lineWidth = 0.12;
        for (let k = 0; k < 6; k++) {
          const off = (k - 2.5) * 0.35;
          const len = 1.5 + Math.random() * 2;
          const bx = car.x - (car.vx / mySp) * (1 + Math.random()) - (car.vy / mySp) * off;
          const by = car.y - (car.vy / mySp) * (1 + Math.random()) + (car.vx / mySp) * off;
          g.beginPath();
          g.moveTo(bx, by);
          g.lineTo(bx - (car.vx / mySp) * len, by - (car.vy / mySp) * len);
          g.stroke();
        }
      }
      // 알갱이·풍덩
      const dt = 1 / 60;
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.life -= dt;
        if (q.life <= 0) {
          parts.splice(i, 1);
          continue;
        }
        g.fillStyle = q.c;
        g.globalAlpha = Math.min(1, q.life * 2);
        g.fillRect(q.x - 0.12, q.y - 0.12, 0.24, 0.24);
      }
      g.globalAlpha = 1;
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        const k = (now - s.t) / 900;
        if (k > 1) {
          splashes.splice(i, 1);
          continue;
        }
        g.strokeStyle = `rgba(255,255,255,${1 - k})`;
        g.lineWidth = 0.25;
        for (const r of [k * 3, k * 2]) {
          g.beginPath();
          g.arc(s.x, s.y, 0.4 + r, 0, Math.PI * 2);
          g.stroke();
        }
      }
      // 가장자리를 살짝 어둡게 (카트 맵)
      if (T.kart) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,.22)');
        g.fillStyle = vg;
        g.fillRect(0, 0, W, H);
      }
      drawMini();
      driveHud.hidden = !racing();
      gasKey.classList.toggle('active', keys.u && !keys.d);
      brakeKey.classList.toggle('active', keys.d);
      wheel.style.transform = `rotate(${(car.steer || 0) * 180 / Math.PI * 8}deg)`;
      const signedSpeed = car.vx * car.hx + car.vy * car.hy;
      gear.textContent = signedSpeed < -.5 ? 'R' : signedSpeed > .5 || keys.u && !keys.d ? 'D' : 'N';
      gear.classList.toggle('reverse', signedSpeed < -.5);
    }

    // 미니맵: 트랙 전체와 모두의 위치
    function drawMini() {
      const w = mini.width;
      const hgt = mini.height;
      const k = Math.min(w / (BOUNDS.x1 - BOUNDS.x0), hgt / (BOUNDS.y1 - BOUNDS.y0));
      const ox = (w - (BOUNDS.x1 - BOUNDS.x0) * k) / 2 - BOUNDS.x0 * k;
      const oy = (hgt - (BOUNDS.y1 - BOUNDS.y0) * k) / 2 - BOUNDS.y0 * k;
      mg.setTransform(1, 0, 0, 1, 0, 0);
      mg.clearRect(0, 0, w, hgt);
      mg.setTransform(k, 0, 0, k, ox, oy);
      mg.lineJoin = 'round';
      mg.strokeStyle = 'rgba(232,244,253,.95)';
      mg.lineWidth = 10;
      mg.beginPath();
      T.main.pts.forEach((p, i) => (i ? mg.lineTo(p.x, p.y) : mg.moveTo(p.x, p.y)));
      mg.closePath();
      mg.stroke();
      mg.lineWidth = 6;
      for (const b of branchesOf(T)) {
        if (b.hidden) continue;
        mg.strokeStyle = 'rgba(232,244,253,.7)';
        mg.beginPath();
        b.pts.forEach((p, i) => (i ? mg.lineTo(p.x, p.y) : mg.moveTo(p.x, p.y)));
        mg.stroke();
      }
      const t = api.now();
      for (const p of S?.roster || []) {
        const c = p.id === me ? car : ghostAt(p.id, t);
        if (!c) continue;
        // 숨은 지름길 위의 남의 차는 미니맵에도 안 보인다
        if (p.id !== me && c.path !== 'main' && roadOf(T, c.path)?.hidden) continue;
        mg.fillStyle = p.color || '#adb5bd';
        mg.strokeStyle = p.id === me ? '#ffd43b' : '#212529';
        mg.lineWidth = p.id === me ? 2.5 : 1.2;
        mg.beginPath();
        mg.arc(c.x, c.y, p.id === me ? 4 : 3, 0, Math.PI * 2);
        mg.fill();
        mg.stroke();
      }
      mg.setTransform(1, 0, 0, 1, 0, 0);
    }

    // 물리·위치 보내기는 그리기와 따로 (브라우저가 그리기를 늦추거나 멈춰도 차는 정확하게)
    const ticker = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(100, now - last);
      last = now;
      if (!S) return;
      if (racing() && mine()) {
        drive(dt);
        sendDrive(now);
      } else if (S.phase === 'ready' && mine()) {
        // 신호 기다리는 동안에도 누르고 있는 키를 방장에게 계속 알려서, 초록불 순간 방장 쪽 차도 바로 출발
        sendDrive(now);
      }
      lights();
      edgeRumble(now);
      renderTop();
      // 화면이 보이는데 그리기가 멈춰 있으면(가려진 창 등) 여기서라도 그린다
      if (!document.hidden && now - drawnAt > 200) draw(now);
    }, 16);

    function loop(now) {
      raf = requestAnimationFrame(loop);
      draw(now);
    }
    raf = requestAnimationFrame(loop);

    // 벽 없는 길 가장자리에 다가가면 드르륵 (화면이 살짝 떨리고 낮은 소리): 떨어지기 전에 알아채게
    function edgeRumble(now) {
      if (!racing() || !mine() || mine().fin || car.sp || car.air) return;
      const road = car.path === 'main' ? T.main : roadOf(T, car.path);
      const p = road?.pts[car.seg];
      if (!p?.fall || roadWallOpen(T, car.path, p, Math.sign(car.lat || 0))) return;
      const room = p.half + 0.3 - Math.abs(car.lat || 0);   // 떨어지기까지 남은 거리
      const warn = Math.min(1.2, (p.half + 0.3) * 0.4);
      if (room > warn || Math.hypot(car.vx, car.vy) < 3) return;
      cam.shake = Math.max(cam.shake, 0.12 + (warn - room) * 0.15);
      if (now - rumbleAt > 130) {
        rumbleAt = now;
        audio.rumble();
      }
    }

    // 신호등: 빨강 1초 → 주황 1초 → 초록 = 출발 (초록은 출발 뒤 잠깐 더 켜 둠)
    const lampsOn = () => S.phase === 'ready' || (S.phase === 'race' && api.now() - S.startAt < 900);
    function lights() {
      const t = api.now();
      const n = lampsOn() ? Math.min(2, Math.floor((t - (S.startAt - READY)) / LIGHT)) : -1;
      overlay.querySelectorAll('.lamp').forEach((el, i) => el.classList.toggle('on', i === n));
      if (n === litLamp) return;
      litLamp = n;
      if (n >= 0) audio.ready();
      if (n === 2) flash('출발!');
    }

    function renderTop() {
      const c = mine();
      const order = S.order || S.roster.map(p => p.id);
      const pos = order.indexOf(me) + 1;
      const key = JSON.stringify([S.round, S.points?.[me], Math.floor((car.charge || 0) * 10), car.boostLeft > 0, S.phase, c?.lap, c?.fin, pos, c?.split, Math.floor((api.now() - (S.startAt || 0)) / 100)]);
      if (key === topKey) return;
      topKey = key;
      const time = c?.fin ?? (S.phase === 'race' ? Math.max(0, api.now() - S.startAt) : 0);
      top.replaceChildren(...[
        h('span', { class: 'rc-lap' }, c?.fin ? '🏁 완주!' : S.phase === 'final' ? '미완주' : `ROUND ${S.round}/3 · ${Math.min(laps(), (c?.lap || 0) + 1)}/${laps()}바퀴`),
        S.phase === 'final' && !c?.fin ? null : h('span', { class: 'rc-time' }, fmt(time)),
        c ? h('span', {}, `${pos}등 / ${S.roster.length}명`) : null,
        c?.split != null && !c.fin ? h('span', { class: c.split > 0 ? 'rc-behind' : 'rc-ahead' }, c.split > 0 ? `선두와 +${c.split}초` : '구간 선두!') : null,
        h('span', { class: 'muted' }, `합계 ${S.points?.[me] || 0}점 · ${car.vx * car.hx + car.vy * car.hy < -.5 ? 'R ' : ''}${Math.round(Math.hypot(car.vx, car.vy) * 3.6)} km/h`),
        car.path !== 'main' && !c?.fin ? h('span', { class: 'rc-ahead' }, roadOf(T, car.path)?.hidden ? `🤫 ${roadOf(T, car.path).name}!` : `↗ ${roadOf(T, car.path)?.name || '갈림길'}`) : null,
        h('span', { class: 'rc-hot' }, car.boostLeft > 0 ? '🔥 부스트!' : (car.charge || 0) >= 1.15 ? '🟠 놓으면 강력 부스트!' : (car.charge || 0) >= .45 ? '🔵 놓으면 부스트!' : `Shift / Space 드리프트 ${Math.round((car.charge || 0) / 1.5 * 100)}%`),
        S.finishBy && S.phase === 'race' ? h('span', { class: 'rc-hot' }, `⏱ ${Math.max(0, Math.ceil((S.finishBy - api.now()) / 1000))}초 안에 결승선!`) : null,
      ].filter(Boolean));
    }

    function renderOverlay() {
      const key = `${S.round}:${S.phase}:${!!mine()?.fin}:${trackSpec}:${lampsOn()}`;
      if (key === overlayKey) return;
      overlayKey = key;
      overlay.replaceChildren();
      if (S.phase === 'intro') {
        overlay.append(h('div', { class: 'rc-card' },
          h('h2', {}, `🏎️ 카트 그랑프리 · ${mapName(specOf(S))}`),
          h('p', {}, `이번 판 맵: ${(S.maps || []).map(mapName).join(' → ')}`),
          S.again ? null : h('ul', { class: 'rules big' },
            h('li', {}, '맵 3개를 두 바퀴씩, 3경기 합산 점수로 승부! 맵은 판마다 바뀌어요'),
            h('li', {}, '갈래길은 장단점이 있는 선택지 · 미니맵에 없는 숨은 지름길도 있어요 🤫 (좁고 위험!)'),
            h('li', {}, 'W / ↑ = 가속 · S / ↓ = 제동 후 후진 · A D / ← → = 핸들'),
            h('li', {}, '좌우는 짧게 눌러 미세 조정 · 떼면 바로 직진으로 안정돼요'),
            h('li', {}, '코너에서 Shift / Space 꾹 = 드리프트 · 놓으면 부스트!'),
            h('li', {}, '파란 불꽃은 짧게, 주황 불꽃은 길게 가속!'),
            h('li', {}, '길에 벽이 없어요! 밖으로 나가면 추락 → 조금 뒤에서 다시 출발'),
            h('li', {}, '초록불이 켜지는 순간 출발! 가속 키를 미리 눌러 둬도 돼요'))));
      }
      if (lampsOn()) {
        overlay.append(h('div', { class: 'tc-light rc-light' }, h('i', { class: 'lamp red' }), h('i', { class: 'lamp amber' }), h('i', { class: 'lamp green' })));
      }
      if (S.phase === 'intermission') {
        const result = S.roundResults?.at(-1);
        overlay.append(h('div', { class: 'rc-card' },
          h('h2', {}, `ROUND ${S.round} 종료 · 5초 후 다음 맵!`),
          h('p', {}, `다음: ${mapName(S.maps?.[S.round] || 'wide')} · 3경기 합산 승부`),
          h('ol', { class: 'podium' }, (S.totalOrder || []).map((id, i) => h('li', {},
            h('span', {}, `${i + 1}위`), nameTag(who(id), me), h('b', {}, `${S.points[id]}점 (+${result?.earned?.[id] || 0})`))))));
      }
      if (S.phase === 'final') {
        // 점수 대신 기록 (등수 계산용 standings는 큰 숫자라 보여 주지 않는다)
        const rows = (S.order || []).map((id, i) => h('li', { class: `r${i + 1}${id === me ? ' me' : ''}` },
          h('span', { class: 'medal' }, ['🥇', '🥈', '🥉'][i] || i + 1),
          nameTag(who(id), me),
          h('b', {}, `${S.points[id]}점`)));
        overlay.append(h('div', { class: 'rc-card' }, h('h2', {}, `🏁 ${who(S.order?.[0]).name} 우승!`), h('ol', { class: 'podium' }, rows)));
      }
    }

    function renderSide() {
      const order = S.order || S.roster.map(p => p.id);
      const key = JSON.stringify([trackSpec, order.map(id => {
        const c = S.cars[id];
        return [id, S.round, S.points?.[id], c.lap, c.cp, c.fin, c.spl];
      })]);
      if (key === sideKey) return;
      sideKey = key;
      side.replaceChildren(
        h('h3', {}, `ROUND ${S.round}/3 · 실시간 순위`),
        h('ol', { class: 'tw-bag rc-rank' }, order.map(id => {
          const c = S.cars[id];
          const p = who(id);
          return h('li', { class: id === me ? 'now' : '' }, avatar(p), h('span', {}, p.name),
            h('em', {}, c.fin ? `🏁 ${fmt(c.fin)}` : `${S.points?.[id] || 0}점 · ${sectionNames()[c.cp] || ''}`));
        })),
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, 'W / ↑ = 앞으로 가속 · S / ↓ 꾹 = 멈춘 뒤 후진'),
          h('li', {}, 'A D / ← → = 핸들. 짧게 눌러 미세 조정, 떼면 바로 안정'),
          h('li', {}, '일반 커브는 속도 유지 · 드리프트는 크게 미끄러져요'),
          h('li', {}, 'Shift / Space 꾹 = 드리프트, 놓으면 모은 만큼 부스트'),
          h('li', {}, '🔵 짧은 부스트 → 🟠 강력 부스트. 직선에서는 충전되지 않아요'),
          h('li', {}, '오른쪽 위 미니맵 = 트랙 전체')),
        h('h3', {}, '갈래길과 숨은 길'),
        h('ul', { class: 'rules' },
          h('li', {}, '헤어핀·직각 코너는 드리프트 → 놓아서 부스트'),
          h('li', {}, '길 밖으로 나가면 추락! 밀치기도 조심'),
          h('li', {}, '보이는 갈래길은 짧지만 느리거나 미끄러워요 (부스트 발판도)'),
          h('li', {}, '🤫 미니맵에 없는 길도 있어요. 좁고 위험해서 실패하면 손해!')),
        h('h3', {}, `${mapName(specOf(S))} · ROUND ${S.round}/3`),
        h('ul', { class: 'rules' }, sectionNames().map((name, i) => h('li', {}, `${i + 1}. ${name}`))));
    }

    return {
      update({ state }) {
        const prevRound = lastRound;
        S = state;
        useTrack(specOf(S));
        if (predTrack !== T) {
          prediction.clear();
          prediction = createRacePrediction(T, me);
          predTrack = T;
        }
        if (prevRound !== S.round) {
          lastRound = S.round;
          Object.assign(car, newCar(T), { charge: 0, boostLeft: 0, driftHeld: false });
          resetControls(false); prediction.clear(); parts.length = 0; skids.length = 0; skidAt.clear();
          seenFin = false; seenLap = 0;
          inputSeq = mine()?.seq || 0; seenFx = 0;
          acc = 0; sentAt = 0; wasDrift = 0; litLamp = -1;
          topKey = sideKey = overlayKey = '';
          Object.assign(cam, { x: car.x, y: car.y, vx: 0, vy: 0 });
        }
        const synced = prediction.sync(S, api.now());
        car = prediction.car(me) || car;
        if (synced) acc = 0;
        const c = mine();
        if (c) inputSeq = Math.max(inputSeq, c.seq || 0);
        for (const fx of S.fx || []) {
          if (fx.n <= seenFx) continue;
          seenFx = fx.n;
          if (api.now() - fx.at > 800) continue;
          for (let i = 0; i < 12; i++) parts.push({ x: fx.x, y: fx.y, vx: (Math.random() - .5) * 12, vy: (Math.random() - .5) * 12, life: .35, c: i % 2 ? '#fff3bf' : '#ff922b' });
          if (fx.a === me || fx.b === me) {
            cam.shake = Math.min(.7, fx.strength / 35);
            audio.impact(fx.strength > 14, true);
            if (fx.strength > 6 && api.now() - impactFlashAt > 600) {
              impactFlashAt = api.now(); flash('💥 카트 충돌!');
            }
          }
        }
        // 첫 바퀴를 돌면 마지막 바퀴 알림
        if (c && !c.fin && (c.lap || 0) > seenLap) {
          seenLap = c.lap;
          if (c.lap === laps() - 1) flash('🏁 마지막 바퀴!');
        }
        if (c?.fin && !seenFin) {
          seenFin = true;
          const pos = (S.order || []).indexOf(me) + 1;
          flash(`🏁 완주! ${pos}등 · ${fmt(c.fin)}`);
          audio.duel();
        }
        audio.mode(S.phase === 'race', !!S.finishBy);
        renderTop();
        renderOverlay();
        renderSide();
      },
      unmount() {
        resetControls();
        prediction.clear();
        cancelAnimationFrame(raf);
        clearInterval(ticker);
        ro.disconnect();
        audio.dispose();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('focusin', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
      },
    };
  },
};

