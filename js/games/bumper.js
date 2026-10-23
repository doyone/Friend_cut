// 범퍼카 난투: 둥근 얼음 경기장에서 서로 들이받아 밖으로 떨군다. 목숨은 하나, 마지막 1대가 우승.
// 방향키·WASD로 밀고, 스페이스를 꾹 눌러 모았다가 떼면 그 방향으로 돌진(확 튀어나갔다가 급제동).
// 30초부터 경기장이 줄어든다. 마지막 두 명은 3초 예고 뒤 결투 축소. 떨어지기 3초 안에 마지막으로 부딪힌 사람이 킬.
// 아이템: 🍄 거대화(크고 무거워짐) · 🌀 스프링(주변 차 튕겨냄) · 🛢️ 기름(나 빼고 다 미끌).
// 탈락하면 👻 유령: 방향키로 떠다니다 스페이스로 🍌 바나나를 깐다. 밟은 차는 빙글 돌며 미끄러진다.
// 물리는 방장 컴퓨터만 계산한다(원끼리 부딪히는 것뿐이라 직접 계산). 다른 사람은 위치만 받아서 그린다.
import { h, isTyping, josa, shuffle, AGAIN_INTRO } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';
import { createBumperAudio } from './bumper-audio.js';

const TICK = 50;              // 방장이 상태를 보내는 주기(ms). 움직임이 많아서 다른 게임(100ms)의 두 배로
const STEP = 1000 / 60;       // 물리 한 걸음
const INTRO_TIME = 4000;
const ARENA_R = 9;            // 경기장 반지름 (m)
const MIN_R = 2.2;            // 다 줄어든 크기
const SHRINK_AT = 30000;      // 시작하고 이때부터 줄어든다
const SHRINK_TIME = 30000;    // MIN_R까지 줄어드는 시간
const FINAL_SHRINK = 15000;   // 그래도 안 끝나면 이만큼 더 줄여서 0으로 (끝까지 버티기 방지)
const CAR_R = 0.7;
const GIANT_R = 1.15;
const THRUST = 12;            // 초반에는 부드럽게 출발 (m/s²)
const THRUST_MAX = 40;        // 계속 주행하면 가속력이 점점 커진다
const THRUST_RAMP = 3000;     // 3초에 걸쳐 기본 가속 → 최대 가속
const MAX_SPEED = 13;         // 방향키 최고 속도: 기존 6.5의 2배
const ICE = 2.2;              // 얼음 마찰 (클수록 빨리 멈춤)
const CHARGE_TIME = 900;      // 최대 돌진까지 충전: 원래 0.9초
const CHARGE_GRIP = 3.5;      // 모으는 동안 마찰 (버티고 서 있기)
const BRACE = 1.6;            // 모으는 동안 무게 배수 (버티기)
const DASH_MIN = 12;         // 짧은 차지 돌진 속도
const DASH_MAX = 20;         // 최대 차지 돌진 속도
const DASH_BURST = 350;       // 돌진하고 이만큼은 쭉 나가다가
const DASH_BRAKE = 450;       // 이만큼 급제동 (빗나가도 혼자 끝까지 날아가진 않게)
const DASH_COOL = 3000;
const BOUNCE = 0.8;           // 세게 부딪힐 때 튕김
const BUMP = 3.5;             // 세게 부딪히면 덤으로 밀어내는 속도 (범퍼카 손맛)
const SPAWN_R = 4.5;          // 처음 서는 원 반지름
const KILL_WINDOW = 3000;     // 떨어지기 이만큼 전까지 부딪힌 사람이 킬
const GIANT_TIME = 6000;
const OIL_TIME = 4000;
const SPRING_R = 4;
const SPRING_POWER = 11;
const ITEM_EVERY = [5000, 8000];
const BANANA_COOL = 5000;
const BANANA_MAX = 2;         // 유령 한 명이 깔아 둘 수 있는 바나나
const BANANA_LIFE = 12000;
const SPIN_TIME = 900;
const FALL_ANIM = 700;
const GHOST_SPEED = 8;
const DUEL_WARNING = 3000;
const DUEL_SHRINK_SPEED = 0.24; // 결투 예고 뒤 초당 줄어드는 반지름(m)

const ITEMS = {
  giant: { emoji: '🍄', name: '거대화' },
  spring: { emoji: '🌀', name: '스프링' },
  oil: { emoji: '🛢️', name: '기름' },
};

const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const isGiant = (c, now) => (c.g || 0) > now;
const radiusOf = (c, now) => (isGiant(c, now) ? GIANT_R : CAR_R);
// 모으는 중엔 땅에 버티고 서서 잘 안 밀린다 (상대가 모으는 게 보이면 나도 모아서 버티다 받아치기)
const massOf = (c, now) => (isGiant(c, now) ? 3 : 1) * (c.ch ? BRACE : 1);

// 경기장 반지름: 30초 그대로 → 30초에 걸쳐 MIN_R까지 → 그래도 남아 있으면 0까지
function normalArenaR(S, now) {
  const t = now - (S.startAt ?? now);
  if (t < SHRINK_AT) return ARENA_R;
  const k = (t - SHRINK_AT) / SHRINK_TIME;
  if (k < 1) return ARENA_R - (ARENA_R - MIN_R) * k;
  return MIN_R * Math.max(0, 1 - (t - SHRINK_AT - SHRINK_TIME) / FINAL_SHRINK);
}

export function arenaR(S, now) {
  if (S.over) now = S.endAt ?? now;
  const normal = normalArenaR(S, now);
  if (S.duelAt == null) return normal;
  const elapsed = Math.max(0, now - S.duelAt - DUEL_WARNING) / 1000;
  return Math.min(normal, Math.max(0, S.duelRadius - elapsed * DUEL_SHRINK_SPEED));
}

function startDuel(ctx, now) {
  const S = ctx.state;
  if (S.duelAt != null || S.cars.filter(c => !c.out).length !== 2) return;
  S.duelRadius = arenaR(S, now);
  S.duelAt = now;
  ctx.announce('⚔️ 최후의 결투! 3초 뒤 경기장이 점점 좁아집니다.');
}

// 돌진 모으기: 쿨타임이 끝난 뒤부터 센다
const chargeOf = (c, now) => (c.ch ? clamp((now - Math.max(c.ch, c.cd || 0)) / CHARGE_TIME, 0, 1) : 0);

// Firebase는 빈 배열·객체를 안 남기니 방장이 바뀌어 다시 읽으면 비어 있을 수 있다
function norm(S) {
  S.items ||= [];
  S.bananas ||= [];
  S.ghosts ||= {};
  S.outOrder ||= [];
  S.kills ||= {};
  S.dead ||= {};
  S.fx ||= [];
}

// 화면에 보여 줄 일(부딪힘·탈락·아이템·바나나). 번호로 새 것만 골라 보여 주고, 1초쯤 지나면 뺀다
function fx(S, now, e) {
  S.fxNo = (S.fxNo || 0) + 1;
  S.fx = [...S.fx, { n: S.fxNo, at: now, ...e }].slice(-8);
}

// 누가 마지막으로 부딪혔나 (킬 판정용). 방장만 알면 되니 secret에 둔다 — 다른 사람에게 안 보내도 됨
function hit(ctx, car, by, now, k) {
  (ctx.secret.hits ||= {})[car.id] = { by, at: now, k };
}

/* ───────── 물리 (방장 전용) ───────── */

function stepWorld(ctx, now) {
  const S = ctx.state;
  const dt = STEP / 1000;
  const live = S.cars.filter(c => !c.out);
  for (const c of live) {
    if (!ctx.isOnline(c.id)) Object.assign(c, { ix: 0, iy: 0, ch: 0 }); // 나간 사람 차는 멈춰 선다
    const spinning = (c.spin || 0) > now;
    const slippery = (c.slip || 0) > now;
    const len = Math.hypot(c.ix || 0, c.iy || 0);
    if (!len || spinning || c.ch) c.driveFor = 0;
    const ramp = clamp((c.driveFor || 0) / THRUST_RAMP, 0, 1);
    const thrust = THRUST + (THRUST_MAX - THRUST) * ramp * ramp;
    if (len && !spinning && !c.ch) c.driveFor = Math.min(THRUST_RAMP, (c.driveFor || 0) + STEP);
    if (len && !spinning) {
      const dx = c.ix / len;
      const dy = c.iy / len;
      c.a = Math.atan2(dy, dx);
      const along = c.vx * dx + c.vy * dy;
      if (along < MAX_SPEED) {
        const add = Math.min(thrust * (slippery ? 0.2 : c.ch ? 0.25 : 1) * dt, MAX_SPEED - along);
        c.vx += dx * add;
        c.vy += dy * add;
      }
    }
    // 마찰: 모으는 중엔 버티고(급정거), 돌진 직후엔 쭉 나가다가 급제동, 기름 위에선 거의 안 멈춤
    const since = now - (c.dt ?? -1e9);
    let k = slippery ? 0.1 : c.ch ? CHARGE_GRIP : ICE;
    if (since < DASH_BURST) k = 0.2;
    else if (since < DASH_BURST + DASH_BRAKE) k += 3.5;
    const f = Math.exp(-k * dt);
    c.vx *= f;
    c.vy *= f;
    if (spinning) c.a = (c.a || 0) + 15 * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
  }
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) bump(ctx, live[i], live[j], now);
  pickItems(ctx, live, now);
  stepBananas(ctx, live, now);
  // 경기장 밖으로 나간 차는 떨어진다. 동시에 떨어지면 더 멀리 나간 차가 먼저
  const R = arenaR(S, now);
  const out = live.filter(c => Math.hypot(c.x, c.y) > R).sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y));
  for (const c of out) eliminate(ctx, c, now);
  if (S.cars.filter(c => !c.out).length <= 1) finish(ctx, now);
  else startDuel(ctx, now);
}

function bump(ctx, A, B, now) {
  const ra = radiusOf(A, now);
  const rb = radiusOf(B, now);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const d = Math.hypot(dx, dy);
  if (d >= ra + rb) return;
  const nx = d ? dx / d : 1;
  const ny = d ? dy / d : 0;
  const ma = massOf(A, now);
  const mb = massOf(B, now);
  const inv = 1 / ma + 1 / mb;
  // 겹친 만큼 떼어 놓는다 (가벼운 쪽이 더 밀림)
  const push = (ra + rb - d) / inv;
  A.x -= (nx * push) / ma;
  A.y -= (ny * push) / ma;
  B.x += (nx * push) / mb;
  B.y += (ny * push) / mb;
  const vn = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny; // 서로 다가오는 속도
  if (vn <= 0) return;
  const hard = vn > 1;
  const fullDash = c => c.dashPower >= .98 && !c.dashClashed && now >= c.dt && now - c.dt < DASH_BURST;
  const clash = fullDash(A) && fullDash(B)
    && Math.cos(A.dashAngle) * nx + Math.sin(A.dashAngle) * ny > .75
    && Math.cos(B.dashAngle) * nx + Math.sin(B.dashAngle) * ny < -.75
    && A.vx * nx + A.vy * ny > 3 && B.vx * nx + B.vy * ny < -3;
  const j = ((1 + (clash ? 1 : hard ? BOUNCE : 0.2)) * vn + (clash ? BUMP + 6 : hard ? BUMP : 0)) / inv;
  A.vx -= (nx * j) / ma;
  A.vy -= (ny * j) / ma;
  B.vx += (nx * j) / mb;
  B.vy += (ny * j) / mb;
  if (!hard) return;
  if (clash) { A.dashClashed = true; B.dashClashed = true; }
  // 서로를 '마지막으로 부딪힌 사람'으로 적어 둔다 (박고 튕겨 나가 떨어져도 상대 킬)
  hit(ctx, A, B.id, now, 'bump');
  hit(ctx, B, A.id, now, 'bump');
  fx(ctx.state, now, { k: clash ? 'clash' : 'bump', x: r2(A.x + nx * ra), y: r2(A.y + ny * ra), p: r2(vn), angle: Math.atan2(ny, nx), ids: [A.id, B.id] });
}

function pickItems(ctx, live, now) {
  const S = ctx.state;
  for (const it of [...S.items]) {
    const c = live.find(car => Math.hypot(car.x - it.x, car.y - it.y) < radiusOf(car, now) + 0.45);
    if (!c) continue;
    S.items = S.items.filter(x => x !== it);
    if (it.k === 'giant') c.g = now + GIANT_TIME;
    if (it.k === 'spring') {
      for (const o of live) {
        if (o === c) continue;
        const dx = o.x - c.x;
        const dy = o.y - c.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d > SPRING_R) continue;
        const s = (SPRING_POWER * (1 - d / (SPRING_R + 0.5))) / massOf(o, now);
        o.vx += (dx / d) * s;
        o.vy += (dy / d) * s;
        hit(ctx, o, c.id, now, 'spring');
      }
    }
    if (it.k === 'oil') for (const o of live) if (o !== c) o.slip = now + OIL_TIME;
    fx(S, now, { k: 'item', it: it.k, by: c.id, x: r2(c.x), y: r2(c.y) });
  }
}

function stepBananas(ctx, live, now) {
  const S = ctx.state;
  for (const b of [...S.bananas]) {
    const c = live.find(car => Math.hypot(car.x - b.x, car.y - b.y) < radiusOf(car, now) + 0.3);
    if (!c) continue;
    S.bananas = S.bananas.filter(x => x !== b);
    // 빙글 돌면서 엉뚱한 쪽으로 미끄러진다 (서 있었으면 아무 쪽으로나 툭)
    const turn = (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.5);
    const [vx, vy] = [c.vx * Math.cos(turn) - c.vy * Math.sin(turn), c.vx * Math.sin(turn) + c.vy * Math.cos(turn)];
    c.vx = vx * 1.15;
    c.vy = vy * 1.15;
    if (Math.hypot(c.vx, c.vy) < 2) {
      const t = Math.random() * Math.PI * 2;
      c.vx += Math.cos(t) * 3;
      c.vy += Math.sin(t) * 3;
    }
    Object.assign(c, { spin: now + SPIN_TIME, ch: 0 });
    hit(ctx, c, b.by, now, 'banana');
    S.bananaHits = { ...S.bananaHits, [b.by]: (S.bananaHits?.[b.by] || 0) + 1 };
    fx(S, now, { k: 'banana', x: b.x, y: b.y, by: b.by, to: c.id });
  }
}

function eliminate(ctx, c, now) {
  const S = ctx.state;
  Object.assign(c, { out: now, ix: 0, iy: 0, ch: 0 });
  S.outOrder = [...S.outOrder, c.id];
  const last = ctx.secret.hits?.[c.id];
  const killer = last && last.by !== c.id && now - last.at <= KILL_WINDOW ? last.by : null;
  if (killer) {
    ctx.kill(killer, c.id, last.k === 'banana' ? '🍌 바나나' : last.k === 'spring' ? '🌀 스프링' : '🚗 들이받기');
    S.kills = { ...S.kills, [killer]: (S.kills[killer] || 0) + 1 };
  } else {
    S.selfOut ||= c.id; // 첫 자폭 (칭호용)
    ctx.announce(`🫠 ${ctx.nameOf(c.id)} 혼자 떨어짐 (자폭)`);
  }
  S.dead = { ...S.dead, [c.id]: killer || '-' };
  // 유령은 떨어진 자리 조금 안쪽에서 시작
  S.ghosts = { ...S.ghosts, [c.id]: { x: r2(c.x * 0.8), y: r2(c.y * 0.8) } };
  fx(S, now, { k: 'fall', x: r2(c.x), y: r2(c.y), to: c.id, by: killer });
}

function finish(ctx, now) {
  const S = ctx.state;
  if (S.over) return;
  const alive = S.cars.filter(c => !c.out).map(c => c.id);
  const placement = [...alive, ...[...S.outOrder].reverse()];
  for (const p of S.roster || ctx.roster) if (!placement.includes(p.id)) placement.push(p.id);
  S.placement = placement;
  S.standings = Object.fromEntries(placement.map((id, i) => [id, placement.length - i]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  add(placement[0], '👑 범퍼카 왕');
  const [killer, kills] = Object.entries(S.kills).sort((a, b) => b[1] - a[1])[0] || [];
  if (kills >= 2) add(killer, `💥 학살자 (${kills}킬)`);
  if (S.selfOut) add(S.selfOut, '🫠 자폭왕');
  const [peeler, peels] = Object.entries(S.bananaHits || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (peels >= 2) add(peeler, `🍌 바나나 장인 (${peels}명 미끌)`);
  S.titles = titles;
  S.phase = 'final';
  S.over = true;
  S.endAt = now;
}

function spawnItem(S, now) {
  const R = arenaR(S, now);
  for (let tries = 0; tries < 12; tries++) {
    const r = Math.sqrt(Math.random()) * R * 0.65;
    const t = Math.random() * Math.PI * 2;
    const x = r2(r * Math.cos(t));
    const y = r2(r * Math.sin(t));
    if (S.cars.some(c => !c.out && Math.hypot(c.x - x, c.y - y) < 2.2)) continue;
    const roll = Math.random();
    S.itemNo = (S.itemNo || 0) + 1;
    S.items = [...S.items, { id: S.itemNo, k: roll < 0.4 ? 'giant' : roll < 0.75 ? 'spring' : 'oil', x, y }];
    return;
  }
}

function dash(car, now, data) {
  if (now < (car.cd || 0) || (car.spin || 0) > now) {
    car.ch = 0; // 쿨타임·빙글 중엔 모은 게 날아간다
    return false;
  }
  const power = chargeOf(car, now);
  let dx = sign(Number(data.x) || 0);
  let dy = sign(Number(data.y) || 0);
  if (!dx && !dy) {
    dx = Math.cos(car.a || 0);
    dy = Math.sin(car.a || 0);
  }
  const len = Math.hypot(dx, dy);
  const speed = DASH_MIN + (DASH_MAX - DASH_MIN) * power;
  car.vx = (dx / len) * speed + car.vx * 0.2;
  car.vy = (dy / len) * speed + car.vy * 0.2;
  Object.assign(car, { a: Math.atan2(dy, dx), ch: 0, cd: now + DASH_COOL, dt: now,
    dashPower: power, dashAngle: Math.atan2(dy, dx), dashClashed: false });
  return true;
}

// 보낼 때: 0.05초 사이 꺾이며 움직인 차는 중간 자리(p)도 같이 (부딪히는 순간이 허공에서 꺾여 보이지 않게)
function pack(ctx, now) {
  const S = ctx.state;
  const { start, samples } = ctx.trail;
  for (const c of S.cars) {
    delete c.p;
    const list = samples.get(c.id);
    const a = start.get(c.id);
    if (!c.out && a && list?.length > 1) {
      const n = list.length;
      const mid = list.slice(0, -1);
      const off = (v, from, to, k) => Math.abs(v - (from + ((to - from) * (k + 1)) / n));
      if (mid.some(([x, y], k) => off(x, a[0], c.x, k) > 0.03 || off(y, a[1], c.y, k) > 0.03)) c.p = mid.map(([x, y]) => [r2(x), r2(y)]);
    }
    Object.assign(c, { x: r2(c.x), y: r2(c.y), vx: r2(c.vx), vy: r2(c.vy), a: r2(c.a || 0) });
    // 끝난 효과는 지워서 보내는 양을 줄인다
    for (const k of ['g', 'slip', 'spin', 'cd']) if ((c[k] || 0) < now) delete c[k];
    if (!c.ch) delete c.ch;
    if (now - (c.dt ?? -1e9) > 1000) delete c.dt;
  }
  S.fx = S.fx.filter(e => now - e.at < 1200);
  const hits = ctx.secret.hits || {};
  for (const [id, x] of Object.entries(hits)) if (now - x.at > KILL_WINDOW) delete hits[id];
  ctx.trail = { start: poses(S), samples: new Map() };
}

const poses = S => new Map(S.cars.filter(c => !c.out).map(c => [c.id, [c.x, c.y]]));

/* ───────── 봇 ───────── */

// 8방향 중 가장 가까운 쪽 (사람도 방향키 8방향뿐이라 똑같이)
function quant8(angle) {
  const k = Math.round(angle / (Math.PI / 4));
  return [sign(Math.round(Math.cos((k * Math.PI) / 4) * 1000)), sign(Math.round(Math.sin((k * Math.PI) / 4) * 1000))];
}

// 살아 있는 봇: 가장자리면 가운데로, 아니면 가장자리에 가까운 차를 바깥쪽으로 밀러 가고, 줄이 맞으면 돌진.
// 혼자 봇이랑 테스트해도 할 만하게: 처음 1초는 가운데로만, 돌진은 가끔, 표적은 봇마다 다르게,
// 그리고 사람처럼 반응이 늦다 — 정한 행동은 0.25초쯤 뒤에 들어간다 (사람은 보고 누르고 전달되는 데 그만큼 걸림)
const BOT_REACT = 250;
function botDrive(S, car, now, mem) {
  mem.q ||= [];
  const later = act => mem.q.push({ at: now + BOT_REACT + Math.random() * 100, act });
  botDecide(S, car, now, mem, later);
  return mem.q.length && mem.q[0].at <= now ? mem.q.shift().act : null;
}

function botDecide(S, car, now, mem, later) {
  const R = arenaR(S, now);
  const d0 = Math.hypot(car.x, car.y) || 0.01;
  if (now >= (mem.think || 0)) {
    mem.think = now + 250 + Math.random() * 200;
    mem.bias ||= {};
    const outward = (car.vx * car.x + car.vy * car.y) / d0;
    let tx = 0;
    let ty = 0;
    mem.mode = 'safe';
    if (now - S.startAt > 1000 && d0 < R - 1.8 && !(d0 > R - 3.2 && outward > 2.5)) {
      const item = S.items.find(it => Math.hypot(it.x - car.x, it.y - car.y) < 4.5);
      mem.greedy ??= Math.random() < 0.6;
      if (item && mem.greedy) {
        [tx, ty, mem.mode] = [item.x, item.y, 'item'];
      } else {
        let best = null;
        let bestScore = -Infinity;
        for (const o of S.cars) {
          if (o.out || o.id === car.id) continue;
          mem.bias[o.id] ??= Math.random() * 4; // 봇마다 노리는 상대가 갈리게
          const score = (Math.hypot(o.x, o.y) / R) * 6 - Math.hypot(o.x - car.x, o.y - car.y) + mem.bias[o.id];
          if (score > bestScore) [best, bestScore] = [o, score];
        }
        if (best) {
          const od = Math.hypot(best.x, best.y) || 1;
          [tx, ty, mem.mode, mem.target] = [best.x + (best.x / od) * 0.8, best.y + (best.y / od) * 0.8, 'hunt', best.id];
        }
      }
    }
    mem.dir = quant8(Math.atan2(ty - car.y, tx - car.x) + (Math.random() - 0.5) * 0.5);
  }
  // 누가 나를 보고 모으는 중이면 나도 모아서 버티다가 그쪽으로 받아친다
  if (!mem.charging && now >= (mem.braceUntil || 0) && now - S.startAt > 1000) {
    const threat = S.cars.find(o => {
      if (o.out || o.id === car.id || !o.ch) return false;
      const d = Math.hypot(car.x - o.x, car.y - o.y) || 1;
      return d < 4.5 && ((car.x - o.x) * Math.cos(o.a || 0) + (car.y - o.y) * Math.sin(o.a || 0)) / d > 0.85;
    });
    mem.braceUntil = now + 300;
    if (threat && Math.random() < 0.3) {
      Object.assign(mem, { charging: true, releaseAt: now + 450 + Math.random() * 400, braceUntil: now + 2500 });
      mem.dir = quant8(Math.atan2(threat.y - car.y, threat.x - car.x));
      mem.think = mem.releaseAt + 50; // 받아칠 때까지 방향 유지
      later({ type: 'charge' });
    }
  }
  const [qx, qy] = mem.dir || [0, 0];
  // 모으기·돌진은 '내가 누르고 있다고 생각하는 것'(mem.charging)으로 판단 (실제 반영은 늦게 되니까)
  if (mem.charging && now >= mem.releaseAt) {
    mem.charging = false;
    mem.noDashUntil = now + DASH_COOL + 600 + Math.random() * 1500;
    later({ type: 'dash', data: { x: qx, y: qy }, say: Math.random() < 0.06 });
  }
  if (mem.mode === 'hunt' && !mem.charging && now >= (mem.noDashUntil || 0)) {
    const t = S.cars.find(c => c.id === mem.target && !c.out);
    const dx = (t?.x ?? 0) - car.x;
    const dy = (t?.y ?? 0) - car.y;
    const d = Math.hypot(dx, dy);
    if (t && d > 1.6 && d < 5.5 && (dx * qx + dy * qy) / (d * (Math.hypot(qx, qy) || 1)) > 0.93) {
      mem.noDashUntil = now + 400;
      if (Math.random() < 0.35) {
        mem.charging = true;
        mem.releaseAt = now + 150 + Math.random() * 550;
        later({ type: 'charge' });
      }
    }
  }
  const key = `${qx},${qy}`;
  if (mem.sent !== key) {
    mem.sent = key;
    later({ type: 'move', data: { x: qx, y: qy } });
  }
}

// 유령 봇: 가끔 살아 있는 차가 갈 길에 바나나를 깐다
function botGhost(S, id, now, mem) {
  const live = S.cars.filter(c => !c.out);
  if (!live.length) return null;
  if (mem.banana) {
    const at = mem.banana;
    mem.banana = null;
    return { type: 'banana', data: at };
  }
  if (now < (mem.peelAt ??= now + 2500 + Math.random() * 3000)) return null;
  mem.peelAt = now + 6000 + Math.random() * 4000;
  const t = live[Math.floor(Math.random() * live.length)];
  const R = arenaR(S, now) - 0.6;
  let x = t.x + t.vx * 0.7;
  let y = t.y + t.vy * 0.7;
  const d = Math.hypot(x, y);
  if (d > R) [x, y] = [(x / d) * R, (y / d) * R];
  mem.banana = { x: r2(x), y: r2(y) };
  return { type: 'ghost', data: mem.banana };
}

/* ───────── 화면 ───────── */

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}
const deg = r => (r * 180) / Math.PI;
const DIRS = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };

export default {
  id: 'bumper',
  title: '범퍼카 난투',
  emoji: '🚗',
  tag: '액션',
  color: '#9b59b6',
  desc: '얼음 경기장에서 들이받아 떨구기. 스페이스 꾹 눌렀다 떼면 돌진! 마지막 1대가 우승',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: TICK,

  setup(ctx, prev) {
    const now = ctx.now();
    const intro = prev ? AGAIN_INTRO : INTRO_TIME;
    const ids = shuffle(ctx.roster.map(p => p.id));
    // 경기장 가운데를 보고 둥글게 선다
    const cars = ids.map((id, i) => {
      const t = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
      return { id, x: r2(SPAWN_R * Math.cos(t)), y: r2(SPAWN_R * Math.sin(t)), vx: 0, vy: 0, a: r2(t + Math.PI), ix: 0, iy: 0 };
    });
    return {
      phase: 'intro',
      phaseEndsAt: now + intro,
      startAt: now + intro,
      itemAt: now + intro + 4000,
      again: !!prev,
      cars,
    };
  },

  onInput(ctx, { pid, type, data }) {
    const S = ctx.state;
    const now = ctx.now();
    norm(S);
    const car = S.cars.find(c => c.id === pid);
    if (S.phase !== 'play' || !car) return false;
    if (!car.out) {
      // 움직임은 다음 틱에 같이 보내면 되니 false (입력마다 상태를 보내면 너무 많다)
      if (type === 'move') {
        const ix = sign(Number(data.x) || 0), iy = sign(Number(data.y) || 0);
        // 키를 놓거나 반대/직각 방향으로 꺾으면 기본 가속부터 다시 시작.
        if ((!ix && !iy) || ix * (car.ix || 0) + iy * (car.iy || 0) <= 0) car.driveFor = 0;
        Object.assign(car, { ix, iy });
      }
      if (type === 'charge' && !car.ch) car.ch = now;
      if (type === 'dash') return dash(car, now, data);
      return false;
    }
    // 유령: 떠다니는 자리 + 바나나
    const R = arenaR(S, now);
    const inside = (x, y) => {
      const d = Math.hypot(x, y);
      const k = d > R - 0.3 ? Math.max(0, R - 0.3) / d : 1;
      return [r2(x * k), r2(y * k)];
    };
    const g = (S.ghosts[pid] ||= { x: 0, y: 0 });
    if (type === 'ghost') [g.x, g.y] = inside(Number(data.x) || 0, Number(data.y) || 0);
    if (type === 'banana' && now >= (g.cd || 0) && S.bananas.filter(b => b.by === pid).length < BANANA_MAX) {
      const [x, y] = inside(Number(data.x) || 0, Number(data.y) || 0);
      Object.assign(g, { x, y, cd: now + BANANA_COOL });
      S.bananaNo = (S.bananaNo || 0) + 1;
      S.bananas = [...S.bananas, { id: S.bananaNo, x, y, by: pid, at: now }];
      return true;
    }
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    norm(S);
    if (S.phase === 'intro') {
      if (now < S.phaseEndsAt) return false;
      S.phase = 'play';
      ctx.simAt = now;
      startDuel(ctx, now);
      return true;
    }
    if (S.phase !== 'play') return false;
    // 방장 계산이 실제로 늦어지면(노트북 절전 등으로 방장 탭이 잠들면) 다들 이유를 알 수 있게 표시
    const gap = now - (ctx.lastTick ?? now);
    ctx.lastTick = now;
    if (gap > 300) ctx.slowUntil = now + 2000;
    S.away = now < (ctx.slowUntil || 0) ? 1 : 0;
    // 1/60초씩 따라잡는다 (방장 탭이 잠깐 멈췄다 깨어나도 0.5초 넘게 몰아서 돌리진 않게)
    let t = Math.max(ctx.simAt ?? now, now - 500);
    ctx.trail ||= { start: poses(S), samples: new Map() };
    while (now - t >= STEP && !S.over) {
      t += STEP;
      stepWorld(ctx, Math.round(t)); // 상태에 적는 시각은 ms 정수로
      for (const c of S.cars) {
        if (c.out) continue;
        if (!ctx.trail.samples.has(c.id)) ctx.trail.samples.set(c.id, []);
        ctx.trail.samples.get(c.id).push([c.x, c.y]);
      }
    }
    ctx.simAt = t;
    if (!S.over) {
      const R = arenaR(S, now);
      S.items = S.items.filter(it => Math.hypot(it.x, it.y) < R - 0.4);
      S.bananas = S.bananas.filter(b => now - b.at < BANANA_LIFE && Math.hypot(b.x, b.y) < R);
      if (now >= S.itemAt) {
        S.itemAt = now + Math.round(ITEM_EVERY[0] + Math.random() * (ITEM_EVERY[1] - ITEM_EVERY[0]));
        if (S.items.length < 2) spawnItem(S, now);
      }
      // 입력이 올 때마다 방장이 한 번씩 더 돌아도, 보내는 건 TICK마다 한 번
      if (now - (ctx.sentAt || 0) < TICK - 8) return false;
    }
    ctx.sentAt = now;
    pack(ctx, now);
    return true;
  },

  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    norm(S);
    const car = S.cars.find(c => c.id === id);
    if (S.phase !== 'play' || !car) return null;
    return car.out ? botGhost(S, id, now, mem) : botDrive(S, car, now, mem);
  },

  mount(root, api) {
    const me = api.me;
    const top = h('div', { class: 'bc-top' });
    const ice = svg('circle', { class: 'bc-ice', r: ARENA_R });
    const lines = [0.33, 0.66].map(k => svg('circle', { class: 'bc-ice-line', r: ARENA_R * k }));
    const edge = svg('circle', { class: 'bc-edge', r: ARENA_R });
    const aimsG = svg('g', { class: 'bc-aims' });
    const itemsG = svg('g');
    const bananasG = svg('g');
    const carsG = svg('g');
    const ghostsG = svg('g');
    const fxG = svg('g');
    const stage = svg('svg', { class: 'bc-svg', viewBox: '-10 -10 20 20' },
      svg('rect', { class: 'bc-water', x: -12, y: -12, width: 24, height: 24 }),
      ice, lines, edge, aimsG, itemsG, bananasG, carsG, ghostsG, fxG);
    const flashes = h('div', { class: 'bc-fx' });
    const audio = createBumperAudio();
    const sound = h('button', { class: 'bc-sound', type: 'button', tabindex: '-1', 'aria-label': '게임 소리 켜기 또는 끄기' });
    const soundLabel = () => { sound.textContent = audio.enabled ? '🔊 소리 켜짐' : '🔇 소리 꺼짐'; sound.setAttribute('aria-pressed', String(audio.enabled)); };
    soundLabel();
    sound.addEventListener('click', () => { audio.toggle(); soundLabel(); sound.blur(); });
    const panel = h('div', { class: 'bc-panel' });
    const box = h('div', { class: 'bc-box' }, top, h('div', { class: 'bc-stage' }, stage, flashes, sound), panel);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'bc' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    const cars = new Map();   // id → 화면 조각 + 위치 따라가기
    const items = new Map();
    const bananas = new Map();
    const ghosts = new Map();
    let seenFx = null;
    let topKey = '';
    let panelKey = '';
    let sideKey = '';
    let lastPhase = null;
    let warned = false;
    let seenDuel = null;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const timers = new Set();
    function later(fn, ms) {
      const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id); return id;
    }
    const unlockAudio = () => { void audio.unlock(); };
    box.addEventListener('pointerdown', unlockAudio);
    // 내 입력 (방향은 바뀔 때만 보낸다)
    const keys = new Set();
    let sentMove = '';
    let charging = 0;         // 모으기가 시작되는 때 (내 화면 기준, 쿨타임이 남았으면 끝나는 때부터)
    const ghost = { x: 0, y: 0, ready: false, sentAt: 0, sent: '', last: 0 };

    const who = id => S?.roster.find(p => p.id === id) || { id, name: '?' };
    const myCar = () => S?.cars.find(c => c.id === me);
    const playing = () => S?.phase === 'play';
    const alive = () => !!myCar() && !myCar().out;
    const dir = () => [(keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0), (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0)];

    function sendMove(force) {
      if (!playing() || !alive()) return;
      const [x, y] = dir();
      const key = `${x},${y}`;
      if (key === sentMove && !force) return;
      sentMove = key;
      api.send('move', { x, y });
    }
    function releaseAll() {
      keys.clear();
      sendMove();
      if (charging && playing() && alive()) api.send('dash', { x: 0, y: 0 });
      charging = 0;
    }
    function onKey(e) {
      if (!S) return;
      if (isTyping(e)) {
        if (keys.size || charging) releaseAll(); // 채팅 치는 동안엔 손 뗀 걸로
        return;
      }
      const down = e.type === 'keydown';
      const d = DIRS[e.code];
      if (down && (d || e.code === 'Space')) unlockAudio();
      if (d) {
        e.preventDefault();
        if (down) keys.add(d);
        else keys.delete(d);
        sendMove();
        return;
      }
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (!playing()) return;
      if (alive()) {
        if (down && !e.repeat && !charging) {
          charging = performance.now() + Math.max(0, (myCar().cd || 0) - api.now());
          api.send('charge');
        } else if (!down && charging) {
          charging = 0;
          const [x, y] = dir();
          api.send('dash', { x, y });
        }
      } else if (myCar() && down && !e.repeat) {
        api.send('banana', { x: r2(ghost.x), y: r2(ghost.y) });
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', releaseAll);

    function carView(c) {
      const p = who(c.id);
      const face = svg('g');
      face.innerHTML = avatar(p).innerHTML; // 얼굴 (붙은 스티커까지)
      const f = face.firstElementChild;
      if (f) for (const [k, v] of Object.entries({ x: -0.62, y: -0.62, width: 1.24, height: 1.24 })) f.setAttribute(k, v);
      const body = svg('g', {}, svg('circle', { class: 'bc-bumper', r: CAR_R }), face);
      const impact = svg('g', {}, body);
      const nose = svg('g', {}, svg('path', { class: 'bc-nose', d: 'M0.74,-0.3 L1.12,0 L0.74,0.3 Z' }));
      const charge = svg('circle', { class: 'bc-charge', r: CAR_R + 0.2, pathLength: 100 });
      const ready = svg('circle', { class: 'bc-ready-flash', r: CAR_R + .35, opacity: 0 });
      const aim = svg('g', { class: 'bc-charge-aim' },
        svg('path', { class: 'bc-charge-lane', d: 'M0.7,-0.22 L2.8,-0.22 L3.25,0 L2.8,0.22 L0.7,0.22 Z' }),
        svg('path', { class: 'bc-charge-chevron', d: 'M1.5,-.22 L1.8,0 L1.5,.22 M2.15,-.22 L2.45,0 L2.15,.22' }));
      aimsG.append(aim);
      aim.style.display = 'none';
      const oil = svg('ellipse', { class: 'bc-oil', rx: 1.1, ry: 0.85 });
      const name = svg('text', { class: `bc-name${c.id === me ? ' me' : ''}` }, c.id === me ? '나' : p.name);
      const g = svg('g', { class: `bc-car${c.id === me ? ' mine' : ''}` }, oil, charge, ready, nose, impact, name);
      carsG.append(g);
      return { g, body, impact, nose, charge, ready, aim, oil, name, keys: [c, c], t: performance.now(), hitUntil: 0, wasFull: false, flashUntil: 0 };
    }

    function syncCars() {
      const now = performance.now();
      for (const c of S.cars) {
        let v = cars.get(c.id);
        if (!v) {
          cars.set(c.id, (v = carView(c)));
          continue;
        }
        const last = v.keys[v.keys.length - 1];
        if (last.x === c.x && last.y === c.y) {
          v.keys[v.keys.length - 1] = c; // 위치는 그대로, 다른 값(모으기·거대화 등)만 새로
          continue;
        }
        v.keys = [current(v, now), ...(c.p || []).map(([x, y]) => ({ x, y })), c];
        v.t = now;
      }
    }

    // 지금 그리던 자리 → 방장이 보낸 중간 자리들 → 새 자리를 차례로 따라간다
    function current(v, now) {
      const { keys: ks } = v;
      const k = Math.min(1, (now - v.t) / (TICK + 12)) * (ks.length - 1);
      const i = Math.min(ks.length - 2, Math.floor(k));
      if (i < 0) return { x: ks[0].x, y: ks[0].y };
      const f = k - i;
      return { x: ks[i].x + (ks[i + 1].x - ks[i].x) * f, y: ks[i].y + (ks[i + 1].y - ks[i].y) * f };
    }

    function syncThings(list, map, make) {
      const live = new Set();
      for (const it of list || []) {
        live.add(it.id);
        if (!map.has(it.id)) {
          const el = make(it);
          el.setAttribute('transform', `translate(${it.x} ${it.y})`);
          map.set(it.id, el);
        }
      }
      for (const [id, el] of map) {
        if (live.has(id)) continue;
        el.remove();
        map.delete(id);
      }
    }

    function paint() {
      if (!S) return;
      const now = performance.now();
      const t = api.now();
      const R = arenaR(S, t);
      ice.setAttribute('r', R);
      edge.setAttribute('r', R);
      lines.forEach((l, i) => l.setAttribute('r', R * [0.33, 0.66][i]));
      edge.classList.toggle('shrinking', S.phase === 'play' && (t - S.startAt >= SHRINK_AT || (S.duelAt != null && t >= S.duelAt + DUEL_WARNING)));
      for (const c of S.cars) {
        const v = cars.get(c.id);
        if (!v) continue;
        let { x, y } = current(v, now);
        let scale = 1;
        let spin = 0;
        let opacity = 1;
        // 거대화: 0.2초 동안 커졌다가 끝날 때 0.2초 동안 작아진다
        if ((c.g || 0) > t) {
          const grow = Math.min(1, (t - (c.g - GIANT_TIME)) / 200, (c.g - t) / 200);
          scale = 1 + (GIANT_R / CAR_R - 1) * clamp(grow, 0, 1);
        }
        if ((c.spin || 0) > t) spin = ((t - (c.spin - SPIN_TIME)) / 1000) * 900;
        if (c.out) {
          const e = clamp((t - c.out) / FALL_ANIM, 0, 1);
          if (e >= 1) {
            v.g.style.display = 'none';
            v.aim.style.display = 'none';
            continue;
          }
          x = c.x + (c.vx || 0) * e * 0.35;
          y = c.y + (c.vy || 0) * e * 0.35;
          scale *= 1 - e * 0.85;
          spin = e * 540;
          opacity = 1 - e * 0.8;
        }
        v.g.style.display = '';
        v.g.style.opacity = opacity;
        v.g.setAttribute('transform', `translate(${x} ${y})`);
        const squash = reducedMotion.matches ? 0 : Math.sin(clamp((v.hitUntil - now) / 240, 0, 1) * Math.PI) * .22;
        const hitAngle = deg(v.hitAngle || 0);
        v.impact.setAttribute('transform', `rotate(${hitAngle}) scale(${1 - squash} ${1 + squash * .65}) rotate(${-hitAngle})`);
        v.nose.setAttribute('transform', `rotate(${deg(c.a || 0)}) scale(${scale})`);
        v.nose.style.display = c.out ? 'none' : '';
        v.oil.style.display = (c.slip || 0) > t && !c.out ? '' : 'none';
        v.name.setAttribute('y', -(CAR_R * scale + 0.38));
        // 돌진 모으기 고리 (내 차는 누르자마자 바로)
        const mineCharging = c.id === me && !!charging && !c.out && !(c.spin > t) && S.phase === 'play';
        const level = mineCharging ? clamp((now - charging) / CHARGE_TIME, 0, 1) : chargeOf(c, t);
        const isCharging = (mineCharging || c.ch) && !c.out && S.phase === 'play';
        const telegraph = isCharging && level > 0;
        const wobble = telegraph && !reducedMotion.matches ? Math.sin(now * .085) * (.012 + level * .035) : 0;
        v.body.setAttribute('transform', `translate(${wobble} ${wobble * .6}) rotate(${spin}) scale(${scale})`);
        v.charge.style.display = isCharging ? '' : 'none';
        v.charge.setAttribute('r', (CAR_R + 0.2) * scale);
        v.charge.setAttribute('stroke-dasharray', `${Math.max(2, level * 100)} 100`);
        v.charge.classList.toggle('full', level >= 1);
        v.charge.classList.toggle('cooling', mineCharging && now < charging); // 쿨타임 끝나기 전엔 회색
        const [aimX, aimY] = mineCharging ? dir() : [0, 0];
        const angle = mineCharging && (aimX || aimY) ? Math.atan2(aimY, aimX) : c.a || 0;
        v.aim.style.display = telegraph ? '' : 'none';
        v.aim.style.opacity = .25 + level * .55;
        v.aim.classList.toggle('full', level >= 1);
        v.aim.setAttribute('transform', `translate(${x} ${y}) rotate(${deg(angle)}) scale(${(.45 + level * .55) * scale} ${scale})`);
        if (isCharging && level >= 1 && !v.wasFull) {
          v.flashUntil = now + 220;
          if (c.id === me) audio.ready();
        }
        v.wasFull = !!isCharging && level >= 1;
        v.ready.setAttribute('opacity', !c.out && now < v.flashUntil ? .7 * (v.flashUntil - now) / 220 : 0);
        v.ready.setAttribute('r', (CAR_R + .35) * scale);
        v.g.classList.toggle('dashing', t - (c.dt ?? -1e9) < DASH_BURST);
      }
      // 내 유령: 내 화면에서 바로 움직이고 방장에게는 가끔 알려 준다
      if (playing() && myCar()?.out) {
        if (!ghost.ready) {
          const g = S.ghosts?.[me];
          [ghost.x, ghost.y, ghost.ready] = [g?.x ?? 0, g?.y ?? 0, true];
        }
        const [dx, dy] = dir();
        const len = Math.hypot(dx, dy) || 1;
        const dt = Math.min(0.05, (now - (ghost.last || now)) / 1000);
        ghost.x = clamp(ghost.x + (dx / len) * GHOST_SPEED * dt, -R, R);
        ghost.y = clamp(ghost.y + (dy / len) * GHOST_SPEED * dt, -R, R);
        const key = `${ghost.x.toFixed(1)},${ghost.y.toFixed(1)}`;
        if (key !== ghost.sent && now - ghost.sentAt > 120) {
          [ghost.sent, ghost.sentAt] = [key, now];
          api.send('ghost', { x: r2(ghost.x), y: r2(ghost.y) });
        }
        const mine = ghosts.get(me);
        if (mine) mine.setAttribute('transform', `translate(${ghost.x} ${ghost.y})`);
      }
      ghost.last = now;
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function flash(text, cls = '', duration = 1600) {
      const el = h('div', { class: `bc-flash ${cls}` }, text);
      flashes.append(el);
      later(() => el.remove(), duration);
    }
    function shake() {
      if (reducedMotion.matches) return;
      box.classList.remove('bc-impact-shake');
      void box.offsetWidth;
      box.classList.add('bc-impact-shake');
      later(() => box.classList.remove('bc-impact-shake'), 220);
    }
    function burst(x, y, cls, text) {
      const el = svg('g', { transform: `translate(${x} ${y})` }, svg('text', { class: cls }, text));
      fxG.append(el);
      later(() => el.remove(), 600);
    }

    function collisionBurst(e, clash) {
      const effect = svg('g', { transform: `translate(${e.x} ${e.y})`, class: 'bc-collision' });
      const rays = clash ? 12 : 7;
      for (let i = 0; i < rays; i++) {
        const a = i * Math.PI * 2 / rays;
        const length = (clash ? 1.4 : .8) + (i % 3) * .17;
        effect.append(svg('line', { class: 'bc-impact-ray', x1: Math.cos(a) * .18, y1: Math.sin(a) * .18,
          x2: Math.cos(a) * length, y2: Math.sin(a) * length }));
      }
      effect.append(svg('circle', { class: clash ? 'bc-shock-ring clash' : 'bc-shock-ring', r: .8 }));
      if (clash) effect.append(svg('circle', { class: 'bc-shock-ring second', r: .5 }));
      fxG.append(effect);
      later(() => effect.remove(), 650);
    }

    function playFx() {
      const list = S.fx || [];
      if (seenFx === null) {
        seenFx = Math.max(0, ...list.map(e => e.n));
        return;
      }
      for (const e of list) {
        if (e.n <= seenFx) continue;
        seenFx = e.n;
        if (e.k === 'bump' || e.k === 'clash') {
          const clash = e.k === 'clash', personal = !!e.ids?.includes(me);
          if (clash || e.p > 7) {
            collisionBurst(e, clash);
            audio.impact(clash, personal);
            for (const id of e.ids || []) {
              const v = cars.get(id);
              if (v) { v.hitUntil = performance.now() + 240; v.hitAngle = e.angle || 0; }
            }
          } else burst(e.x, e.y, 'bc-spark', '✦');
          if (personal && (clash || e.p > 7)) shake();
          if (clash) flash('⚡ 풀차지 정면충돌!', 'clash');
        } else if (e.k === 'fall') {
          burst(e.x, e.y, 'bc-splash', '💦');
          if (e.to === me) {
            flash('으악! 탈락… 👻 유령으로 복수하세요', 'bad');
            shake();
          } else {
            flash(e.by ? `💥 ${who(e.by).name} → ${who(e.to).name} 떨굼!` : `🫠 ${who(e.to).name} 자폭`, 'bad');
          }
        } else if (e.k === 'item') {
          const it = ITEMS[e.it];
          const text = e.it === 'oil' ? `🛢️ ${josa(who(e.by).name, '이', '가')} 기름 뿌림! 4초 미끌` : `${it.emoji} ${who(e.by).name} ${it.name}!`;
          flash(text);
          if (e.it === 'spring') burst(e.x, e.y, 'bc-wave', '◎');
        } else if (e.k === 'banana') {
          burst(e.x, e.y, 'bc-spark', '🍌');
          flash(`🍌 ${who(e.to).name} 미끌! (${who(e.by).name}의 바나나)`);
        }
      }
    }

    // 위·옆 줄은 초당 20번 오는 상태마다 다시 만들면 무거워서(얼굴 그림 등) 내용이 바뀔 때만 다시 그린다
    function renderTop() {
      const t = api.now();
      const shrinkAt = S.duelAt == null ? S.startAt + SHRINK_AT : Math.min(S.startAt + SHRINK_AT, S.duelAt + DUEL_WARNING);
      const left = Math.max(0, Math.ceil((shrinkAt - t) / 1000));
      const c = myCar();
      const play = S.phase === 'play';
      const bits = [[`생존 ${S.cars.filter(x => !x.out).length}명`]];
      if (play && S.duelAt != null) bits.push(['⚔️ 최후의 결투', 'bc-duel-label']);
      if (play) bits.push(left ? [`⏱️ 경기장 축소까지 ${left}초`] : ['🔥 경기장 줄어드는 중!', 'bc-hot']);
      if (play && S.away) bits.push(['🐢 방장 쪽이 느려지고 있어요', 'bc-hot']);
      if (play && c && !c.out) {
        const cool = Math.max(0, (c.cd || 0) - t);
        bits.push([cool > 0 ? `🚀 돌진 ${(cool / 1000).toFixed(1)}초` : '🚀 돌진 준비!', 'bc-dash']);
      }
      if (play && c?.out) {
        const cool = Math.max(0, (S.ghosts?.[me]?.cd || 0) - t);
        bits.push([cool > 0 ? `🍌 ${Math.ceil(cool / 1000)}초` : '🍌 바나나 준비!', 'bc-dash']);
      }
      const key = JSON.stringify([bits, S.phase === 'intro' && S.phaseEndsAt]);
      if (key === topKey) return;
      topKey = key;
      top.replaceChildren(...bits.map(([text, cls]) => h('span', { class: cls }, text)),
        ...(S.phase === 'intro' ? [countdown(S.phaseEndsAt, S.again ? AGAIN_INTRO : INTRO_TIME)] : []));
    }

    function panelView() {
      const c = myCar();
      if (S.phase === 'intro') {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '🚗 범퍼카 난투'),
          S.again ? null : h('ul', { class: 'rules big' },
            h('li', {}, '방향키·WASD로 밀기 · 스페이스를 꾹 눌렀다 떼면 돌진 (오래 모을수록 셈)'),
            h('li', {}, '경기장 밖으로 떨어지면 탈락. 3초 안에 마지막으로 박은 사람이 킬, 아니면 자폭'),
            h('li', {}, '🍄 거대화 · 🌀 스프링 · 🛢️ 기름. 30초부터 축소, 마지막 두 명은 3초 예고 후 결투!'),
            h('li', {}, '차지 방향을 읽고 피하세요. 풀차지끼리 정면충돌하면 둘 다 크게 튕겨요!'),
            h('li', {}, '떨어지면 👻 유령: 방향키로 떠다니다 스페이스로 🍌 바나나 깔기')));
      }
      if (S.phase === 'final') {
        const winner = who(S.placement?.[0]);
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, `👑 ${winner.name} 범퍼카 왕!`), podium(S.roster, S.standings, me));
      }
      if (!c) return h('p', { class: 'muted' }, '👀 관전 중');
      if (c.out) {
        return h('p', { class: 'bc-help' }, h('b', {}, '👻 유령'), ' · 방향키로 떠다니기 · ',
          h('kbd', {}, 'Space'), ` 🍌 바나나 깔기 (${BANANA_COOL / 1000}초마다, ${BANANA_MAX}개까지)`);
      }
      return h('p', { class: 'bc-help' }, h('kbd', {}, '←↑↓→'), ' / ', h('kbd', {}, 'WASD'), ' 밀기 · ',
        h('kbd', {}, 'Space'), ' 꾹 눌렀다 떼면 돌진 · 가장자리 조심!');
    }

    function renderPanel() {
      const c = myCar();
      const key = [S.phase, !!c, !!c?.out].join('|');
      if (key === panelKey) return;
      panelKey = key;
      panel.replaceChildren(panelView());
    }

    function renderSide() {
      const t = api.now();
      const living = S.cars.filter(c => !c.out)
        .map(c => [c.id, [(c.g || 0) > t ? '🍄' : '', (c.slip || 0) > t ? '🛢️' : '', S.kills[c.id] ? `💀${S.kills[c.id]}` : ''].join(' ').trim()]);
      const gone = [...S.outOrder].reverse().map(id => [id, S.dead[id]]);
      const key = JSON.stringify([living, gone]);
      if (key === sideKey) return;
      sideKey = key;
      const rows = living.map(([id, badges]) => h('li', { class: id === me ? 'me' : null },
        avatar(who(id)), h('span', {}, who(id).name), badges ? h('em', {}, badges) : null));
      const dead = gone.map(([id, by]) => h('li', { class: 'dead' }, avatar(who(id)), h('span', {}, who(id).name),
        h('em', {}, by && by !== '-' ? `← ${who(by).name}` : '자폭')));
      side.replaceChildren(...[
        h('h3', {}, `생존 ${rows.length}명`),
        h('ol', { class: 'bc-list' }, rows),
        dead.length ? h('h3', {}, '탈락 (👻 유령)') : null,
        dead.length ? h('ol', { class: 'bc-list' }, dead) : null,
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '← → ↑ ↓ / WASD 밀기 (8방향)'),
          h('li', {}, '스페이스 꾹 → 떼면 돌진 (최대 0.9초 모으기, 쿨타임 3초)'),
          h('li', {}, '모으는 동안은 멈춰 서서 잘 안 밀려요 (버티기)'),
          h('li', {}, '👻 유령: 방향키 이동 · 스페이스 🍌')),
      ].filter(Boolean));
    }

    return {
      update({ state }) {
        S = state;
        norm(S);
        audio.mode(S.phase === 'play', S.duelAt != null);
        box.classList.toggle('duel', S.phase === 'play' && S.duelAt != null);
        if (S.duelAt != null && seenDuel !== S.duelAt) {
          seenDuel = S.duelAt;
          if (S.phase === 'play' && api.now() - S.duelAt < DUEL_WARNING) {
            flash('⚔️ 최후의 결투 · 3초 뒤 경기장 축소!', 'duel', DUEL_WARNING);
            audio.duel();
          }
        }
        if (S.phase !== lastPhase) {
          if (S.phase === 'play' && lastPhase === 'intro') flash('GO! 🚗💨');
          if (S.phase === 'play') sendMove(true); // 미리 누르고 있던 방향키도 바로 반영
          lastPhase = S.phase;
        }
        if (S.phase === 'play' && S.duelAt == null && !warned && api.now() - S.startAt > SHRINK_AT - 3000) {
          warned = true;
          if (api.now() - S.startAt < SHRINK_AT) flash('⚠️ 3초 뒤 경기장이 줄어들어요!');
        }
        syncCars();
        syncThings(S.items, items, it => {
          const el = svg('g', { class: 'bc-item' }, svg('circle', { r: 0.5 }), svg('text', {}, ITEMS[it.k]?.emoji || '❓'));
          itemsG.append(el);
          return el;
        });
        syncThings(S.bananas, bananas, b => {
          const el = svg('g', { class: 'bc-banana' }, svg('text', {}, '🍌'));
          bananasG.append(el);
          return el;
        });
        // 유령들 (내 것은 paint에서 내 화면 위치로)
        const ghostList = Object.entries(S.ghosts).filter(([id]) => S.cars.find(c => c.id === id)?.out)
          .map(([id, g]) => ({ id, x: g.x, y: g.y }));
        syncThings(ghostList, ghosts, g => {
          const el = svg('g', { class: `bc-ghost${g.id === me ? ' mine' : ''}` },
            g.id === me ? svg('circle', { class: 'bc-aim', r: 0.6 }) : null,
            svg('text', {}, '👻'), svg('text', { class: 'bc-name', y: -0.75 }, g.id === me ? '나' : who(g.id).name));
          ghostsG.append(el);
          return el;
        });
        for (const g of ghostList) if (g.id !== me) ghosts.get(g.id)?.setAttribute('transform', `translate(${g.x} ${g.y})`);
        playFx();
        renderTop();
        renderPanel();
        renderSide();
      },
      unmount() {
        cancelAnimationFrame(raf);
        for (const id of timers) clearTimeout(id);
        timers.clear();
        audio.dispose();
        box.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', releaseAll);
      },
    };
  },
};
