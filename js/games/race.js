// 카트 그랑프리: 난간 있는 차고 8자 한 바퀴씩, 3경기 합산 점수.
// 방장이 모든 카트의 이동·충돌을 함께 계산한다. 내 화면은 입력을 즉시 예측하고 방장 상태로 보정한다.
// SPACE 드리프트를 놓으면 충전에 비례한 부스트. 같은 층의 카트끼리 부딪혀 밀려난다.
import { h, isTyping, AGAIN_INTRO } from '../util.js';
import { avatar, nameTag } from '../ui.js';
import { createRacePrediction } from './race-prediction.js';
import { createBumperAudio } from './bumper-audio.js';
import { buildTrack, newCar, stepCar, locate, botInput, gateAngle, pointAt, LAPS, CAR_R, SECTIONS, KART, resolveKartContacts } from './race-core.js';

const T = buildTrack(true);
const L = T.main.len;
const CPS = SECTIONS.length - 1;  // 체크포인트 = 구간 시작 (출발 직선 빼고). 다 지나고 결승선을 넘으면 한 바퀴
const INTRO = 4500;
const LIGHT = 1000;               // 신호등 한 칸
const READY = LIGHT * 3;          // 빨강 → 주황 → 초록(= 출발)
const FINISH_WAIT = 8000;        // 첫 완주 뒤 이 안에 들어와야 완주
const MAX_RACE = 45000;
const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
const TRACK_NAMES = ["출발 직선", "첫 번째 코너", "헤어핀", "S자 코너", "고가 직선", "롱 코너", "마지막 코너", "결승 직선"];
const FALSE_START = 1000;         // 부정출발 벌칙
const SEND_EVERY = 100;
const STEP = 1 / 60;
const INPUT_LEASE = 600;
const r2 = v => Math.round(v * 100) / 100;
const fmt = ms => (ms == null ? '-' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`);

/* ───────── 심판 (방장) ───────── */

function gridCars(roster) {
  const start = pointAt(T.main, T.start);
  const spacing = Math.min(2.2, (start.half - KART.radius - 0.1) * 2 / Math.max(1, roster.length - 1));
  return Object.fromEntries(roster.map((p, i) => {
    const car = newCar(T);
    const lat = (i - (roster.length - 1) / 2) * spacing;
    car.x -= start.ty * lat; car.y += start.tx * lat; car.lat = lat;
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
      const s = T.secStart[c.cp + 1];
      if (c.ms < s && ms >= s) {
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
      if (c.lap >= LAPS) {
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
  if (S.phase === 'ready' && now < S.startAt && data.throttle > 0 && !data.brake) c.lockUntil = S.startAt + FALSE_START;
  return true;
}

// Shared host world: all drivers move once, then contacts resolve in the same 60Hz step.
function stepWorld(ctx, now) {
  const S = ctx.state;
  const end = Math.min(now, S.startAt + MAX_RACE, S.finishBy || Infinity);
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
        if (!driver) ctx.drivers.set(p.id, driver = { mem: { short: false }, skill: .88 + Math.random() * .1 });
        input = botInput(T, c, driver.mem, driver.skill);
      } else if (ctx.isOnline(p.id) && at - c.inputAt <= INPUT_LEASE && at >= (c.lockUntil || 0)) {
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
const RUNS = (() => {
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
})();
const BOUNDS = (() => {
  const xs = T.main.pts.map(p => p.x);
  const ys = T.main.pts.map(p => p.y);
  return { x0: Math.min(...xs) - 8, x1: Math.max(...xs) + 8, y0: Math.min(...ys) - 8, y1: Math.max(...ys) + 8 };
})();
const TAU = Math.PI * 2;
// 몸통 방향 (라디안): 내 차는 hx·hy, 남의 차는 받은 h
const heading = c => (c.hx !== undefined ? Math.atan2(c.hy, c.hx) : Number.isFinite(c.h) ? c.h : Math.atan2(c.vy || 0, c.vx || 1));
const COLORS = { water: '#344552', waterHi: '#425563', edge: '#202a36', ice: '#657382', snow: '#657382', wall: '#ffcf67', bridge: '#7b8998', rail: '#f8f9fa' };

export default {
  id: 'race',
  title: '카트 그랑프리',
  emoji: '🏁',
  tag: '액션',
  color: '#1c7ed6',
  desc: '짧게 3번 달리는 카트 레이스! 스페이스로 드리프트, 놓으면 부스트. 3경기 합산 점수로 우승!',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: 50,

  setup(ctx, prev) {
    const now = ctx.now();
    return {
      phase: 'intro', round: 1, points: Object.fromEntries(ctx.roster.map(p => [p.id, 0])), roundResults: [],
      introUntil: now + (prev ? AGAIN_INTRO : INTRO),
      again: !!prev,
      cars: gridCars(ctx.roster), fx: [], fxNo: 0,
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    if (type !== 'drive') return false;
    return onDrive(ctx, pid, data, ctx.now());
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intermission') {
      if (now < S.nextAt) return false;
      S.round++;
      S.cars = gridCars(S.roster); S.fx = []; S.fxNo = 0;
      S.firsts = {}; S.finishBy = null; S.order = S.roster.map(p => p.id);
      S.phase = 'ready'; S.startAt = now + READY;
      ctx.drivers = new Map(); S.worldAt = S.startAt;
      return true;
    }
    if (S.phase === 'intro') {
      if (now < S.introUntil) return false;
      Object.assign(S, { phase: 'ready', startAt: now + READY });
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
    if (all || (S.finishBy && now >= S.finishBy) || now - S.startAt >= MAX_RACE) return finish(ctx);
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
    const prediction = createRacePrediction(T, me);
    let seenFx = 0;
    let impactFlashAt = 0;
    let falseStart = false;
    let lockUntil = 0;
    let started = false;
    let cam = { x: 0, y: 0, z: 18, shake: 0 };
    let topKey = '';
    let sideKey = '';
    let overlayKey = '';
    let seenFin = false;
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
    const racing = () => S?.phase === 'race';

    const KEY = { Space: 'drift', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };
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
      // 초록불 전에 누르면 부정출발
      if (S?.phase === 'ready' && keys.u && !keys.d && !falseStart) {
        falseStart = true;
        flash('🚫 부정출발! 1초 늦게 출발', 'bad');
      }
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
        flash('🌊 풍덩!', 'bad');
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
      g.fillStyle = layer ? '#6c757d' : COLORS.edge;
      for (const run of runs) {
        band(run.pts, layer ? 0.6 : 0.4);
        g.fill();
      }
      for (const run of runs) {
        const sec = SECTIONS[run.sec];
        g.fillStyle = layer ? COLORS.bridge : COLORS.ice;
        band(run.pts, 0);
        g.fill();
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
      }
      // 벽: 타이어 색상의 보호 난간

      for (const run of RUNS) {
        if (run.layer !== layer) continue;
        const sec = SECTIONS[run.sec];
        const walls = 'both';
        if (!walls) continue;
        g.strokeStyle = layer ? COLORS.rail : COLORS.wall;
        g.lineWidth = layer ? 0.35 : 0.7;
        for (const side of [1, -1]) {
          const pts = run.pts.filter(p => walls === 'both' || p.outer === side);
          if (pts.length < 2) continue;
          poly(edgeLine(pts, side, layer ? 0.1 : 0.35));
          g.stroke();
          if (!layer) {
            g.setLineDash([1.1, 1.1]); g.strokeStyle = '#e86656'; g.lineWidth = .48; g.stroke();
            g.setLineDash([]); g.strokeStyle = COLORS.wall; g.lineWidth = .7;
          }
        }
      }
    }

    function drawFeatures(now) {
      // 지름길: 좁은 나무 다리 (양옆 물, 옆바람). 양 끝은 깔때기처럼 넓다 (물리와 같은 폭)
      if (!T.sprint) {
      const b = T.branch.pts;
      g.fillStyle = '#8b5a2b';
      band(b, 0.3);
      g.fill();
      g.fillStyle = '#d9b382';
      band(b, 0);
      g.fill();
      g.strokeStyle = 'rgba(139,90,43,.5)';
      g.lineWidth = 0.12;
      for (const p of b) {
        g.beginPath();
        g.moveTo(p.x + p.ty * p.half, p.y - p.tx * p.half);
        g.lineTo(p.x - p.ty * p.half, p.y + p.tx * p.half);
        g.stroke();
      }
      // 바람 줄무늬
      g.strokeStyle = 'rgba(255,255,255,.7)';
      g.lineWidth = 0.15;
      for (let k = 0; k < 10; k++) {
        const p = b[Math.floor((k / 10) * b.length)];
        const ph = ((now / 600 + k * 0.37) % 1) * 8 - 4;
        g.beginPath();
        g.moveTo(p.x - p.ty * ph, p.y + p.tx * ph);
        g.lineTo(p.x - p.ty * (ph + 1.2), p.y + p.tx * (ph + 1.2));
        g.stroke();
      }
      // 점프대: 노란 경사로 → 물웅덩이 → 착지
      const ramp = [];
      for (let s = T.jump.ramp; s <= T.jump.gap0; s += 0.5) ramp.push(pointAt(T.main, s));
      g.strokeStyle = '#fab005';
      g.lineWidth = SECTIONS[1].w;
      g.lineCap = 'butt';
      poly(ramp);
      g.stroke();
      g.setLineDash([0.6, 0.6]);
      g.strokeStyle = '#e67700';
      g.lineWidth = SECTIONS[1].w;
      poly(ramp);
      g.stroke();
      g.setLineDash([]);
      const gap = [];
      for (let s = T.jump.gap0; s <= T.jump.gap1; s += 0.5) gap.push(pointAt(T.main, s));
      g.strokeStyle = COLORS.water;
      g.lineWidth = SECTIONS[1].w + 1;
      poly(gap);
      g.stroke();
      g.lineCap = 'round';
      }
      // 부스트 발판: 노란 화살표
      for (const bo of T.boosts) {
        for (let k = 0; k < 3; k++) {
          const p = pointAt(T.main, bo.s + k * 1.1);
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
      const half = SECTIONS[0].w / 2;
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
      const sp = Math.hypot(focus.vx || 0, focus.vy || 0);
      const wantZ = Math.max(13, 21 - sp * 0.35) * Math.min(1, Math.max(0.6, Math.min(W, H) / 520));
      cam.z += (wantZ - cam.z) * 0.06;
      cam.x += (focus.x + (focus.vx || 0) * 0.35 - cam.x) * 0.12;
      cam.y += (focus.y + (focus.vy || 0) * 0.35 - cam.y) * 0.12;
      cam.shake *= 0.88;
      const sx = (Math.random() - 0.5) * cam.shake;
      const sy = (Math.random() - 0.5) * cam.shake;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = COLORS.water;
      g.fillRect(0, 0, W, H);
      g.translate(W / 2, H / 2);
      g.scale(cam.z, cam.z);
      g.translate(-cam.x + sx, -cam.y + sy);
      // 물결
      const vx0 = cam.x - W / 2 / cam.z;
      const vy0 = cam.y - H / 2 / cam.z;
      g.fillStyle = COLORS.waterHi;
      for (let x = Math.floor(vx0 / 6) * 6; x < vx0 + W / cam.z + 6; x += 6) {
        for (let y = Math.floor(vy0 / 5) * 5; y < vy0 + H / cam.z + 5; y += 5) {
          const o = 0;
          g.fillRect(x + o + ((y / 5) % 2) * 3, y, 1.4, 0.18);
        }
      }
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
      drawTrackLayer(1);
      drawSkids(1, now);
      for (const [p, c, layer] of list) if (layer) drawCar(p, c, true, cam.z);
      if (myLayer && mine()) drawCar(who(me), car, false, cam.z);
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
      mg.lineWidth = 5;
      mg.beginPath();
      T.main.pts.forEach((p, i) => (i ? mg.lineTo(p.x, p.y) : mg.moveTo(p.x, p.y)));
      mg.closePath();
      mg.stroke();
      mg.strokeStyle = '#d9b382';
      mg.lineWidth = 2;
      mg.beginPath();
      (T.sprint ? [] : T.branch.pts).forEach((p, i) => (i ? mg.lineTo(p.x, p.y) : mg.moveTo(p.x, p.y)));
      mg.stroke();
      const t = api.now();
      for (const p of S?.roster || []) {
        const c = p.id === me ? car : ghostAt(p.id, t);
        if (!c) continue;
        mg.fillStyle = p.color || '#adb5bd';
        mg.strokeStyle = p.id === me ? '#ffd43b' : '#212529';
        mg.lineWidth = p.id === me ? 2.5 : 1.2;
        mg.beginPath();
        mg.arc(c.x, c.y, p.id === me ? 4 : 3, 0, Math.PI * 2);
        mg.fill();
        mg.stroke();
      }
    }

    // 물리·위치 보내기는 그리기와 따로 (브라우저가 그리기를 늦추거나 멈춰도 차는 정확하게)
    const ticker = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(100, now - last);
      last = now;
      if (!S) return;
      // 출발 신호와 함께 시작 (부정출발이면 1초 늦게)
      if (racing() && !started) {
        started = true;
        if (falseStart) lockUntil = S.startAt + FALSE_START;
      }
      if (racing() && mine()) {
        drive(dt);
        sendDrive(now);
      }
      lights();
      renderTop();
      // 화면이 보이는데 그리기가 멈춰 있으면(가려진 창 등) 여기서라도 그린다
      if (!document.hidden && now - drawnAt > 200) draw(now);
    }, 16);

    function loop(now) {
      raf = requestAnimationFrame(loop);
      draw(now);
    }
    raf = requestAnimationFrame(loop);

    // 신호등: 빨강 → 주황 → 초록, 하나씩 1초
    function lights() {
      const t = api.now();
      const n = S.phase === 'ready' ? Math.floor((t - (S.startAt - READY)) / LIGHT) : S.phase === 'race' && t - S.startAt < 800 ? 2 : -1;
      overlay.querySelectorAll('.lamp').forEach((el, i) => el.classList.toggle('on', i === n));
      if (n === litLamp) return;
      litLamp = n;
      if (n >= 0) audio.ready();
      if (n === 2) flash(lockUntil > t ? '🚫 부정출발 벌칙…' : '출발!');
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
        h('span', { class: 'rc-lap' }, c?.fin ? '🏁 완주!' : S.phase === 'final' ? '미완주' : `ROUND ${S.round}/3`),
        S.phase === 'final' && !c?.fin ? null : h('span', { class: 'rc-time' }, fmt(time)),
        c ? h('span', {}, `${pos}등 / ${S.roster.length}명`) : null,
        c?.split != null && !c.fin ? h('span', { class: c.split > 0 ? 'rc-behind' : 'rc-ahead' }, c.split > 0 ? `선두와 +${c.split}초` : '구간 선두!') : null,
        h('span', { class: 'muted' }, `합계 ${S.points?.[me] || 0}점 · ${car.vx * car.hx + car.vy * car.hy < -.5 ? 'R ' : ''}${Math.round(Math.hypot(car.vx, car.vy) * 3.6)} km/h`),
        h('span', { class: 'rc-hot' }, car.boostLeft > 0 ? '🔥 부스트!' : (car.charge || 0) >= 1.15 ? '🟠 놓으면 강력 부스트!' : (car.charge || 0) >= .45 ? '🔵 놓으면 부스트!' : `SPACE 드리프트 ${Math.round((car.charge || 0) / 1.5 * 100)}%`),
        S.finishBy && S.phase === 'race' ? h('span', { class: 'rc-hot' }, `⏱ ${Math.max(0, Math.ceil((S.finishBy - api.now()) / 1000))}초 안에 결승선!`) : null,
      ].filter(Boolean));
    }

    function renderOverlay() {
      const key = `${S.round}:${S.phase}:${!!mine()?.fin}`;
      if (key === overlayKey) return;
      overlayKey = key;
      overlay.replaceChildren();
      if (S.phase === 'intro') {
        overlay.append(h('div', { class: 'rc-card' },
          h('h2', {}, '🏎️ 카트 그랑프리'),
          S.again ? null : h('ul', { class: 'rules big' },
            h('li', {}, '차고 8자 코스 한 바퀴씩, 3경기 합산 점수로 승부!'),
            h('li', {}, 'W / ↑ = 가속 · S / ↓ = 제동 후 후진 · A D / ← → = 핸들'),
            h('li', {}, '코너에서 SPACE 꾹 = 드리프트 · 놓으면 부스트!'),
            h('li', {}, '파란 불꽃은 짧게, 주황 불꽃은 길게 가속! 벽에 박으면 충전이 사라져요'),
            h('li', {}, '초록불 전 가속하면 부정출발! 핸들은 미리 돌릴 수 있어요'))));
      }
      if (S.phase === 'ready') {
        overlay.append(h('div', { class: 'tc-light rc-light' }, h('i', { class: 'lamp red' }), h('i', { class: 'lamp amber' }), h('i', { class: 'lamp green' })));
      }
      if (S.phase === 'intermission') {
        const result = S.roundResults?.at(-1);
        overlay.append(h('div', { class: 'rc-card' },
          h('h2', {}, `ROUND ${S.round} 종료 · 5초 후 다시 출발!`),
          h('p', {}, '모두 출발선에서 새로 시작 · 3경기 합산 승부'),
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
      const key = JSON.stringify(order.map(id => {
        const c = S.cars[id];
        return [id, S.round, S.points?.[id], c.lap, c.cp, c.fin, c.spl];
      }));
      if (key === sideKey) return;
      sideKey = key;
      side.replaceChildren(
        h('h3', {}, `ROUND ${S.round}/3 · 실시간 순위`),
        h('ol', { class: 'tw-bag rc-rank' }, order.map(id => {
          const c = S.cars[id];
          const p = who(id);
          return h('li', { class: id === me ? 'now' : '' }, avatar(p), h('span', {}, p.name),
            h('em', {}, c.fin ? `🏁 ${fmt(c.fin)}` : `${S.points?.[id] || 0}점 · ${TRACK_NAMES[c.cp] || ''}`));
        })),
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, 'W / ↑ = 앞으로 가속 · S / ↓ 꾹 = 멈춘 뒤 후진'),
          h('li', {}, 'A D / ← → = 핸들. 떼면 중앙으로 돌아와요'),
          h('li', {}, '고속에서는 핸들이 덜 꺾여요. 코너 전 감속!'),
          h('li', {}, 'SPACE 꾹 = 드리프트, 놓으면 모은 만큼 부스트'),
          h('li', {}, '🔵 짧은 부스트 → 🟠 강력 부스트. 직선에서는 충전되지 않아요'),
          h('li', {}, '오른쪽 위 미니맵 = 트랙 전체')),
        h('h3', {}, '차고 8자 · 카트끼리 밀고 추월!'),
        h('ul', { class: 'rules' }, TRACK_NAMES.map((name, i) => h('li', {}, `${i + 1}. ${name}`))));
    }

    return {
      update({ state }) {
        const prevRound = lastRound;
        S = state;
        if (prevRound !== S.round) {
          lastRound = S.round;
          Object.assign(car, newCar(T), { charge: 0, boostLeft: 0, driftHeld: false });
          resetControls(false); prediction.clear(); parts.length = 0; skids.length = 0; skidAt.clear();
          started = false; falseStart = false; seenFin = false; lockUntil = 0;
          inputSeq = mine()?.seq || 0; seenFx = 0;
          acc = 0; sentAt = 0; wasDrift = 0; litLamp = -1;
          topKey = sideKey = overlayKey = '';
          cam.x = car.x; cam.y = car.y;
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

