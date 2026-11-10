// 인간대포 컬링: 나를 대포로 쏴서 둥근 과녁판에 내려앉는다. 스페이스 톡 = 왔다 갔다 하는 각도 멈추기 → 스페이스 꾹 = 힘 모으기, 떼면 발사.
// 라운드마다 각자 두 번: 1바퀴는 돌아가며 한 발씩, 2바퀴는 🎆 일제 발사(모두 동시에 조준, 남의 조준은 안 보임)라서 '마지막에 쏘는 사람'이 없다.
// 어디에 떨어질지는 미리 안 보여 준다. 샷마다 바뀌는 🌬️ 바람이 떨어지는 자리를 밀어낸다 (화살표로 보임). 내 말 2개 중 더 안쪽 말이 내 자리.
// 먼저 앉아 있던 말을 들이받아 밀어낼 수 있고, 머리 위로 떨어지면 쿵 하고 튕겨 낸다. 판 밖으로 나가면 장외.
// 다 쏘면 말이 다 장외인 사람 + 제일 바깥인 사람이 독박 (6명 이상이면 2명). 하트(2명 2개, 3명 이상 1개)를 다 잃으면 탈락, 마지막 1명 우승.
// 판은 사람이 줄수록 작아지고 대포는 라운드마다 빨라진다. 🎰 샷마다 룰렛으로 내가 뭐가 될지 정해진다: 돌덩이·폭탄·얼음·풍선·대왕.
// 물리는 방장이 발사 순간에 끝까지 한 번에 계산해서 움직임 전체를 상태 한 번에 실어 보낸다 → 모두의 화면이 같은 시각표대로 재생해서 렉이 없다.
import { h, isTyping, josa, pick, shuffle, INTRO_TIME } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';

const STEP = 1000 / 60;
const SAMPLE = 3;             // 위치는 3걸음(0.05초)마다 저장
export const SAMPLE_MS = 50;
const MAX_STEPS = 460;        // 7초쯤이면 무조건 끝
const ANGLE_TIME = 6000;
const POWER_TIME = 5000;      // 이 안에 스페이스를 누르기 시작해야 한다
const VOLLEY_TIME = 7000;     // 일제 발사: 다 같이 조준하는 시간
const VOLLEY_GAP = 90;        // 일제 발사 때 한 명씩 튀어나오는 간격
const OVERHOLD = 1500;        // 힘이 다 찬 뒤에도 이만큼 더 누르고 있으면 그대로 발사
const AFK_POWER = 0.15;       // 시간 안에 안 누르면 이 힘으로 (판 앞쪽에 겨우 걸친다)
const SHOT_LEAD = 200;        // 모두에게 상태가 도착할 시간을 벌고 쏜다
const SHOT_REST = 300;        // 다 멈춘 뒤 잠깐 보여 준다
const JUDGE_TIME = 2600;
const REEL_MS = 700;          // 룰렛이 도는 시간 (그동안에도 각도는 움직인다)
const MAX_LAG = 1500;

export const A_MAX = 0.56;    // 각도 ±32°
const GAP = 4;                // 판 가장자리에서 대포까지 (m)
const BODY_R = 0.85;
const FLIGHT_SHARE = 0.78;    // 전체 거리 중 날아가는 몫, 나머지는 착지 후 미끄러짐
const FLY_MIN = 650;
const FLY_MAX = 1300;
const FRICTION = 1.8;
const STOP = 0.12;
const BOUNCE = 0.9;
const BUMP = 3.5;             // 세게 부딪히면 덤으로 튕기는 속도 (손맛: 판 가운데서 맞아도 많이 밀린다)
const MAX_V = 13;
const STOMP = 10;             // 머리 위로 떨어졌을 때 밀어내는 속도
const BLAST = 11;             // 폭탄이 터질 때 밀어내는 속도
const BLAST_R = 4.5;          // 폭탄이 닿는 거리
const BULL_R = 0.7;           // 이 안에 멈추면 정중앙
const MUZZLE = 1.7;           // 대포 중심에서 포구까지
export const WIND = 3;        // 제일 센 바람이 가운데까지 날아가는 사람을 미는 거리 (m)

// 🎰 샷마다 뭐가 될까. 말에 그대로 남아서 나중에 맞을 때도 효과가 있다 (돌덩이는 계속 잘 안 밀리고, 얼음은 맞으면 멀리 미끄러진다)
export const KINDS = {
  normal: { w: 38, emoji: '🙂', name: '기본', tip: '' },
  rock: { w: 15, emoji: '🗿', name: '돌덩이', tip: '무거워서 세게 밀고 잘 안 밀려요', mass: 3 },
  bomb: { w: 15, emoji: '💣', name: '폭탄', tip: '착지하면 쾅! 주변을 날려요' },
  ice: { w: 12, emoji: '🧊', name: '얼음', tip: '훨씬 멀리 미끄러져요', slip: 0.45 },
  balloon: { w: 11, emoji: '🎈', name: '풍선', tip: '가벼워서 잘 튕겨 나가요', mass: 0.35 },
  giant: { w: 9, emoji: '🍄', name: '대왕', tip: '커져서 판을 막아요', mass: 2, size: 1.7 },
};
const KIND_KEYS = Object.keys(KINDS);
export function pickKind(rand = Math.random) {
  let r = rand() * KIND_KEYS.reduce((a, k) => a + KINDS[k].w, 0);
  for (const k of KIND_KEYS) if ((r -= KINDS[k].w) < 0) return k;
  return 'normal';
}
function statOf(k) {
  const s = KINDS[k] || KINDS.normal;
  return { r: BODY_R * (s.size || 1), m: s.mass || 1, f: s.slip || 1 };
}
const CRIES = ['으아아아!', '엄마!', '살려줘!', '가즈아!', '안 돼!', '끼야아!'];

const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const deg = r => (r * 180) / Math.PI;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
const ownerOf = stone => String(stone).split(':')[0]; // 말 번호는 '사람id:1' 꼴

export const plateOf = alive => r2(5.5 + alive * 0.35);
export const livesOf = n => (n <= 2 ? 2 : 1); // 둘이면 한 라운드로 끝나지 않게
// 힘 0 → 판 앞 물에 빠짐, 0.5 → 정확히 가운데, 1 → 판 뒤로 넘어감 (바람이 없을 때)
export const reach = (p, R) => GAP - 1.5 + (2 * R + 3) * p;
export const angleAt = (t, ms, phase = 0) => r3(A_MAX * Math.sin(2 * Math.PI * (t / ms + phase)));
// 꾹 누른 시간 → 힘 (다 차면 1에서 멈춘다. 끝까지 누르면 너무 세서 판을 넘어간다)
export const powerOf = (hold, ms) => r3(clamp(hold / ms, 0, 1));
// 🌬️ 바람: 방향은 아무 쪽이나, 세기 0.25~1
export function pickWind(rand = Math.random) {
  const a = rand() * Math.PI * 2;
  const s = 0.25 + rand() * 0.75;
  return [r2(Math.cos(a) * s), r2(Math.sin(a) * s)];
}

/* ───────── 물리: 발사를 끝까지 한 번에 계산 ───────── */

function collide(A, B, fx, hit, t) {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const d = Math.hypot(dx, dy);
  const reachAB = A.r + B.r;
  if (d >= reachAB) return;
  const nx = d ? dx / d : 1;
  const ny = d ? dy / d : 0;
  const ia = 1 / A.m;
  const ib = 1 / B.m;
  const inv = ia + ib;
  const push = (reachAB - d) / inv; // 겹친 만큼 떼어 놓는다 (가벼운 쪽이 더 밀림)
  A.x -= nx * push * ia;
  A.y -= ny * push * ia;
  B.x += nx * push * ib;
  B.y += ny * push * ib;
  const vn = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny;
  if (vn <= 0) return;
  const j = ((1 + BOUNCE) * vn + (vn > 1 ? BUMP : 0)) / inv;
  A.vx -= nx * j * ia;
  A.vy -= ny * j * ia;
  B.vx += nx * j * ib;
  B.vy += ny * j * ib;
  for (const b of [A, B]) {
    const s = Math.hypot(b.vx, b.vy);
    if (s > MAX_V) {
      b.vx *= MAX_V / s;
      b.vy *= MAX_V / s;
    }
  }
  // 누가 움직이게 했나 (연쇄로 밀려도 처음 쏜 사람 몫)
  const sa = A.src;
  const sb = B.src;
  if (sb) A.src = sb;
  if (sa) B.src = sa;
  hit.add(A.id);
  hit.add(B.id);
  if (vn > 1) fx.push({ k: 'hit', t: Math.round(t), x: r2(A.x + nx * A.r), y: r2(A.y + ny * A.r), p: r2(vn), a: A.id, b: B.id });
}

// bodies: 이미 앉아 있는 말들 [{ id, by, k?, x, y, off? }]. shots: [{ shooter(말), owner(주인), kind, angle, power, delay? }]. 시간은 전부 발사 순간부터 ms.
// 돌려주는 것: flyers(날아가는 말들) · dur(다 멈출 때까지) · tracks(움직인 말의 자리 목록) · fx(효과) · after(최종 자리) · hit(건드려진 말) · src(말 → 밀어낸 사람)
export function simulateShots({ bodies, shots, wind = [0, 0], R, record = true }) {
  const D = R + GAP;
  const flyers = shots.map(s => {
    const ux = Math.cos(s.angle);
    const uy = Math.sin(s.angle);
    const T = reach(s.power, R);
    const L = T * FLIGHT_SHARE;
    const drift = (L / D) * WIND; // 멀리 날수록 바람을 많이 탄다
    return {
      id: s.shooter, by: s.owner ?? s.shooter, k: s.kind || 'normal', a: s.angle, d: s.delay || 0,
      fly: Math.round(FLY_MIN + (FLY_MAX - FLY_MIN) * Math.min(1, L / (2 * D))),
      ux, uy, x: -D + ux * L + wind[0] * drift, y: uy * L + wind[1] * drift, v0: T * (1 - FLIGHT_SHARE) * FRICTION,
    };
  }).sort((a, b) => a.d + a.fly - (b.d + b.fly));
  const t0 = flyers[0].d + flyers[0].fly; // 첫 사람이 착지하는 순간부터 세계가 돈다
  const shooters = new Set(flyers.map(f => f.id));
  const others = (bodies || []).filter(b => !shooters.has(b.id));
  const dt = STEP / 1000;
  const decayOf = b => Math.exp(-FRICTION * b.f * dt);
  const live = others.filter(b => !b.off).map(b => {
    const n = { id: b.id, by: b.by, k: b.k, x: b.x, y: b.y, x0: b.x, y0: b.y, vx: 0, vy: 0, src: null, ...statOf(b.k) };
    n.decay = decayOf(n);
    return n;
  });
  const splashed = [];
  const fx = flyers.map(f => ({ k: 'fire', t: f.d, a: r3(f.a) })).sort((a, b) => a.t - b.t);
  const hit = new Set();
  const tracks = new Map();

  const sample = k => {
    if (!record) return;
    for (const b of live) {
      let tr = tracks.get(b.id);
      if (!tr) {
        if (b.x === b.x0 && b.y === b.y0) continue;
        tr = { id: b.id, s: t0 + (k - 1) * SAMPLE_MS, d: [r2(b.x0), r2(b.y0)] };
        tracks.set(b.id, tr);
      }
      if (tr.done) continue;
      tr.d.push(r2(b.x), r2(b.y));
      if (b.off) tr.done = true;
    }
  };

  const landOne = f => {
    const t = f.d + f.fly;
    const me = { id: f.id, by: f.by, k: f.k, x: f.x, y: f.y, x0: f.x, y0: f.y, vx: f.ux * f.v0, vy: f.uy * f.v0, src: f.by, ...statOf(f.k) };
    me.decay = decayOf(me);
    if (Math.hypot(f.x, f.y) > R) {
      Object.assign(me, { off: true, ot: t, vx: 0, vy: 0 });
      fx.push({ k: 'splash', t, x: r2(f.x), y: r2(f.y), id: f.id });
      splashed.push(me);
      return;
    }
    fx.push({ k: 'land', t, x: r2(f.x), y: r2(f.y), id: f.id });
    const near = live.filter(o => !o.off);
    if (me.k === 'bomb') { // 착지하는 순간 쾅: 주변 말을 사방으로 날린다
      fx.push({ k: 'blast', t, x: r2(me.x), y: r2(me.y), id: f.id });
      for (const o of near) {
        const dx = o.x - me.x;
        const dy = o.y - me.y;
        const d = Math.hypot(dx, dy);
        if (d >= BLAST_R) continue;
        const s = (BLAST * (1 - (d / BLAST_R) * 0.55)) / Math.sqrt(o.m);
        o.vx += (d > 0.01 ? dx / d : f.ux) * s;
        o.vy += (d > 0.01 ? dy / d : f.uy) * s;
        o.src = f.by;
        hit.add(o.id);
      }
      me.vx *= 0.2;
      me.vy *= 0.2;
    } else {
      for (const o of near) { // 머리 위로 떨어지면 쿵
        const dx = o.x - me.x;
        const dy = o.y - me.y;
        const d = Math.hypot(dx, dy);
        const touch = me.r + o.r;
        if (d >= touch) continue;
        const nx = d > 0.01 ? dx / d : f.ux;
        const ny = d > 0.01 ? dy / d : f.uy;
        const s = STOMP * (1 - (d / touch) * 0.6) * clamp(me.m / o.m, 0.3, 1.6);
        o.vx += nx * s;
        o.vy += ny * s;
        me.vx *= 0.35;
        me.vy *= 0.35;
        o.src = f.by;
        hit.add(o.id);
        fx.push({ k: 'stomp', t, x: r2(o.x), y: r2(o.y) });
      }
    }
    live.push(me);
  };

  let next = 0;
  let steps = 0;
  for (steps = 0; steps <= MAX_STEPS; steps++) {
    const t = t0 + steps * STEP;
    while (next < flyers.length && flyers[next].d + flyers[next].fly <= t + 1e-6) landOne(flyers[next++]);
    if (steps > 0) {
      for (const b of live) {
        if (b.off || (!b.vx && !b.vy)) continue;
        b.vx *= b.decay;
        b.vy *= b.decay;
        if (Math.hypot(b.vx, b.vy) < STOP) {
          b.vx = 0;
          b.vy = 0;
          continue;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
    }
    for (let i = 0; i < live.length; i++) {
      if (live[i].off) continue;
      for (let j = i + 1; j < live.length; j++) if (!live[j].off) collide(live[i], live[j], fx, hit, t);
    }
    for (const b of live) {
      if (b.off || Math.hypot(b.x, b.y) <= R) continue;
      b.off = true;
      b.ot = Math.round(t);
      fx.push({ k: 'off', t: Math.round(t), x: r2(b.x), y: r2(b.y), id: b.id, by: b.src || null });
    }
    if (steps > 0 && steps % SAMPLE === 0) sample(steps / SAMPLE);
    if (next >= flyers.length && !live.some(b => !b.off && (b.vx || b.vy))) break;
  }
  if (steps % SAMPLE) sample(Math.ceil(steps / SAMPLE));

  for (const id of shooters) hit.delete(id);
  const dur = Math.round(t0 + steps * STEP);
  const all = [...live, ...splashed];
  for (const b of all) if (shooters.has(b.id) && !b.off && Math.hypot(b.x, b.y) < BULL_R) fx.push({ k: 'bull', t: dur, x: r2(b.x), y: r2(b.y), id: b.id });
  const out = b => ({ id: b.id, by: b.by, x: r2(b.x), y: r2(b.y), ...(b.k && b.k !== 'normal' ? { k: b.k } : {}), ...(b.off ? { off: 1, ot: b.ot } : {}) });
  const moved = new Map(all.map(b => [b.id, b]));
  return {
    flyers: flyers.map(f => ({ id: f.id, by: f.by, a: r3(f.a), d: f.d, fly: f.fly, land: [r2(f.x), r2(f.y)] })),
    dur,
    tracks: [...tracks.values()].map(({ id, s, d }) => ({ id, s, d })),
    fx,
    after: [...others.map(b => (moved.has(b.id) ? out(moved.get(b.id)) : b)), ...flyers.map(f => out(moved.get(f.id)))],
    hit: [...hit],
    src: Object.fromEntries(all.filter(b => b.src && b.src !== b.by).map(b => [b.id, b.src])),
  };
}

// 한 발만 쏠 때
export function simulateShot({ bodies, shooter, owner = shooter, kind, angle, power, R, wind, record }) {
  const sim = simulateShots({ bodies, shots: [{ shooter, owner, kind, angle, power }], wind, R, record });
  return { ...sim, land: sim.flyers[0].land, fly: sim.flyers[0].fly };
}

// 내 자리 = 내 말 중 제일 안쪽 말까지의 거리 (판 위에 말이 하나도 없으면 -1)
function distOf(bodies, pid) {
  const ds = (bodies || []).filter(b => b.by === pid && !b.off).map(b => Math.hypot(b.x, b.y));
  return ds.length ? r2(Math.min(...ds)) : -1;
}

// 이번 라운드 독박: 말이 다 장외인 사람 전부 + 모자라면 제일 바깥부터 cut명까지. 전원 장외면 [] (무효)
export function losersOf(bodies, ids, cut) {
  const off = ids.filter(id => distOf(bodies, id) < 0);
  if (off.length >= ids.length) return [];
  const rest = ids.filter(id => distOf(bodies, id) >= 0).sort((a, b) => distOf(bodies, b) - distOf(bodies, a));
  return [...off, ...rest.slice(0, Math.max(0, cut - off.length))];
}

/* ───────── 진행 (방장) ───────── */

function aimTiming(S) {
  const r = S.round;
  return { swingMs: Math.max(1500, 2400 - (r - 1) * 180), gaugeMs: Math.max(700, 1100 - (r - 1) * 70) };
}

// 1바퀴: 한 명씩
function beginAim(S, now) {
  const pid = S.order[S.idx];
  Object.assign(S, {
    phase: 'angle',
    turn: pid,
    stone: `${pid}:1`,
    kind: pickKind(),
    wind: pickWind(),
    aimNo: (S.aimNo || 0) + 1,
    swingAt: now,
    swingP: r2(Math.random()),
    chargeAt: 0,
    angle: 0,
    power: 0,
    shot: null,
    phaseEndsAt: now + ANGLE_TIME,
    ...aimTiming(S),
  });
  return true;
}

// 2바퀴: 🎆 일제 발사. 모두 동시에 조준하고, 다 쏘면 한꺼번에 날아간다
function beginVolley(S, now) {
  Object.assign(S, {
    phase: 'volley',
    turn: null,
    aimNo: (S.aimNo || 0) + 1,
    kinds: Object.fromEntries(S.order.map(id => [id, pickKind()])),
    phases: Object.fromEntries(S.order.map(id => [id, r2(Math.random())])), // 사람마다 대포가 다르게 흔들린다
    aims: {},
    wind: pickWind(),
    swingAt: now,
    shot: null,
    phaseEndsAt: now + VOLLEY_TIME,
    ...aimTiming(S),
  });
  return true;
}

function startRound(S, now) {
  S.round += 1;
  Object.assign(S, { R: plateOf(S.alive.length), bodies: [], idx: 0, hitBy: {}, judge: null, lap2: false });
  return beginAim(S, now);
}

function lock(S, now, t) {
  Object.assign(S, { angle: angleAt(t, S.swingMs, S.swingP), phase: 'power', chargeAt: 0, phaseEndsAt: now + POWER_TIME });
  return true;
}

// 계산해서 시각표를 상태에 싣는다
function launch(ctx, now, shots) {
  const S = ctx.state;
  const sim = simulateShots({ bodies: S.bodies, shots, wind: S.wind, R: S.R });
  const no = (S.shotNo || 0) + 1;
  const at = now + SHOT_LEAD;
  S.bodies = sim.after.map(b => (b.off && b.ot != null && b.sn == null ? { ...b, sn: no } : b));
  const blamed = Object.entries(sim.src).map(([stone, by]) => [ownerOf(stone), by]);
  if (blamed.length) S.hitBy = { ...(S.hitBy || {}), ...Object.fromEntries(blamed) };
  for (const f of sim.flyers) {
    const mine = sim.after.find(b => b.id === f.id);
    if (mine.off) S.selfOff ||= f.by;
    else {
      const d = r2(Math.hypot(mine.x, mine.y));
      if (!S.best || d < S.best.d) S.best = { id: f.by, d };
    }
  }
  Object.assign(S, {
    phase: 'shot',
    shotNo: no,
    phaseEndsAt: at + sim.dur + SHOT_REST,
    shot: { no, at, dur: sim.dur, flyers: sim.flyers, tracks: sim.tracks, fx: sim.fx },
  });
  return true;
}

function fire(ctx, now, power) {
  const S = ctx.state;
  S.power = r3(power);
  return launch(ctx, now, [{ shooter: S.stone, owner: S.turn, kind: S.kind, angle: S.angle, power }]);
}

function fireVolley(ctx, now) {
  const S = ctx.state;
  const aims = S.aims || {};
  const shots = shuffle(S.order).map((id, i) => {
    const m = aims[id] || {};
    return {
      shooter: `${id}:2`, owner: id, kind: S.kinds[id], delay: i * VOLLEY_GAP,
      angle: m.a ?? angleAt(now - S.swingAt, S.swingMs, S.phases[id]),
      power: m.pw ?? (m.c ? powerOf(now - m.c, S.gaugeMs) : AFK_POWER),
    };
  });
  S.lap2 = true;
  return launch(ctx, now, shots);
}

function judge(ctx, now) {
  const S = ctx.state;
  const bodies = S.bodies || [];
  const ids = S.order;
  const losers = losersOf(bodies, ids, ids.length >= 6 ? 2 : 1);
  const dist = Object.fromEntries(ids.map(id => [id, distOf(bodies, id)]));
  S.lives = { ...S.lives };
  const dying = [];
  for (const id of losers) {
    S.lives[id] -= 1;
    if (S.lives[id] <= 0) dying.push(id);
  }
  S.alive = S.alive.filter(id => !dying.includes(id));
  S.outOrder = [...(S.outOrder || []), ...dying];
  S.dead = { ...(S.dead || {}) };
  for (const id of dying) {
    const by = S.hitBy?.[id];
    if (by && by !== id) {
      ctx.kill(by, id, dist[id] < 0 ? '🎪 장외 홈런' : '🎯 밀어내기');
      S.kills = { ...(S.kills || {}), [by]: (S.kills?.[by] || 0) + 1 };
      S.dead[id] = by;
    } else {
      ctx.announce(`🎪 ${ctx.nameOf(id)} 독박!`);
      S.dead[id] = '-';
    }
  }
  Object.assign(S, {
    phase: 'judge',
    phaseEndsAt: now + JUDGE_TIME,
    judge: { losers, dying, dist, void: losers.length ? 0 : 1 },
    nextOrder: shuffle(ids.filter(id => S.alive.includes(id))), // 순서는 라운드마다 랜덤
  });
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const placement = [...S.alive, ...[...(S.outOrder || [])].reverse()];
  for (const p of S.roster || ctx.roster) if (!placement.includes(p.id)) placement.push(p.id);
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  if (placement[0]) add(placement[0], '🎪 인간대포 왕');
  const [killer, kills] = Object.entries(S.kills || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (kills >= 1) add(killer, `💥 장외 홈런왕 (${kills}킬)`);
  if (S.best && S.best.d < 1) add(S.best.id, `🎯 정중앙 (${S.best.d.toFixed(1)}m)`);
  if (S.selfOff) add(S.selfOff, '🫠 혼자 풍덩');
  Object.assign(S, { placement, standings: Object.fromEntries(placement.map((id, i) => [id, placement.length - i])), titles, phase: 'final', over: true });
  return true;
}

/* ───────── 봇 ───────── */

// 후보를 물리로 다 돌려 보고 제일 좋은 샷을 고른다: 내 자리가 가운데에 가깝고, 친구 자리가 밖으로 밀릴수록 좋다
export function planShot(S, id, { stone, kind }, rand = Math.random) {
  const bodies = S.bodies || [];
  const place = (list, pid) => {
    const d = distOf(list, pid);
    return d < 0 ? 15 : d;
  };
  const owners = [...new Set(bodies.map(b => b.by))].filter(p => p !== id);
  let best = { a: 0, p: 0.5, score: -Infinity };
  for (let a = -A_MAX * 0.7; a <= A_MAX * 0.7 + 1e-9; a += A_MAX * 0.14) {
    for (let p = 0.3; p <= 0.7 + 1e-9; p += 0.05) {
      const sim = simulateShots({ bodies, shots: [{ shooter: stone, owner: id, kind, angle: a, power: p }], wind: S.wind, R: S.R, record: false });
      let score = -place(sim.after, id);
      if (sim.after.find(b => b.id === stone).off) score -= 3;
      for (const o of owners) score += (place(sim.after, o) - place(bodies, o)) * 0.6;
      score += rand() * 0.3; // 봇마다 고르는 샷이 갈리게
      if (score > best.score) best = { a, p, score };
    }
  }
  return best;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}

export default {
  id: 'cannon',
  title: '인간대포 컬링',
  emoji: '🎪',
  tag: '우정파괴',
  color: '#d9480f',
  desc: '대포로 나를 쏴서 과녁에 착지! 1바퀴는 돌아가며, 2바퀴는 다 같이 일제 발사. 바람을 읽고 제일 안쪽에 남으세요',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx, prev) {
    const ids = shuffle(ctx.roster.map(p => p.id));
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + INTRO_TIME,
      again: !!prev,
      alive: ids,
      order: ids,
      lives: Object.fromEntries(ids.map(id => [id, livesOf(ids.length)])),
      round: 0,
      idx: 0,
      R: plateOf(ids.length),
      bodies: [],
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    const now = ctx.now();
    if (data.no !== S.aimNo) return false;
    // 누른 시각은 각자 노트북이 잰 값을 쓰되, 도착 시각에서 너무 벗어나면 그만큼까지만 믿는다
    const lockTime = () => {
      const rel = now - S.swingAt;
      let t = Math.round(Number(data.t));
      if (!Number.isFinite(t)) t = rel;
      return Math.min(rel + 100, Math.max(0, t, rel - MAX_LAG));
    };
    if (S.phase === 'volley') {
      if (!S.order.includes(pid)) return false;
      const m = S.aims?.[pid] || {};
      if (m.pw != null) return false;
      let next = null;
      if (type === 'lock' && m.a == null) next = { a: angleAt(lockTime(), S.swingMs, S.phases[pid]) };
      else if (type === 'charge' && m.a != null && !m.c) next = { c: now };
      else if (type === 'fire' && m.c) next = { pw: powerOf(clamp(Math.round(Number(data.hold)) || 0, 0, now - m.c + MAX_LAG), S.gaugeMs) };
      if (!next) return false;
      S.aims = { ...(S.aims || {}), [pid]: { ...m, ...next } };
      return true;
    }
    if (pid !== S.turn) return false;
    if (type === 'lock' && S.phase === 'angle') return lock(S, now, lockTime());
    if (type === 'charge' && S.phase === 'power' && !S.chargeAt) {
      S.chargeAt = now; // 다른 사람 화면에도 힘이 차오르게
      return true;
    }
    if (type === 'fire' && S.phase === 'power' && S.chargeAt) {
      // 꾹 누른 시간은 각자 노트북이 잰다 (와이파이가 느려도 공정). 도착 시각보다 너무 긴 값은 그만큼까지만 믿는다
      const hold = clamp(Math.round(Number(data.hold)) || 0, 0, now - S.chargeAt + MAX_LAG);
      return fire(ctx, now, powerOf(hold, S.gaugeMs));
    }
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    switch (S.phase) {
      case 'intro':
        return now >= S.phaseEndsAt && startRound(S, now);
      case 'angle': // 시간 끝이거나 나간 사람: 지금 각도 그대로
        if (now < S.phaseEndsAt && ctx.isOnline(S.turn)) return false;
        return lock(S, now, now - S.swingAt);
      case 'power':
        if (S.chargeAt) { // 다 찬 뒤에도 계속 누르고 있거나 나간 사람: 지금 힘 그대로
          if (now < S.chargeAt + S.gaugeMs + OVERHOLD && ctx.isOnline(S.turn)) return false;
          return fire(ctx, now, powerOf(now - S.chargeAt, S.gaugeMs));
        }
        if (now < S.phaseEndsAt && ctx.isOnline(S.turn)) return false;
        return fire(ctx, now, AFK_POWER);
      case 'volley': {
        let changed = false;
        for (const id of S.order) { // 너무 오래 누르고 있으면 힘 1로 확정
          const m = S.aims?.[id];
          if (m?.c && m.pw == null && now >= m.c + S.gaugeMs + OVERHOLD) {
            S.aims = { ...S.aims, [id]: { ...m, pw: 1 } };
            changed = true;
          }
        }
        const ready = S.order.every(id => S.aims?.[id]?.pw != null || !ctx.isOnline(id));
        return ready || now >= S.phaseEndsAt ? fireVolley(ctx, now) : changed;
      }
      case 'shot':
        if (now < S.phaseEndsAt) return false;
        if (S.lap2) return judge(ctx, now);
        S.idx += 1;
        return S.idx >= S.order.length ? beginVolley(S, now) : beginAim(S, now);
      case 'judge':
        if (now < S.phaseEndsAt) return false;
        if (S.alive.length <= 1) return finish(ctx);
        S.order = S.nextOrder?.length ? S.nextOrder : S.alive;
        return startRound(S, now);
      default:
        return false;
    }
  },

  // 봇: 물리로 고른 각도가 오는 순간을 노려 누르고, 고른 힘만큼 꾹 누른다 (사람처럼 0.04~0.1초 빗나감)
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    const volley = S.phase === 'volley';
    const mine = volley ? S.aims?.[id] : null;
    if (volley ? !S.order.includes(id) || mine?.pw != null : S.turn !== id || (S.phase !== 'angle' && S.phase !== 'power')) return null;
    if (mem.no !== S.aimNo) Object.assign(mem, { no: S.aimNo, plan: planShot(S, id, volley ? { stone: `${id}:2`, kind: S.kinds[id] } : { stone: S.stone, kind: S.kind }), ph: null });
    mem.skill ??= 40 + Math.random() * 60;
    const data = { no: S.aimNo };
    if (volley ? mine?.a == null : S.phase === 'angle') {
      if (mem.ph !== 'angle') {
        mem.ph = 'angle';
        const swingP = volley ? S.phases[id] : S.swingP;
        const wait = 400 + Math.random() * 800;
        let best = wait;
        let err = Infinity;
        for (let t = wait; t < wait + S.swingMs; t += 5) {
          const e = Math.abs(angleAt(t, S.swingMs, swingP) - mem.plan.a);
          if (e < err) [err, best] = [e, t];
        }
        mem.at = S.swingAt + best + gauss() * mem.skill; // 틱 시각이 아니라 노린 시각을 보낸다
      }
      if (now < mem.at) return null;
      return { type: 'lock', data: { ...data, t: Math.round(mem.at - S.swingAt) } };
    }
    if (mem.ph !== 'power') Object.assign(mem, { ph: 'power', at: now + 250 + Math.random() * 450 });
    const chargeAt = volley ? mine?.c : S.chargeAt;
    if (!chargeAt) {
      if (now < mem.at) return null;
      mem.hold = Math.max(0, mem.plan.p * S.gaugeMs + gauss() * mem.skill);
      return { type: 'charge', data };
    }
    if (now < chargeAt + mem.hold) return null;
    return { type: 'fire', data: { ...data, hold: Math.round(mem.hold) }, say: Math.random() < 0.08 };
  },

  mount(root, api) {
    const me = api.me;
    const top = h('div', { class: 'bc-top' });
    const plateG = svg('g');
    const dock = svg('rect', { class: 'hc-dock', rx: 0.35 });
    const aimLine = svg('line', { class: 'hc-aim' });
    const bodiesG = svg('g');
    const shadowsG = svg('g');
    const flyG = svg('g');
    const fxG = svg('g');
    const loaded = svg('g');
    const barrel = svg('g', {},
      svg('rect', { class: 'hc-tube', x: -0.9, y: -0.62, width: 2.5, height: 1.24, rx: 0.42 }),
      svg('rect', { class: 'hc-band', x: 0.1, y: -0.64, width: 0.34, height: 1.28 }),
      svg('rect', { class: 'hc-mouth', x: 1.42, y: -0.74, width: 0.32, height: 1.48, rx: 0.14 }),
      loaded);
    const cannon = svg('g', {},
      svg('circle', { class: 'hc-wheel', cx: -0.2, cy: -1, r: 0.46 }),
      svg('circle', { class: 'hc-wheel', cx: -0.2, cy: 1, r: 0.46 }),
      barrel);
    const finsG = svg('g', { class: 'hc-fins' });
    const stage = svg('svg', { class: 'bc-svg hc-svg', preserveAspectRatio: 'xMidYMid meet' },
      svg('rect', { class: 'hc-water', x: -40, y: -40, width: 80, height: 80 }),
      finsG, plateG, dock, aimLine, bodiesG, cannon, shadowsG, flyG, fxG);
    const flashes = h('div', { class: 'bc-fx' });
    const windArrow = h('i', { class: 'hc-wind-arrow' }, '➤');
    const windLabel = h('span');
    const windBox = h('div', { class: 'hc-wind' }, '🌬️', windArrow, windLabel);
    const panel = h('div', { class: 'bc-panel' });
    const stageBox = h('div', { class: 'bc-stage' }, stage, windBox, flashes);
    const box = h('div', { class: 'bc-box' }, top, stageBox, panel);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'bc hc' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    const views = new Map();     // 말 id → { g, spin, cry, tag, shadow }
    let tracks = new Map();
    let flyMap = new Map();
    let tracksOf = 0;
    let fxOf = 0;
    let fxI = 0;
    let plateKey = '';
    let loadedKey = '';
    let topKey = '';
    let panelKey = '';
    let sideKey = '';
    let localLock = null;        // 내가 누른 각도 (방장 답이 오기 전에도 바로 멈춘다)
    let localFire = null;        // 내가 뗀 순간의 힘
    let charging = null;         // 스페이스를 꾹 누르는 중 { no, t0 }
    let volleyFlash = 0;
    let judgeSeen = 0;
    let seenKind = 0;
    let reelI = -1;
    let lastPuff = 0;
    let helpText = '';
    let refs = {};
    const kindBadge = svg('text', { class: 'hc-kind', x: 0.55, y: 0.55 });
    const timers = new Set();
    const later = (fn, ms) => {
      const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id);
    };
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const aiming = () => S.phase === 'angle' || S.phase === 'power';
    const inVolley = () => S.phase === 'volley';
    const inOrder = () => (S.order || []).includes(me);
    const myKind = () => (inVolley() ? S.kinds?.[me] : S.kind);
    const mySwing = () => (inVolley() ? S.phases?.[me] ?? 0 : S.swingP);

    // 지금 내가 할 일: 'angle' · 'power' · null (일제 발사면 각자, 아니면 내 차례일 때만)
    function myStep() {
      if (inVolley()) {
        if (!inOrder()) return null;
        const m = S.aims?.[me];
        if (m?.pw != null || localFire?.no === S.aimNo) return null;
        return m?.a != null || localLock?.no === S.aimNo ? 'power' : 'angle';
      }
      return aiming() && S.turn === me ? S.phase : null;
    }

    // 스페이스를 떼는 순간 발사 (채팅을 열거나 다른 창으로 가도 뗀 걸로)
    function release() {
      if (!charging) return;
      const hold = Math.round(performance.now() - charging.t0);
      if ((S.phase === 'power' || inVolley()) && S.aimNo === charging.no) {
        localFire = { no: charging.no, p: powerOf(hold, S.gaugeMs) };
        api.send('fire', { no: charging.no, hold });
      }
      charging = null;
    }

    function onKey(e) {
      if (!S || e.code !== 'Space') return;
      if (e.type === 'keyup') {
        release();
        return;
      }
      if (isTyping(e)) return;
      e.preventDefault(); // 스페이스로 페이지가 스크롤되지 않게
      if (e.repeat) return;
      const step = myStep();
      if (step === 'angle' && localLock?.no !== S.aimNo) {
        const t = Math.round(api.now() - S.swingAt);
        localLock = { no: S.aimNo, a: angleAt(t, S.swingMs, mySwing()) };
        api.send('lock', { no: S.aimNo, t });
      } else if (step === 'power' && !charging && !(inVolley() ? S.aims?.[me]?.c : S.chargeAt)) {
        charging = { no: S.aimNo, t0: performance.now() };
        api.send('charge', { no: S.aimNo });
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', release);

    function faceOf(id, size) {
      const g = svg('g');
      g.innerHTML = avatar(who(id)).innerHTML;
      const f = g.firstElementChild;
      if (f) for (const [k, v] of Object.entries({ x: -size / 2, y: -size / 2, width: size, height: size })) f.setAttribute(k, v);
      return g;
    }

    function bodyView(b) {
      const pid = b.by;
      const kind = KINDS[b.k] || KINDS.normal;
      const special = b.k && b.k !== 'normal';
      const r = BODY_R * (kind.size || 1);
      const spin = svg('g', {}, svg('circle', { class: `hc-ring${special ? ` hc-${b.k}` : ''}`, r }), faceOf(pid, r * 1.84));
      const badge = special ? svg('text', { class: 'hc-kind', x: r * 0.72, y: r * 0.72 }, kind.emoji) : null;
      const name = svg('text', { class: `bc-name${pid === me ? ' me' : ''}`, y: -(r + 0.3) }, pid === me ? '나' : who(pid).name);
      const cry = svg('text', { class: 'hc-cry', y: -(r + 1.1) });
      const tag = svg('text', { class: 'hc-tag', x: -r * 0.9, y: -r * 0.6 });
      const g = svg('g', { class: `hc-body${pid === me ? ' mine' : ''}` }, spin, badge, name, cry, tag);
      const shadow = svg('ellipse', { class: 'hc-shadow', rx: r, ry: r * 0.8 });
      shadow.style.display = 'none';
      bodiesG.append(g);
      shadowsG.append(shadow);
      return { g, spin, cry, tag, shadow, hitUntil: 0 };
    }

    function layoutPlate() {
      const key = String(S.R);
      if (key === plateKey) return;
      plateKey = key;
      const R = S.R;
      const D = R + GAP;
      stage.setAttribute('viewBox', `${-D - 2.6} ${-R - 1.7} ${D + 2.6 + R + 1.9} ${2 * R + 3.4}`);
      plateG.replaceChildren(
        svg('circle', { class: 'hc-edge', r: R + 0.24 }),
        svg('circle', { class: 'hc-a', r: R }),
        svg('circle', { class: 'hc-b', r: R * 0.75 }),
        svg('circle', { class: 'hc-a', r: R * 0.5 }),
        svg('circle', { class: 'hc-b', r: R * 0.25 }),
        svg('circle', { class: 'hc-bull', r: 0.36 }));
      for (const [k, v] of Object.entries({ x: -D - 1.8, y: -1.9, width: 3.8, height: 3.8 })) dock.setAttribute(k, v);
      cannon.setAttribute('transform', `translate(${-D} 0)`);
      finsG.replaceChildren( // 물속에서 빙빙 도는 상어 (장외 = 상어밥)
        svg('text', { class: 'hc-fin', x: R + 1, y: 0 }, '🦈'),
        svg('text', { class: 'hc-fin', x: -(R + 1), y: 0 }, '🦈'),
        svg('text', { class: 'hc-fin', x: 0, y: R + 0.9 }, '🦈'));
    }

    function syncBodies() {
      const live = new Set();
      for (const b of S.bodies || []) {
        live.add(b.id);
        if (!views.has(b.id)) views.set(b.id, bodyView(b));
      }
      for (const [id, v] of views) {
        if (live.has(id)) continue;
        v.g.remove();
        v.shadow.remove();
        views.delete(id);
      }
      if (S.shot && tracksOf !== S.shot.no) {
        tracksOf = S.shot.no;
        tracks = new Map((S.shot.tracks || []).map(t => [t.id, t]));
        flyMap = new Map((S.shot.flyers || []).map(f => [f.id, f]));
      }
    }

    function markBodies() {
      const done = aiming() ? (S.order || []).slice(0, S.idx || 0) : [];
      const cut = (S.order || []).length >= 6 ? 2 : 1;
      const danger = new Set(done.length > cut ? losersOf(S.bodies || [], done, cut) : []);
      const losers = new Set(S.phase === 'judge' ? S.judge?.losers || [] : []);
      for (const b of S.bodies || []) {
        const v = views.get(b.id);
        if (!v) continue;
        v.g.classList.toggle('danger', danger.has(b.by));
        v.g.classList.toggle('loser', losers.has(b.by));
        v.tag.textContent = danger.has(b.by) ? '😱' : '';
      }
    }

    function trackPos(tr, t) {
      const n = tr.d.length / 2;
      const k = clamp((t - tr.s) / SAMPLE_MS, 0, n - 1);
      const i = Math.min(n - 2, Math.floor(k));
      if (i < 0) return [tr.d[0], tr.d[1]];
      const f = k - i;
      return [tr.d[2 * i] + (tr.d[2 * i + 2] - tr.d[2 * i]) * f, tr.d[2 * i + 1] + (tr.d[2 * i + 3] - tr.d[2 * i + 1]) * f];
    }

    function paint() {
      if (!S) return;
      const now = api.now();
      const sh = S.phase === 'shot' || S.phase === 'judge' ? S.shot : null;
      const t = sh ? now - sh.at : 0;
      const D = S.R + GAP;
      const step = myStep();
      // 대포: 일제 발사 때는 내 대포만 보인다 (남의 조준은 비밀)
      let a = 0;
      if (S.phase === 'angle') a = localLock?.no === S.aimNo ? localLock.a : angleAt(now - S.swingAt, S.swingMs, S.swingP);
      else if (S.phase === 'power') a = S.angle;
      else if (inVolley() && inOrder()) {
        const m = S.aims?.[me];
        if (localLock?.no === S.aimNo) a = localLock.a;
        else if (m?.a != null) a = m.a;
        else a = angleAt(now - S.swingAt, S.swingMs, mySwing());
      } else if (S.phase === 'shot' && sh) {
        a = sh.flyers[clamp(Math.floor(t / VOLLEY_GAP), 0, sh.flyers.length - 1)].a;
      }
      const recoil = S.phase === 'shot' && t >= 0 && t < 180 ? -0.4 * (1 - t / 180) : 0;
      barrel.setAttribute('transform', `rotate(${deg(a).toFixed(2)}) translate(${recoil.toFixed(2)} 0)`);
      loaded.setAttribute('transform', `translate(${MUZZLE} 0) rotate(${(-deg(a)).toFixed(2)})`);
      loaded.style.display = aiming() || (inVolley() && inOrder()) || (S.phase === 'shot' && t < 0) ? '' : 'none';
      // 조준선은 방향만 짧게: 어디에 떨어질지는 내 감으로
      const showLine = aiming() || (inVolley() && !!step);
      aimLine.style.display = showLine ? '' : 'none';
      if (showLine) {
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const line = { x1: -D + ux * MUZZLE, y1: uy * MUZZLE, x2: -D + ux * (MUZZLE + 3), y2: uy * (MUZZLE + 3) };
        for (const [k, v] of Object.entries(line)) aimLine.setAttribute(k, v.toFixed(2));
      }
      // 힘 막대
      if (refs.gauge) {
        let p = 0;
        if (localFire?.no === S.aimNo) p = localFire.p;
        else if (charging?.no === S.aimNo) p = powerOf(performance.now() - charging.t0, S.gaugeMs);
        else if (S.phase === 'power' && S.chargeAt) p = powerOf(now - S.chargeAt, S.gaugeMs);
        refs.gauge.style.transform = `scaleX(${p})`;
        refs.gauge.parentNode.classList.toggle('full', p >= 1);
      }
      if (refs.help) {
        const text = step === 'angle' ? '스페이스 톡 = 각도 멈추기' : step === 'power' ? '스페이스 꾹 = 힘 모으기 · 떼면 발사' : '✓ 발사 준비 끝! 기다리는 중';
        if (text !== helpText) {
          helpText = text;
          refs.help.textContent = text;
        }
      }
      paintReel(now);
      // 사람들
      for (const b of S.bodies || []) {
        const v = views.get(b.id);
        if (!v) continue;
        const fl = sh ? flyMap.get(b.id) : null;
        if (fl && t < fl.d + fl.fly) {
          if (t < fl.d) {
            v.g.style.display = 'none';
            v.shadow.style.display = 'none';
            continue;
          }
          const f = (t - fl.d) / fl.fly;
          const sx = -D + Math.cos(fl.a) * MUZZLE;
          const sy = Math.sin(fl.a) * MUZZLE;
          const x = sx + (fl.land[0] - sx) * f;
          const y = sy + (fl.land[1] - sy) * f;
          const up = Math.sin(Math.PI * f);
          if (v.g.parentNode !== flyG) {
            flyG.append(v.g);
            v.cry.textContent = pick(CRIES);
          }
          v.g.style.display = '';
          v.g.style.opacity = 1;
          v.cry.style.display = '';
          v.g.setAttribute('transform', `translate(${x.toFixed(2)} ${(y - up * 3.2).toFixed(2)}) scale(${(1 + up * 1.1).toFixed(2)})`);
          v.spin.setAttribute('transform', `rotate(${(f * 1080).toFixed(0)})`);
          v.shadow.style.display = '';
          v.shadow.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(1 - up * 0.4).toFixed(2)})`);
          if (performance.now() - lastPuff > 70) { // 날아가는 자리에 연기
            lastPuff = performance.now();
            const smoke = svg('circle', { class: 'hc-puff', cx: x.toFixed(2), cy: (y - up * 3.2).toFixed(2), r: 0.4 });
            fxG.append(smoke);
            later(() => smoke.remove(), 520);
          }
          continue;
        }
        v.shadow.style.display = 'none';
        if (v.g.parentNode !== bodiesG) bodiesG.append(v.g);
        v.spin.removeAttribute('transform');
        v.cry.style.display = 'none';
        let scale = 1;
        let opacity = 1;
        if (b.off) {
          if (!sh || b.sn !== sh.no || t >= b.ot + 500) {
            v.g.style.display = 'none';
            continue;
          }
          if (t >= b.ot) {
            const e = (t - b.ot) / 500;
            scale = 1 - e * 0.85;
            opacity = 1 - e * 0.8;
          }
        }
        const tr = sh ? tracks.get(b.id) : null;
        const [x, y] = tr ? trackPos(tr, t) : [b.x, b.y];
        // 착지·충돌 때 납작해졌다 돌아온다
        let sx = scale;
        let sy = scale;
        const clockNow = performance.now();
        if (fl && t >= fl.d + fl.fly && t < fl.d + fl.fly + 240) {
          const q = Math.sin(((t - fl.d - fl.fly) / 240) * Math.PI) * 0.32;
          sx *= 1 + q;
          sy *= 1 - q;
        } else if (v.hitUntil > clockNow) {
          const q = Math.sin(((v.hitUntil - clockNow) / 240) * Math.PI) * 0.24;
          sx *= 1 - q;
          sy *= 1 + q;
        }
        v.g.style.display = '';
        v.g.style.opacity = opacity;
        v.g.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${sx.toFixed(2)} ${sy.toFixed(2)})`);
      }
      playFx(sh, t);
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function flash(text, cls = '') {
      const el = h('div', { class: `bc-flash ${cls}` }, text);
      flashes.append(el);
      later(() => el.remove(), 1500);
    }
    function shake() {
      box.classList.remove('bc-impact-shake');
      void box.offsetWidth;
      box.classList.add('bc-impact-shake');
      later(() => box.classList.remove('bc-impact-shake'), 220);
    }
    function ring(e, cls) {
      const el = svg('g', { transform: `translate(${e.x} ${e.y})` }, svg('circle', { class: cls, r: 0.8 }));
      fxG.append(el);
      later(() => el.remove(), 620);
    }
    function burst(e, text) {
      const el = svg('g', { transform: `translate(${e.x} ${e.y})` }, svg('text', { class: 'bc-spark hc-big' }, text));
      fxG.append(el);
      later(() => el.remove(), 600);
    }
    function comic(e, text, big = false) {
      const el = svg('g', { transform: `translate(${e.x} ${e.y})` }, svg('text', { class: `hc-comic${big ? ' big' : ''}` }, text));
      fxG.append(el);
      later(() => el.remove(), 680);
    }
    function rays(e, n, len) {
      const el = svg('g', { transform: `translate(${e.x} ${e.y})`, class: 'bc-collision' });
      for (let i = 0; i < n; i++) {
        const a = (i * Math.PI * 2) / n;
        const l = len + (i % 3) * 0.2;
        el.append(svg('line', { class: 'bc-impact-ray', x1: Math.cos(a) * 0.2, y1: Math.sin(a) * 0.2, x2: Math.cos(a) * l, y2: Math.sin(a) * l }));
      }
      fxG.append(el);
      later(() => el.remove(), 650);
    }
    function dust(e, n, spread) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const smoke = svg('circle', { class: 'hc-puff', cx: e.x + Math.cos(a) * spread, cy: e.y + Math.sin(a) * spread, r: 0.45 });
        fxG.append(smoke);
        later(() => smoke.remove(), 520);
      }
    }
    function whiteFlash() {
      const el = h('div', { class: 'hc-white' });
      stageBox.append(el);
      later(() => el.remove(), 320);
    }
    const wobble = id => {
      const v = views.get(id);
      if (v) v.hitUntil = performance.now() + 240;
    };

    // 룰렛: 조준이 시작되고 0.7초 동안 돌다가 이번 샷의 정체를 보여 준다
    function paintReel(now) {
      if (!aiming() && !(inVolley() && inOrder())) {
        kindBadge.textContent = '';
        return;
      }
      const shown = S.phase === 'power' || now >= S.swingAt + REEL_MS;
      const k = myKind();
      const kind = KINDS[k] || KINDS.normal;
      if (!shown) {
        const i = Math.floor(now / 70) % KIND_KEYS.length;
        if (i !== reelI) {
          reelI = i;
          if (refs.reel) refs.reel.textContent = `🎰 ${KINDS[KIND_KEYS[i]].emoji}`;
          kindBadge.textContent = KINDS[KIND_KEYS[i]].emoji;
        }
        return;
      }
      kindBadge.textContent = k === 'normal' ? '' : kind.emoji;
      if (refs.reel && !refs.revealed) {
        refs.revealed = true;
        refs.reel.textContent = k === 'normal' ? `${kind.emoji} 기본` : `${kind.emoji} ${kind.name}! ${kind.tip}`;
        refs.reel.classList.add('done');
      }
      if (seenKind !== S.aimNo) {
        seenKind = S.aimNo;
        if (k !== 'normal' && S.phase !== 'power') flash(`${kind.emoji} ${kind.name} 당첨!`, k === 'giant' ? 'clash' : '');
      }
    }

    // 시각표에 적힌 효과를 그 시각에 터뜨린다
    function playFx(sh, t) {
      if (!sh) return;
      if (fxOf !== sh.no) {
        fxOf = sh.no;
        fxI = 0;
      }
      const list = sh.fx || [];
      const nameOf = id => who(ownerOf(id)).name;
      while (fxI < list.length && list[fxI].t <= t) {
        const e = list[fxI++];
        if (e.k === 'fire') {
          const m = { x: -(S.R + GAP) + Math.cos(e.a) * (MUZZLE + 0.6), y: Math.sin(e.a) * (MUZZLE + 0.6) };
          ring(m, 'bc-shock-ring clash');
          rays(m, 9, 1.5);
          comic({ x: m.x, y: m.y - 1 }, '펑!', true);
          dust(m, 6, 0.9);
          shake();
        } else if (e.k === 'land') {
          ring(e, 'bc-shock-ring');
          dust(e, 7, 0.9);
          comic({ x: e.x, y: e.y - 1.2 }, '착!');
        } else if (e.k === 'stomp') {
          ring(e, 'bc-shock-ring clash');
          rays(e, 12, 2);
          comic({ x: e.x, y: e.y - 1.2 }, '쿵!!', true);
          flash('쿵! 머리 위로 착지', 'clash');
          shake();
        } else if (e.k === 'blast') {
          ring(e, 'bc-shock-ring clash');
          ring(e, 'bc-shock-ring second');
          rays(e, 18, 4);
          comic(e, '콰광!!', true);
          dust(e, 12, 2.2);
          whiteFlash();
          flash(`💣 ${nameOf(e.id)} 폭발!`, 'bad');
          shake();
        } else if (e.k === 'hit') {
          ring(e, 'bc-shock-ring');
          rays(e, 8, e.p > 4 ? 1.8 : 1.1);
          wobble(e.a);
          wobble(e.b);
          comic({ x: e.x, y: e.y - 0.9 }, pick(['빡!', '퍽!', '텅!', '쾅!']), e.p > 5);
          if (e.p > 3) shake();
        } else if (e.k === 'splash') {
          burst(e, '💦');
          later(() => burst(e, '🦈'), 320);
          flash(`🫠 ${nameOf(e.id)} 풍덩! 상어밥`, 'bad');
        } else if (e.k === 'off') {
          burst(e, '💦');
          later(() => burst(e, '🦈'), 320);
          comic({ x: e.x, y: e.y - 1 }, '풍덩!', true);
          flash(e.by && e.by !== ownerOf(e.id) ? `⚾ ${who(e.by).name} 장외 홈런! ${nameOf(e.id)} 아웃` : `🫠 ${nameOf(e.id)} 혼자 장외!`, 'bad');
          whiteFlash();
          shake();
        } else if (e.k === 'bull') {
          comic(e, '🎯', true);
          rays(e, 14, 2.4);
          flash(`🎯 ${nameOf(e.id)} 정중앙!`, 'clash');
        }
      }
    }

    function renderWind() {
      const show = aiming() || inVolley();
      windBox.style.display = show ? '' : 'none';
      if (!show || !S.wind) return;
      const [x, y] = S.wind;
      const s = Math.hypot(x, y);
      windArrow.style.transform = `rotate(${deg(Math.atan2(y, x)).toFixed(0)}deg)`;
      windLabel.textContent = s < 0.5 ? '약' : s < 0.8 ? '중' : '강';
    }

    function renderTop() {
      const timer = S.phase === 'angle' ? [S.phaseEndsAt, ANGLE_TIME] : S.phase === 'power' ? [S.phaseEndsAt, POWER_TIME]
        : inVolley() ? [S.phaseEndsAt, VOLLEY_TIME] : S.phase === 'intro' ? [S.phaseEndsAt, INTRO_TIME] : null;
      const lap = inVolley() || S.lap2 ? '🎆 일제 발사' : '1바퀴';
      const key = JSON.stringify([S.round, S.alive.length, timer, lap]);
      if (key === topKey) return;
      topKey = key;
      top.replaceChildren(...[
        h('span', {}, S.round ? `라운드 ${S.round} · ${lap}` : '곧 시작'),
        h('span', {}, `생존 ${S.alive.length}명`),
        timer ? countdown(timer[0], timer[1]) : null,
      ].filter(Boolean));
    }

    function panelView() {
      refs = {};
      helpText = '';
      if (S.phase === 'intro') {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '🎪 인간대포 컬링'),
          S.again ? null : h('p', { class: 'intro-line' }, '두 번씩 발사! 스페이스 꾹 = 힘, 제일 바깥이면 독박'));
      }
      if (S.phase === 'final') {
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, `👑 ${who(S.placement?.[0]).name} 인간대포 왕!`), podium(S.roster, S.standings, me));
      }
      if (S.phase === 'judge') {
        const j = S.judge || {};
        const losers = j.losers || [];
        const dying = j.dying || [];
        if (j.void) return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '🌊 전원 장외! 다시'));
        const rows = Object.entries(j.dist || {}).sort((x, y) => (x[1] < 0 ? 1 : y[1] < 0 ? -1 : x[1] - y[1]));
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title hot' }, `💥 ${losers.map(id => who(id).name).join(', ')} 독박!`),
          h('p', {}, dying.length ? `☠️ ${dying.map(id => who(id).name).join(', ')} 탈락` : '💔 하트 하나 잃음'),
          h('div', { class: 'tc-alive' }, rows.map(([id, d]) => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), `${who(id).name} ${d < 0 ? '장외' : `${d.toFixed(1)}m`}`))));
      }
      if (inVolley()) {
        const inIt = inOrder();
        refs.reel = inIt ? h('div', { class: 'hc-reel' }, '🎰') : null;
        refs.gauge = inIt ? h('i') : null;
        refs.help = inIt ? h('p', { class: 'bc-help' }) : null;
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title hot' }, '🎆 일제 발사! 남의 조준은 안 보여요'),
          refs.reel,
          inIt ? h('div', { class: 'hc-gauge' }, refs.gauge) : null,
          refs.help,
          h('div', { class: 'tc-alive' }, S.order.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), `${who(id).name}${S.aims?.[id]?.pw != null ? ' ✓' : ''}`))));
      }
      const mine = S.turn === me;
      const name = who(S.turn).name;
      if (S.phase === 'angle') {
        refs.reel = h('div', { class: 'hc-reel' }, '🎰');
        return h('div', { class: 'bt-act' },
          h('div', { class: `bt-act-title${mine ? ' hot' : ''}` }, mine ? '내 차례! 각도 정하기' : `${name} 조준 중`),
          refs.reel,
          mine ? h('p', { class: 'bc-help' }, h('kbd', {}, 'Space'), ' 톡 = 각도 멈추기') : null);
      }
      if (S.phase === 'power') {
        refs.gauge = h('i');
        const kind = KINDS[S.kind] || KINDS.normal;
        return h('div', { class: 'bt-act' },
          h('div', { class: `bt-act-title${mine ? ' hot' : ''}` }, mine ? '힘 정하기!' : `${name} 힘 모으는 중`),
          S.kind !== 'normal' ? h('div', { class: 'hc-reel done' }, `${kind.emoji} ${kind.name}`) : null,
          h('div', { class: 'hc-gauge' }, refs.gauge),
          mine ? h('p', { class: 'bc-help' }, h('kbd', {}, 'Space'), ' 꾹 = 힘 모으기 · 떼면 발사') : null);
      }
      return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, S.lap2 ? '펑펑펑! 🎆' : `펑! ${josa(name, '이', '가')} 날아간다 🎪`));
    }

    function renderPanel() {
      const done = inVolley() ? S.order.filter(id => S.aims?.[id]?.pw != null).length : 0;
      const key = [S.phase, S.aimNo, S.round, done].join('|');
      if (key === panelKey) return;
      panelKey = key;
      panel.replaceChildren(panelView());
      reelI = -1;
    }

    function renderSide() {
      const order = S.order || [];
      const key = JSON.stringify([order, S.idx, S.turn, S.phase, S.lives, S.outOrder, S.dead, (S.bodies || []).length]);
      if (key === sideKey) return;
      sideKey = key;
      const fired = id => (S.bodies || []).filter(b => b.by === id).length;
      const rows = order.map(id => {
        const now = aiming() && id === S.turn;
        const n = Math.min(2, fired(id));
        const cls = S.alive.includes(id) || S.phase === 'judge' ? (now ? 'now' : n >= 2 ? 'done' : '') : 'dead';
        return h('li', { class: cls }, avatar(who(id)), h('span', {}, who(id).name),
          h('em', {}, `${'●'.repeat(n)}${'○'.repeat(2 - n)} ${'❤️'.repeat(Math.max(0, S.lives?.[id] || 0))}`));
      });
      const out = (S.outOrder || []).map(id => {
        const by = S.dead?.[id];
        return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${josa(who(by).name, '이', '가')} 날림` : ' 🫠 독박');
      });
      side.replaceChildren(...[
        h('h3', {}, S.round ? `쏘는 순서 · 생존 ${S.alive.length}명` : `생존 ${S.alive.length}명`),
        h('ol', { class: 'tw-bag' }, rows),
        out.length ? h('h3', {}, '독박 기록') : null,
        out.length ? h('ul', { class: 'rules' }, out) : null,
        h('h3', {}, '규칙'),
        h('ul', { class: 'rules' },
          h('li', {}, '스페이스 톡 = 각도 멈추기 → 꾹 눌러 힘 모으고 떼면 발사'),
          h('li', {}, '1바퀴는 돌아가며, 2바퀴는 🎆 다 같이 일제 발사'),
          h('li', {}, '🌬️ 바람이 떨어지는 자리를 밀어요. 화살표를 보고 감으로!'),
          h('li', {}, '내 말 2개 중 더 안쪽 말이 내 자리'),
          h('li', {}, '다 쏘면 제일 바깥인 사람 독박 (6명 이상이면 2명)'),
          h('li', {}, '말이 다 판 밖으로 나가면 바로 독박'),
          h('li', {}, '친구 말을 들이받아 밀어내거나, 머리 위로 떨어져서 쿵!'),
          h('li', {}, '🎰 샷마다 룰렛: 🗿 무거움 · 💣 폭발 · 🧊 미끄러움 · 🎈 가벼움 · 🍄 대왕'),
          h('li', {}, '사람이 줄수록 판이 작아지고 대포는 빨라져요')),
      ].filter(Boolean));
    }

    return {
      update({ state }) {
        S = state;
        S.alive ||= [];
        if (charging && ((S.phase !== 'power' && !inVolley()) || charging.no !== S.aimNo)) charging = null; // 시간이 끝나 방장이 먼저 쏜 경우
        layoutPlate();
        syncBodies();
        markBodies();
        stageBox.classList.toggle('hc-last', inVolley());
        if (inVolley() && volleyFlash !== S.round) {
          volleyFlash = S.round;
          flash('🎆 일제 발사!', 'clash');
        }
        if (S.phase === 'judge' && judgeSeen !== S.round) {
          judgeSeen = S.round;
          if (!S.judge?.void) {
            flash('💥 독박!', 'stamp');
            shake();
          }
        }
        const lk = aiming() && S.turn ? S.turn : inVolley() && inOrder() ? me : '';
        if (lk !== loadedKey) {
          loadedKey = lk;
          loaded.replaceChildren(...(lk ? [faceOf(lk, 1.3), kindBadge] : []));
        }
        renderWind();
        renderTop();
        renderPanel();
        renderSide();
      },
      unmount() {
        cancelAnimationFrame(raf);
        for (const id of timers) clearTimeout(id);
        timers.clear();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', release);
      },
    };
  },
};
