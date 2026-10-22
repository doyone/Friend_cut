// 범퍼카 그랑프리: 물 위에 뜬 8자 얼음 트랙을 2바퀴 먼저 돌면 우승. 순수 실력 대결.
// 다른 차는 반투명 유령이라 부딪히지 않는다(방해 불가). 조작은 방향키(WASD)뿐 — 그 방향으로 밀기, 반대 = 브레이크.
// 부딪힘이 없으니 내 차는 내 화면이 바로 계산하고(와이파이 지연 없음) 0.1초마다 위치를 보낸다.
// 방장은 심판: 위치로 체크포인트·바퀴·완주 순서를 기록하고, 봇 차를 같은 물리로 움직인다.
// 트랙·물리는 race-core.js (구간: 출발 직선 → 빙하 점프 → 펭귄 헤어핀 → 물결 S자 → 8자 고가 다리 → 갈림길 → 펭귄 회전문 → 마지막 직선)
import { h, isTyping } from '../util.js';
import { avatar, nameTag } from '../ui.js';
import { createBumperAudio } from './bumper-audio.js';
import { buildTrack, newCar, stepCar, locate, botInput, gateAngle, pointAt, LAPS, CAR_R, SECTIONS } from './race-core.js';

const T = buildTrack();
const L = T.main.len;
const CPS = SECTIONS.length - 1;  // 체크포인트 = 구간 시작 (출발 직선 빼고). 다 지나고 결승선을 넘으면 한 바퀴
const INTRO = 4500;
const LIGHT = 1000;               // 신호등 한 칸
const READY = LIGHT * 3;          // 빨강 → 주황 → 초록(= 출발)
const FINISH_WAIT = 20000;        // 첫 완주 뒤 이 안에 들어와야 완주
const MAX_RACE = 5 * 60000;
const FALSE_START = 1000;         // 부정출발 벌칙
const SEND_EVERY = 100;
const STEP = 1 / 60;
const r2 = v => Math.round(v * 100) / 100;
const fmt = ms => (ms == null ? '-' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`);

/* ───────── 심판 (방장) ───────── */

function carEntry(car) {
  return { x: r2(car.x), y: r2(car.y), vx: r2(car.vx), vy: r2(car.vy), path: car.path, seg: car.seg, ms: r2(car.ms), dist: 0, lap: 0, cp: 0, spl: 0, sh: 0, jmp: 0, jf: 0 };
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

function onCar(ctx, pid, data, now) {
  const S = ctx.state;
  const c = S.cars?.[pid];
  if (!c || S.phase !== 'race') return false;
  const t = Number.isFinite(data.t) ? Math.max(now - 1000, Math.min(now, data.t)) : now;
  const x = Number(data.x);
  const y = Number(data.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  // 위치가 트랙 근처인지 보고, 말도 안 되는 속도(순간이동)는 무시. 물에서 다시 설 때(rs)만 뒤로 순간이동 허용
  const at = locate(T, { path: data.path === 'branch' ? 'branch' : 'main', seg: Number(data.seg) || 0 }, x, y);
  if (!at || at.d > 12) return false;
  const dt = Math.max(0.05, (t - (c.t || t - 100)) / 1000);
  if (!data.rs && Math.hypot(x - c.x, y - c.y) / dt > 45) return false;
  if (c.path === 'main' && at.path === 'branch') c.sh++;
  for (const e of Array.isArray(data.ev) ? data.ev.slice(0, 8) : []) {
    if (e === 'splash') {
      c.spl++;
      if (at.path === 'main' && at.ms > T.jump.ramp - 5 && at.ms < T.jump.gap1 + 3) c.jf++;
    }
    if (e === 'land') c.jmp++;
  }
  Object.assign(c, { x: r2(x), y: r2(y), vx: r2(Number(data.vx) || 0), vy: r2(Number(data.vy) || 0), h: r2(Number(data.h) || 0), dr: data.dr ? 1 : 0, path: at.path, seg: at.seg, air: data.air ? 1 : 0, sp: data.sp ? 1 : 0, t });
  advance(S, pid, at.ms, t);
  return true;
}

// 봇 차: 방장이 같은 물리로 1/60초씩. 가끔 실수(핸들을 그대로 둠)해서 코너에서 빠지기도
function stepBots(ctx, now) {
  const S = ctx.state;
  ctx.bots ||= new Map();
  const from = ctx.botAt || now;
  const stepMs = 1000 * STEP;
  const steps = Math.min(30, Math.floor((now - from) / stepMs));
  ctx.botAt = steps === 30 ? now : from + steps * stepMs; // 자투리 시간은 다음 틱으로 (봇이 느려지지 않게)
  for (const p of S.roster) {
    if (!p.bot || S.cars[p.id].fin) continue;
    let b = ctx.bots.get(p.id);
    if (!b) {
      const c = S.cars[p.id];
      b = { car: { ...newCar(T), x: c.x, y: c.y, vx: c.vx, vy: c.vy, path: c.path, seg: c.seg, ms: c.ms }, mem: { short: Math.random() < 0.5 }, skill: 0.86 + Math.random() * 0.13 };
      ctx.bots.set(p.id, b);
    }
    const { car, mem } = b;
    const c = S.cars[p.id];
    for (let i = 0; i < steps; i++) {
      const t = from + (i + 1) * STEP * 1000;
      let input = null;
      if (!car.sp && !car.air) {
        // 초당 5%쯤 (실력 낮을수록 자주) 0.5~1초 동안 핸들을 그대로 둔다
        if (t > (mem.blunderEnd || 0) && Math.random() < ((0.05 * STEP) * (1.6 - b.skill)) / 0.7) {
          mem.blunderEnd = t + 500 + Math.random() * 500;
          mem.hold = botInput(T, car, mem, b.skill);
        }
        input = t < (mem.blunderEnd || 0) ? mem.hold : botInput(T, car, mem, b.skill);
      }
      const prevPath = car.path;
      const ev = stepCar(T, car, input, STEP, t);
      if (prevPath === 'main' && car.path === 'branch') c.sh++;
      for (const e of ev) {
        if (e === 'splash') {
          c.spl++;
          if (car.fall?.path === 'main' && car.fall.s > T.jump.ramp - 5 && car.fall.s < T.jump.gap1 + 3) c.jf++;
        }
        if (e === 'land') c.jmp++;
      }
      if (!car.sp && !car.air) advance(S, p.id, car.ms, t);
      // 바퀴마다 지름길로 갈지 다시 정함
      if (c.lap !== mem.lap) {
        mem.lap = c.lap;
        mem.short = Math.random() < 0.5;
      }
      if (c.fin) break;
    }
    Object.assign(c, { x: r2(car.x), y: r2(car.y), vx: r2(car.vx), vy: r2(car.vy), h: r2(Math.atan2(car.hy, car.hx)), dr: car.dr ? 1 : 0, path: car.path, seg: car.seg, air: car.air ? 1 : 0, sp: car.sp ? 1 : 0, t: now });
  }
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
  const standings = Object.fromEntries(order.map(id => {
    const c = S.cars[id];
    return [id, c.fin ? 1e9 - c.fin : 1e6 + Math.max(-1e5, c.dist)];
  }));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const win = S.cars[order[0]];
  if (win?.fin) add(order[0], `🏁 우승 (${fmt(win.fin)})`);
  const best = order.filter(id => S.cars[id].best).sort((a, b) => S.cars[a].best - S.cars[b].best)[0];
  if (best) add(best, `⚡ 최고 랩 (${(S.cars[best].best / 1000).toFixed(1)}초)`);
  const most = (key, min) => order.filter(id => S.cars[id][key] >= min).sort((a, b) => S.cars[b][key] - S.cars[a][key])[0];
  const wet = most('spl', 2);
  if (wet) add(wet, `🌊 입수왕 (${S.cars[wet].spl}번)`);
  const short = most('sh', 2);
  if (short) add(short, `🌉 지름길 장인 (${S.cars[short].sh}번)`);
  const jumper = order.find(id => S.cars[id].fin && S.cars[id].jmp >= LAPS && !S.cars[id].jf);
  if (jumper) add(jumper, '🛷 점프왕');
  Object.assign(S, { order, standings, titles, phase: 'final', over: true });
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
const COLORS = { water: '#2f86d6', waterHi: '#5aa8eb', edge: '#14558f', ice: '#e8f4fd', snow: '#ffffff', wall: '#ffffff', bridge: '#b8bec7', rail: '#f8f9fa' };

export default {
  id: 'race',
  title: '범퍼카 그랑프리',
  emoji: '🏁',
  tag: '액션',
  color: '#1c7ed6',
  desc: '물 위 8자 얼음 트랙 2바퀴 레이스! 남의 차는 반투명 유령이라 부딪히지 않아요. 점프·헤어핀·회전문… 순수 실력 대결',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx) {
    const now = ctx.now();
    const car = newCar(T);
    return {
      phase: 'intro',
      introUntil: now + INTRO,
      cars: Object.fromEntries(ctx.roster.map(p => [p.id, carEntry(car)])),
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    if (type !== 'car') return false;
    return onCar(ctx, pid, data, ctx.now());
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intro') {
      if (now < S.introUntil) return false;
      Object.assign(S, { phase: 'ready', startAt: now + READY });
      return true;
    }
    if (S.phase === 'ready') {
      if (now < S.startAt) return false;
      S.phase = 'race';
      ctx.botAt = S.startAt;
      return true;
    }
    if (S.phase !== 'race') return false;
    stepBots(ctx, now);
    S.order = rank(S);
    const all = S.roster.every(p => S.cars[p.id].fin);
    if (all || (S.finishBy && now >= S.finishBy) || now - S.startAt > MAX_RACE) return finish(ctx);
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
    const sound = h('button', { class: 'rc-sound', type: 'button', tabindex: '-1' });
    const soundLabel = () => { sound.textContent = audio.enabled ? '🔊' : '🔇'; };
    soundLabel();
    sound.addEventListener('click', () => { audio.toggle(); soundLabel(); sound.blur(); });
    const stage = h('div', { class: 'rc-stage' }, canvas, mini, overlay, fxBox, sound);
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
    let events = [];
    let respawned = false;
    let falseStart = false;
    let lockUntil = 0;
    let started = false;
    let cam = { x: 0, y: 0, z: 18, shake: 0 };
    let topKey = '';
    let sideKey = '';
    let overlayKey = '';
    let seenFin = false;
    let litLamp = -1;
    const car = newCar(T);                      // 내 차 (내 화면이 계산)
    const keys = { l: false, r: false, u: false, d: false };
    const ghosts = new Map();                   // id → [{ t, x, y, vx, vy }]
    const parts = [];                           // 효과 알갱이
    const skids = [];                           // 미끄러진 자국 { x0, y0, x1, y1, layer, t } (뒷바퀴 둘)
    const skidAt = new Map();                   // id → 지난 뒷바퀴 자리
    let wasDrift = 0;
    const splashes = [];
    const who = id => S?.roster.find(p => p.id === id) || { id, name: '?' };
    const mine = () => S?.cars?.[me];
    const racing = () => S?.phase === 'race';
    const canDrive = () => racing() && !!mine() && api.now() >= Math.max(S.startAt, lockUntil);

    const KEY = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };
    function onKey(e) {
      if (isTyping(e)) return;
      const k = KEY[e.code];
      if (!k) return;
      e.preventDefault();
      keys[k] = e.type === 'keydown';
      if (e.type === 'keydown') void audio.unlock();
      // 초록불 전에 누르면 부정출발
      if (e.type === 'keydown' && S?.phase === 'ready' && !falseStart) {
        falseStart = true;
        flash('🚫 부정출발! 1초 늦게 출발', 'bad');
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    const onBlur = () => { keys.l = keys.r = keys.u = keys.d = false; };
    window.addEventListener('blur', onBlur);

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

    function sendCar(now) {
      if (now - sentAt < SEND_EVERY && !events.length) return;
      sentAt = now;
      api.send('car', {
        x: r2(car.x), y: r2(car.y), vx: r2(car.vx), vy: r2(car.vy), h: r2(Math.atan2(car.hy, car.hx)), dr: car.dr ? 1 : 0, path: car.path, seg: car.seg,
        air: car.air ? 1 : 0, sp: car.sp ? 1 : 0, rs: respawned ? 1 : 0, t: api.now(), ev: events,
      });
      events = [];
      respawned = false;
    }

    // 내 차 물리: 1/60초 고정 걸음 (노트북 속도와 상관없이 같은 결과)
    function drive(dtMs) {
      acc = Math.min(acc + dtMs, 200);
      while (acc >= STEP * 1000) {
        acc -= STEP * 1000;
        const t = api.now() - acc;
        const input = canDrive() && !mine()?.fin ? { x: (keys.r ? 1 : 0) - (keys.l ? 1 : 0), y: (keys.d ? 1 : 0) - (keys.u ? 1 : 0) } : null;
        const ev = stepCar(T, car, car.sp || car.air || !canDrive() ? null : input, STEP, t);
        for (const e of ev) onEvent(e);
        // 꼬리가 빠지면(드리프트): 끼익 + 얼음 가루
        if (car.dr && !wasDrift) audio.skid();
        wasDrift = car.dr;
        if (car.dr && Math.random() < 0.6) parts.push({ x: car.x - car.hx * 0.6, y: car.y - car.hy * 0.6, vx: -car.vx * 0.2 + (Math.random() - 0.5) * 4, vy: -car.vy * 0.2 + (Math.random() - 0.5) * 4, life: 0.5, c: '#ffffff' });
      }
    }

    function onEvent(e) {
      if (e === 'splash') {
        events.push('splash');
        splashes.push({ x: car.x, y: car.y, t: performance.now() });
        audio.impact(true, true);
        cam.shake = 0.6;
        flash('🌊 풍덩!', 'bad');
      } else if (e === 'respawn') {
        respawned = true;
      } else if (e === 'land') {
        events.push('land');
        cam.shake = 0.35;
        audio.impact(false, true);
      } else if (e === 'jump') {
        events.push('jump');
      } else if (e === 'wall' || e === 'gate') {
        cam.shake = Math.max(cam.shake, 0.3);
        audio.impact(e === 'gate', true);
      } else if (e === 'boost') {
        flash('⚡ 부스트!');
        for (let i = 0; i < 12; i++) parts.push({ x: car.x, y: car.y, vx: (Math.random() - 0.5) * 6 - car.vx * 0.3, vy: (Math.random() - 0.5) * 6 - car.vy * 0.3, life: 0.6, c: '#ffd43b' });
      }
    }

    // 남의 차: 받은 위치를 0.18초 늦게 이어 그린다 (반투명 유령이라 티 안 남)
    function ghostAt(id, now) {
      const buf = ghosts.get(id);
      if (!buf?.length) return null;
      const t = now - 180;
      let a = buf[0];
      for (const b of buf) {
        if (b.t >= t) {
          if (b === a || b.t === a.t) return b;
          const f = (t - a.t) / (b.t - a.t);
          const dh = ((((b.h || 0) - (a.h || 0)) % TAU) + TAU * 1.5) % TAU - Math.PI;
          return { ...b, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, h: (a.h || 0) + dh * f };
        }
        a = b;
      }
      const dt = Math.min(0.3, (t - a.t) / 1000);
      return a.sp || a.air ? a : { ...a, x: a.x + a.vx * dt, y: a.y + a.vy * dt };
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
        g.fillStyle = layer ? COLORS.bridge : sec.surface === 'snow' ? COLORS.snow : COLORS.ice;
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
      // 벽: 눈벽(바깥쪽)·난간
      for (const run of RUNS) {
        if (run.layer !== layer) continue;
        const sec = SECTIONS[run.sec];
        const walls = layer ? 'both' : sec.walls;
        if (!walls) continue;
        g.strokeStyle = layer ? COLORS.rail : COLORS.wall;
        g.lineWidth = layer ? 0.35 : 0.7;
        for (const side of [1, -1]) {
          const pts = run.pts.filter(p => walls === 'both' || p.outer === side);
          if (pts.length < 2) continue;
          poly(edgeLine(pts, side, layer ? 0.1 : 0.35));
          g.stroke();
        }
      }
    }

    function drawFeatures(now) {
      // 지름길: 좁은 나무 다리 (양옆 물, 옆바람). 양 끝은 깔때기처럼 넓다 (물리와 같은 폭)
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
      g.globalAlpha = ghost ? 0.45 : 1;
      g.translate(c.x, c.y);
      g.scale(air, air);
      g.rotate(heading(c));
      // 몸통 (앞뒤로 살짝 긴 범퍼카) — 미끄러지면 가는 방향과 몸통이 어긋나 보인다
      g.fillStyle = '#343a40';
      g.beginPath();
      g.ellipse(0, 0, CAR_R + 0.26, CAR_R + 0.08, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = p.color || '#adb5bd';
      g.beginPath();
      g.ellipse(0, 0, CAR_R + 0.12, CAR_R - 0.05, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.beginPath();
      g.arc(-0.15, -0.2, 0.25, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = ghost ? '#ffffff' : '#ffd43b';
      g.beginPath();
      g.moveTo(1.2, 0);
      g.lineTo(0.5, -0.42);
      g.lineTo(0.5, 0.42);
      g.closePath();
      g.fill();
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
          const o = Math.sin((x * 0.7 + y + now / 400)) * 0.8;
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
      T.branch.pts.forEach((p, i) => (i ? mg.lineTo(p.x, p.y) : mg.moveTo(p.x, p.y)));
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
        sendCar(now);
      }
      lights();
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
      const lap = c ? Math.min(LAPS, c.lap + 1) : 1;
      const key = JSON.stringify([S.phase, c?.lap, c?.fin, pos, c?.split, Math.floor((api.now() - (S.startAt || 0)) / 100)]);
      if (key === topKey) return;
      topKey = key;
      const time = c?.fin ?? (S.phase === 'race' ? Math.max(0, api.now() - S.startAt) : 0);
      top.replaceChildren(...[
        h('span', { class: 'rc-lap' }, c?.fin ? '🏁 완주!' : S.phase === 'final' ? '미완주' : `${lap}/${LAPS}바퀴`),
        S.phase === 'final' && !c?.fin ? null : h('span', { class: 'rc-time' }, fmt(time)),
        c ? h('span', {}, `${pos}등 / ${S.roster.length}명`) : null,
        c?.split != null && !c.fin ? h('span', { class: c.split > 0 ? 'rc-behind' : 'rc-ahead' }, c.split > 0 ? `선두와 +${c.split}초` : '구간 선두!') : null,
        c?.best ? h('span', { class: 'muted' }, `최고 랩 ${(c.best / 1000).toFixed(1)}초`) : null,
        S.finishBy && S.phase === 'race' ? h('span', { class: 'rc-hot' }, `⏱ ${Math.max(0, Math.ceil((S.finishBy - api.now()) / 1000))}초 안에 결승선!`) : null,
      ].filter(Boolean));
    }

    function renderOverlay() {
      const key = `${S.phase}:${!!mine()?.fin}`;
      if (key === overlayKey) return;
      overlayKey = key;
      overlay.replaceChildren();
      if (S.phase === 'intro') {
        overlay.append(h('div', { class: 'rc-card' },
          h('h2', {}, '🏁 범퍼카 그랑프리'),
          h('ul', { class: 'rules big' },
            h('li', {}, `8자 얼음 트랙 ${LAPS}바퀴 먼저 돌면 우승! 남의 차는 반투명 유령이라 안 부딪혀요`),
            h('li', {}, '방향키(WASD) = 그 방향으로 밀기 · 반대 방향 = 브레이크'),
            h('li', {}, '길 밖은 물 🌊 (빠지면 1.2초 뒤 조금 뒤에서 다시). 하얀 눈벽·난간·회전문은 튕기기만 해요'),
            h('li', {}, '🛷 점프대는 빠르게 똑바로 · 🌉 갈림길 좁은 다리는 짧지만 옆바람 · ⚡ 노란 화살표 = 부스트'),
            h('li', {}, '신호등이 초록이 되기 전에 누르면 부정출발 (1초 늦게)'))));
      }
      if (S.phase === 'ready') {
        overlay.append(h('div', { class: 'tc-light rc-light' }, h('i', { class: 'lamp red' }), h('i', { class: 'lamp amber' }), h('i', { class: 'lamp green' })));
      }
      if (S.phase === 'final') {
        // 점수 대신 기록 (등수 계산용 standings는 큰 숫자라 보여 주지 않는다)
        const rows = (S.order || []).map((id, i) => h('li', { class: `r${i + 1}${id === me ? ' me' : ''}` },
          h('span', { class: 'medal' }, ['🥇', '🥈', '🥉'][i] || i + 1),
          nameTag(who(id), me),
          h('b', {}, S.cars[id].fin ? fmt(S.cars[id].fin) : '미완주')));
        overlay.append(h('div', { class: 'rc-card' }, h('h2', {}, `🏁 ${who(S.order?.[0]).name} 우승!`), h('ol', { class: 'podium' }, rows)));
      }
    }

    function renderSide() {
      const order = S.order || S.roster.map(p => p.id);
      const key = JSON.stringify(order.map(id => {
        const c = S.cars[id];
        return [id, c.lap, c.cp, c.fin, c.spl];
      }));
      if (key === sideKey) return;
      sideKey = key;
      side.replaceChildren(
        h('h3', {}, '순위'),
        h('ol', { class: 'tw-bag rc-rank' }, order.map(id => {
          const c = S.cars[id];
          const p = who(id);
          return h('li', { class: id === me ? 'now' : '' }, avatar(p), h('span', {}, p.name),
            h('em', {}, c.fin ? `🏁 ${fmt(c.fin)}` : `${Math.min(LAPS, c.lap + 1)}바퀴 · ${SECTIONS[c.cp]?.name || ''}`));
        })),
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '←↑→↓ (WASD) = 그 방향으로 밀기, 같이 누르면 대각선'),
          h('li', {}, '반대 방향 = 브레이크. 얼음이라 코너 앞에서 미리!'),
          h('li', {}, '빠를 때 확 꺾으면 바깥으로 밀리고 꼬리가 빠져요 (드리프트)'),
          h('li', {}, '오른쪽 위 미니맵 = 트랙 전체')),
        h('h3', {}, '트랙'),
        h('ul', { class: 'rules' }, SECTIONS.map((sec, i) => h('li', {}, `${i + 1}. ${sec.name}`))));
    }

    return {
      update({ state }) {
        const prevPhase = S?.phase;
        S = state;
        // 남의 차 위치 받아 두기
        for (const p of S.roster) {
          if (p.id === me) continue;
          const c = S.cars?.[p.id];
          if (!c) continue;
          const buf = ghosts.get(p.id) || [];
          const t = c.t || api.now();
          if (!buf.length || buf[buf.length - 1].t !== t) buf.push({ t, x: c.x, y: c.y, vx: c.vx, vy: c.vy, h: c.h, dr: c.dr, seg: c.seg, path: c.path, air: c.air, sp: c.sp });
          while (buf.length > 12) buf.shift();
          ghosts.set(p.id, buf);
        }
        // 처음 들어왔거나 다시 들어왔으면 내 차를 방장이 아는 자리로
        const c = mine();
        if (c && (!prevPhase || (S.phase !== 'race' && !racing()))) {
          Object.assign(car, { x: c.x, y: c.y, vx: c.vx || 0, vy: c.vy || 0, path: c.path || 'main', seg: c.seg || 0, ms: c.ms });
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
        cancelAnimationFrame(raf);
        clearInterval(ticker);
        ro.disconnect();
        audio.dispose();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', onBlur);
      },
    };
  },
};

