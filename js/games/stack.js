// 독박쌓기: 펜토미노(5칸 블록) 12종을 돌아가며 받침대 위에 쌓는다. 블록은 물리로 미끄러지고 무너진다(planck.js).
// 빨간 기준선이 차례마다 저절로 올라간다 — 처음엔 조금, 갈수록 많이(판이 너무 길어지지 않게).
// 내가 떨군 블록까지 다 멈췄을 때 탑 꼭대기가 기준선보다 낮거나, 블록이 하나라도 받침대 밖으로 떨어지면 독박(탈락).
// 독박이 나면 기준선을 남은 탑 높이로 다시 내린다 → 다음 사람은 늘 '이번 상승폭'만 올리면 되는 선을 받는다.
// 블록 순서는 12종 가방(12개가 한 번씩 섞여 나옴)이고 NEXT에 다음 사람 블록이 보인다:
// 앞 사람은 다음 사람 블록을 보고, 그 블록으로는 올라가기 힘든 꼭대기를 남길 수 있다.
// 독박 = 탑을 넘겨준 바로 앞 차례 사람의 킬(그 사람이 통과하고 넘겼을 때만). 악마 카드는 아직 없다.
// 물리는 방장 컴퓨터만 계산하고, 다른 사람은 위치만 받아서 그린다. 블록 그림은 독박 타워와 같이 쓴다.
import { h, isTyping, josa, shuffle, AGAIN_INTRO } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';
import { cells, pieceGroup, newBag, nextInBag } from './tower.js';

const PLANCK_URL = '../vendor/planck.mjs';
const INTRO_TIME = 5000;
const RESULT_TIME = 1400;     // 통과·독박 결과를 잠깐 보여 주고 다음 차례 (그사이 기준선이 올라가는 게 보임)
const SETTLE_MAX = 5000;      // 떨군 뒤 이만큼 지나면 거의 멈춘 건 그 자리에 세우고 판정
const SETTLE_HARD = 9000;     // 아직 날아다니는 게 있어도 이때는 무조건 판정
const PLATFORM_W = 6;         // 받침대 폭 (10칸)
const PLATFORM_H = 0.6;
const GRAVITY = 15;           // 독박 타워처럼 묵직하게 (실제의 1.5배)
const DROP_GAP = 0.6;         // 떨구는 높이: 블록 맨 아래가 그 자리(블록 폭) 가장 높은 곳보다 이만큼 위
const FRICTION = 0.85;        // 블록끼리 마찰: 플라스틱 블록처럼 잘 붙게 (독박 타워는 0.7)
const FALL_Y = -2;            // 이 아래로 내려가면 떨어진 것
const X_LIMIT = 4.2;          // 조준 좌우 한계 (받침대 밖으로 조금 삐져나오게 놓을 수는 있다)
const MOVE_SPEED = 4;         // 꾹 눌렀을 때 초당
const TAP = 0.15;             // 톡 쳤을 때 (칸의 1/4)
const TOL = 0.05;             // 기준선 판정 여유: 물리로 몇 cm 가라앉는 건 봐준다
const VIEW_MAX = 16;          // 화면에 한 번에 보이는 최대 높이 (m). 이보다 높아지면 꼭대기 쪽만 따라간다
// 기준선 상승폭: 끝난 차례 수(t)에 따라 RISE_EVERY 차례마다 RISE_STEP씩 커진다 (최대 RISE_MAX)
// 처음엔 0.3 → 2차례마다 +0.15 → 최대 2.1이었는데, 관전해 보니 너무 빨리 올라가서 약 1/3 줄였고 (10차례 동안 6m → 4m),
// 한 번 더 '3차례마다'로 늦춤 (10차례 동안 3.2m)
const RISE_START = 0.2;
const RISE_STEP = 0.1;
const RISE_EVERY = 3;
const RISE_MAX = 1.5;
const Q = Math.PI / 2;

const r3 = v => Math.round(v * 1000) / 1000;
export const riseOf = t => r3(Math.min(RISE_MAX, RISE_START + RISE_STEP * Math.floor((t || 0) / RISE_EVERY)));
const aimTime = lap => Math.max(7000, 12000 - ((lap || 1) - 1) * 1500);
const clampX = x => r3(Math.max(-X_LIMIT, Math.min(X_LIMIT, Number(x) || 0)));
// 90°씩만 돌린다 (0 · 90 · 180 · 270°)
const snapA = a => r3(((((Math.round((Number(a) || 0) / Q)) % 4) + 4) % 4) * Q);

/* ───────── 블록: 펜토미노 12종 (칸 좌표, 위가 +y) ─────────
   처음 조준 방향은 밑면이 넓고 낮은 쪽으로 정의한다 (세운 채로 시작하면 그냥 스페이스만 눌러도 위태롭다) */

const LAYOUT = {
  F: [[0, 0], [1, 0], [1, 1], [2, 1], [1, 2]],
  I: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
  L: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]],
  N: [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1]],
  P: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]],
  T: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  U: [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1]],
  V: [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]],
  W: [[1, 0], [2, 0], [0, 1], [1, 1], [0, 2]],
  X: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  Y: [[0, 0], [1, 0], [2, 0], [3, 0], [2, 1]],
  Z: [[1, 0], [2, 0], [1, 1], [0, 2], [1, 2]],
};
export const PIECES = Object.keys(LAYOUT);
// 뒤집어도(좌우 거울) 돌리면 같은 모양 → Shift 뒤집기가 필요 없다
export const SYMMETRIC = new Set(['I', 'T', 'U', 'V', 'W', 'X']);

// 모양 정의: 칸마다 상자 조각. 무게중심 = 몸 기준점(0,0). f = 1이면 좌우로 뒤집은 모양
const DEFS = {};
for (const [k, list] of Object.entries(LAYOUT)) {
  for (const f of [0, 1]) {
    const parts = cells(f ? list.map(([x, y]) => [-x, y]) : list);
    const r = Math.max(...parts.map(p => Math.hypot(...p.at) + Math.hypot(...p.box)));
    DEFS[`${k}${f}`] = { name: `${k}블록`, cells: true, parts, r };
  }
}
export const defOf = (k, f) => DEFS[`${k}${f ? 1 : 0}`] || DEFS.I0;

// 칸마다 돌린 뒤의 테두리 상자 (월드 좌표): l·r = 좌우, lo·hi = 아래·위
function cellBoxes(def, x, y, a) {
  const c = Math.cos(a || 0);
  const s = Math.sin(a || 0);
  return def.parts.map(({ box: [hx, hy], at: [ax, ay] }) => {
    let l = Infinity;
    let r = -Infinity;
    let lo = Infinity;
    let hi = -Infinity;
    for (const [u, v] of [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]) {
      const px = ax + u;
      const py = ay + v;
      const X = x + px * c - py * s;
      const Y = y + px * s + py * c;
      l = Math.min(l, X);
      r = Math.max(r, X);
      lo = Math.min(lo, Y);
      hi = Math.max(hi, Y);
    }
    return { l, r, lo, hi };
  });
}

const topOfBody = b => Math.max(...cellBoxes(defOf(b.k, b.f), b.x, b.y, b.a).map(c => c.hi));

// 받침대 + 쌓인 블록의 칸들 = 위에서 떨어지는 블록이 닿을 수 있는 면
export function solidsOf(S) {
  const out = [{ l: -PLATFORM_W / 2, r: PLATFORM_W / 2, top: 0 }];
  for (const b of S.bodies || []) {
    for (const c of cellBoxes(defOf(b.k, b.f), b.x, b.y, b.a)) out.push({ l: c.l, r: c.r, top: c.hi });
  }
  return out;
}

// 떨굴 때 블록 중심 높이: 블록 맨 아래가 그 자리(블록 폭) 가장 높은 곳 + DROP_GAP. 방장·화면 미리보기가 같이 쓴다
export function spawnY(S, k, f, x, a, solids = solidsOf(S)) {
  const mine = cellBoxes(defOf(k, f), x, 0, a);
  const l = Math.min(...mine.map(c => c.l));
  const r = Math.max(...mine.map(c => c.r));
  let top = -PLATFORM_H;
  for (const s of solids) if (s.l < r && s.r > l) top = Math.max(top, s.top);
  return r3(top + DROP_GAP - Math.min(...mine.map(c => c.lo)));
}

// 똑바로 떨어뜨리면 어디에 닿나 (물리 없이 칸으로 계산한 예상): 화면의 착지 그림자 · 봇이 같이 쓴다.
// margin = 무게중심이 받쳐 주는 면 안쪽으로 들어온 거리 (0보다 작으면 넘어간다).
// 모서리 끝만 살짝 걸친 건(GRIP보다 좁게 겹침) 받침으로 안 친다: 물리에선 그 모서리를 축으로 굴러떨어진다
const GRIP = 0.15;
export function landing(S, k, f, x, a, solids = solidsOf(S)) {
  const EPS = 0.01;
  const mine = cellBoxes(defOf(k, f), x, 0, a);
  let y = -Infinity;
  for (const c of mine) {
    for (const s of solids) if (s.l < c.r - EPS && s.r > c.l + EPS) y = Math.max(y, s.top - c.lo);
  }
  if (y === -Infinity) return null; // 아래에 아무것도 없음 (받침대 밖 허공)
  let cl = Infinity;
  let cr = -Infinity;
  for (const c of mine) {
    for (const s of solids) {
      const l = Math.max(c.l, s.l);
      const r = Math.min(c.r, s.r);
      if (r - l >= GRIP && Math.abs(s.top - (c.lo + y)) < 0.02) {
        cl = Math.min(cl, l);
        cr = Math.max(cr, r);
      }
    }
  }
  const margin = cl === Infinity ? -1 : Math.min(x - cl, cr - x);
  return { y: r3(y), top: r3(y + Math.max(...mine.map(c => c.hi))), margin: r3(margin), stable: margin > 0.08 };
}

/* ───────── 물리 (방장 전용) ───────── */

let planck = null;
let loading = null;
function ensurePlanck() {
  if (planck || loading) return;
  loading = import(PLANCK_URL).then(m => { planck = m; }).catch(e => {
    loading = null;
    console.error('[stack] 물리 엔진을 불러오지 못했어요', e);
  });
}
export function usePlanck(m) { planck = m; } // 테스트용

function makeSim(S) {
  const { World, Vec2, Box } = planck;
  const world = new World({ gravity: new Vec2(0, -GRAVITY) });
  const ground = world.createBody();
  ground.createFixture(new Box(PLATFORM_W / 2, PLATFORM_H / 2, new Vec2(0, -PLATFORM_H / 2), 0), { friction: 0.9 });
  const sim = { world, bodies: new Map(), meta: new Map() };
  // 이어받은 탑은 잠든 상태로 복원해야 혼자 흔들리지 않는다
  for (const b of S.bodies || []) addBody(sim, b, false);
  return sim;
}

function addBody(sim, b, awake) {
  const { Vec2, Box } = planck;
  const def = defOf(b.k, b.f);
  const body = sim.world.createBody({ type: 'dynamic', position: new Vec2(b.x, b.y), angle: b.a || 0, awake });
  for (const { box: [hx, hy], at: [ax, ay] } of def.parts) {
    body.createFixture(new Box(hx, hy, new Vec2(ax, ay), 0), { density: 1, friction: FRICTION, restitution: 0 });
  }
  sim.bodies.set(b.id, body);
  sim.meta.set(b.id, { k: b.k, f: b.f ? 1 : 0, by: b.by });
  return body;
}

const pose = body => {
  const p = body.getPosition();
  return [r3(p.x), r3(p.y), r3(body.getAngle())];
};

// trail: 이번 틱 동안 지나간 중간 자리들 (꺾이며 움직인 블록만) → b.p
function snapshot(ctx, trail) {
  const S = ctx.state;
  let top = 0;
  S.bodies = [...ctx.sim.bodies].map(([id, body]) => {
    const [x, y, a] = pose(body);
    const m = ctx.sim.meta.get(id);
    const b = { id, k: m.k, f: m.f, by: m.by, x, y, a };
    top = Math.max(top, topOfBody(b));
    if (trail?.has(id)) b.p = trail.get(id);
    return b;
  });
  S.top = r3(top);
}

function touching(body) {
  for (let ce = body.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) return true;
  return false;
}
const flying = body => body.isAwake() && (body.getLinearVelocity().length() > 0.3 || !touching(body));

function stepFall(ctx, now) {
  const S = ctx.state;
  const sim = ctx.sim;
  const dt = Math.min(500, Math.max(0, now - (ctx.simAt || now)));
  ctx.simAt = now;
  const steps = Math.max(1, Math.round(dt / (1000 / 60)));
  // 위치는 0.1초마다 보내니, 꺾이며 움직인 블록은 틱 사이 중간 자리도 몇 개 같이 (독박 타워와 같은 방식)
  const segs = Math.min(6, Math.max(1, Math.round(steps / 2)));
  const marks = new Set(Array.from({ length: segs - 1 }, (_, k) => Math.round((steps * (k + 1)) / segs)));
  const start = new Map([...sim.bodies].map(([id, body]) => [id, pose(body)]));
  const samples = new Map();
  for (let i = 1; i <= steps; i++) {
    sim.world.step(1 / 60, 8, 3);
    if (!marks.has(i)) continue;
    for (const [id, body] of sim.bodies) {
      if (!samples.has(id)) samples.set(id, []);
      samples.get(id).push(pose(body));
    }
  }
  const trail = new Map();
  for (const [id, body] of sim.bodies) {
    const a = start.get(id);
    const list = samples.get(id);
    if (!a || list?.length !== segs - 1) continue;
    const z = pose(body);
    const bent = list.some((q, k) => q.some((v, j) => Math.abs(v - (a[j] + ((z[j] - a[j]) * (k + 1)) / segs)) > (j < 2 ? 0.02 : 0.03)));
    if (bent) trail.set(id, list);
  }
  for (const [id, body] of [...sim.bodies]) {
    const p = body.getPosition();
    if (p.y > FALL_Y && Math.abs(p.x) < 14) continue;
    sim.world.destroyBody(body);
    sim.bodies.delete(id);
    sim.meta.delete(id);
    S.toppled = (S.toppled || 0) + 1;
  }
  snapshot(ctx, trail);
  const bodies = [...sim.bodies.values()];
  const age = now - S.dropAt;
  // 다 멈췄으면 판정. 오래 걸려도 공중에 떠 있거나 빠르게 움직이는 게 있으면 결판날 때까지 기다린다
  if ((!bodies.some(b => b.isAwake()) && age > 800) || (age > SETTLE_MAX && !bodies.some(flying)) || age > SETTLE_HARD) {
    return settle(ctx, now);
  }
  return true;
}

/* ───────── 진행 ───────── */

// 블록은 12종 가방: 12개가 한 번씩 다 나와야 다시 섞는다. 남은 순서는 방장만 안다(ctx.secret)
export function drawPiece(ctx) {
  const sec = ctx.secret;
  if (!sec.pieces?.length) sec.pieces = shuffle(PIECES);
  const [k, ...rest] = sec.pieces;
  sec.pieces = rest;
  return k;
}

function rollNext(ctx, now, after) {
  const S = ctx.state;
  const id = nextInBag(S, after);
  S.next = { id, piece: drawPiece(ctx), lap: S.lap, at: now };
}

function startTurn(ctx, now) {
  const S = ctx.state;
  const n = S.next;
  const rise = riseOf(S.turnsPlayed);
  Object.assign(S, {
    phase: 'aim',
    // 독박이면 킬은 탑을 넘겨준 앞 사람 몫 (앞 사람이 통과하고 넘겼을 때만: 독박 뒤 다시 맞춘 탑은 아무도 안 넘겨준 것)
    prevTurn: S.lastResult?.ok ? S.turn : null,
    turn: n.id,
    piece: n.piece,
    turnLap: n.lap,
    rise,
    line: r3((S.line || 0) + rise),
    phaseEndsAt: now + aimTime(n.lap),
    aim: { x: 0, a: 0, f: 0 },
    pieceId: null,
    toppled: 0,
  });
  rollNext(ctx, now, S.turn);
  return true;
}

function drop(ctx, now, aim) {
  const S = ctx.state;
  S.bodyNo = (S.bodyNo || 0) + 1;
  const id = `z${S.bodyNo}`;
  const x = clampX(aim?.x);
  const a = snapA(aim?.a);
  const f = aim?.f && !SYMMETRIC.has(S.piece) ? 1 : 0;
  addBody(ctx.sim, { id, k: S.piece, f, by: S.turn, x, y: spawnY(S, S.piece, f, x, a), a }, true);
  Object.assign(S, { pieceId: id, phase: 'fall', dropAt: now, toppled: 0 });
  ctx.simAt = now;
  snapshot(ctx);
  return true;
}

function settle(ctx, now) {
  const S = ctx.state;
  const name = ctx.nameOf;
  const active = S.turn;
  // 아직 꿈틀대던 건 그 자리에 세워서(재워서) 다음 차례로 움직임이 넘어가지 않게. 다음 블록이 건드리면 다시 깨어난다
  for (const body of ctx.sim.bodies.values()) body.setAwake(false);
  snapshot(ctx); // 중간 자리(p)는 떨어지는 동안에만 필요하다
  S.turnsPlayed = (S.turnsPlayed || 0) + 1;
  const fell = S.toppled || 0;
  const short = r3(S.line - S.top);
  const ok = !fell && short <= TOL;
  S.lastResult = { id: active, ok, fell, short: ok ? 0 : Math.max(0, short), top: S.top, line: S.line, at: now };
  if (ok) {
    if (!S.best || S.top > S.best.h) S.best = { id: active, h: S.top };
    if (S.top - S.line < 0.15) S.close = { ...(S.close || {}), [active]: (S.close?.[active] || 0) + 1 };
  } else {
    const why = fell ? `블록 ${fell}개 추락` : `기준선까지 ${Math.max(0.1, short).toFixed(1)}m 모자람`;
    S.fails = [...(S.fails || []), { id: active, at: now, why }].slice(-8);
    if (S.alive.includes(active)) {
      S.alive = S.alive.filter(id => id !== active);
      S.outOrder = [...(S.outOrder || []), active];
      const killer = S.prevTurn && S.prevTurn !== active ? S.prevTurn : null;
      S.dead = { ...(S.dead || {}), [active]: killer || '-' };
      if (killer) {
        ctx.kill(killer, active, fell ? '🧨 위험한 탑 넘김' : '📏 여유 없는 탑 넘김');
        S.kills = { ...(S.kills || {}), [killer]: (S.kills?.[killer] || 0) + 1 };
      } else {
        ctx.announce(`🧩 ${name(active)} 독박! (${shapeName(S.piece)} · ${why})`);
      }
    }
    // 재조정: 무너져서 탑이 기준선보다 낮아졌으면 기준선을 남은 꼭대기로 내린다 (다음 사람이 죽은 판을 받지 않게)
    S.line = r3(Math.min(S.line, S.top));
  }
  S.toppled = 0;
  S.pieceId = null;
  if (S.alive.length <= 1) return finish(ctx);
  S.phase = 'result';
  S.phaseEndsAt = now + RESULT_TIME;
  return true;
}

const shapeName = k => defOf(k, 0).name;

function finish(ctx) {
  const S = ctx.state;
  const placement = [...S.alive, ...[...(S.outOrder || [])].reverse()];
  for (const p of S.roster || ctx.roster) if (!placement.includes(p.id)) placement.push(p.id);
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const best = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (placement[0]) add(placement[0], '🧩 퍼즐 장인');
  const [killer, kills] = best(S.kills);
  if (kills >= 1) add(killer, `🧨 함정 설계자 (${kills}킬)`);
  if (S.best?.h >= 3) add(S.best.id, `🏗️ 최고층 ${S.best.h.toFixed(1)}m`);
  const [lucky, close] = best(S.close);
  if (close >= 2) add(lucky, `😅 간신히 통과 ×${close}`);
  Object.assign(S, {
    placement,
    standings: Object.fromEntries(placement.map((id, i) => [id, placement.length - i])),
    titles,
    next: null,
    phase: 'final',
    over: true,
  });
  return true;
}

/* ───────── 봇 ───────── */

// 칸으로 계산한 착지 예상으로 후보(자리 × 회전 × 뒤집기)를 다 따져 본다: 탑이 기준선을 넘으면서 잘 받쳐지는 자리.
// 탑이 이미 기준선보다 높으면(여유) 낮은 데 깔아서 밑을 다진다. 사람처럼 손이 조금 빗나가는데(skill이 낮을수록 많이),
// 빗나간 자리가 착지 그림자로 봐서 넘어갈 자리면 다시 맞춘다 (사람도 그림자를 보고 고치니까)
export function planMove(S, k, skill = 0.8) {
  const need = (S.line || 0) + 0.08;
  const solids = solidsOf(S);
  let best = null;
  for (const f of SYMMETRIC.has(k) ? [0] : [0, 1]) {
    for (let r = 0; r < 4; r++) {
      const a = r3(r * Q);
      for (let x = -X_LIMIT; x <= X_LIMIT + 1e-9; x += 0.15) {
        const L = landing(S, k, f, r3(x), a, solids);
        if (!L || !L.stable) continue;
        const towerTop = Math.max(S.top || 0, L.top);
        const reach = towerTop >= need;
        const score = (reach ? 10 : -(need - towerTop) * 2) + Math.min(0.6, L.margin) * 4 - Math.abs(x) * 0.25 - L.top * 0.2;
        if (!best || score > best.score) best = { x: r3(x), a, f, score, top: L.top };
      }
    }
  }
  best ||= { x: 0, a: 0, f: 0, top: 0 };
  const miss = (1 - skill) * 0.5 + 0.06;
  for (let tries = 0; tries < 3; tries++) {
    const x = clampX(best.x + (Math.random() - 0.5) * 2 * miss);
    if (landing(S, k, best.f, x, best.a, solids)?.stable) return { ...best, x };
  }
  return best;
}

/* ───────── 화면 ───────── */

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}

function pieceIcon(k, color, f = 0) {
  const def = defOf(k, f);
  const r = def.r + 0.15;
  return svg('svg', { viewBox: `${-r} ${-r} ${2 * r} ${2 * r}`, class: 'tw-icon' },
    svg('g', { transform: 'scale(1,-1)' }, pieceGroup(def, color)));
}

// 착지 그림자: 칸 테두리만 점선으로
function ghostCells(def) {
  return def.parts.map(({ box: [hx, hy], at: [ax, ay] }) => svg('rect', { x: ax - hx, y: ay - hy, width: hx * 2, height: hy * 2, rx: 0.04 }));
}

export default {
  id: 'stack',
  title: '독박쌓기',
  emoji: '🧩',
  tag: '우정파괴',
  color: '#7048e8',
  desc: '펜토미노 12종을 돌아가며 쌓아요. 빨간 기준선이 차례마다 올라가요. 내가 놓은 뒤 탑이 선보다 낮거나 블록이 떨어지면 독박!',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx, prev) {
    ensurePlanck();
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + (prev ? AGAIN_INTRO : INTRO_TIME),
      again: !!prev,
      alive: ctx.roster.map(p => p.id),
      top: 0,
      line: 0,
      turnsPlayed: 0,
      lap: 0, // 가방(바퀴) 번호. 첫 가방을 섞을 때 1이 된다
    };
  },

  onInput(ctx, { pid, type, data }) {
    const S = ctx.state;
    const now = ctx.now();
    if (type === 'aim' && S.phase === 'aim' && pid === S.turn) {
      S.aim = { x: clampX(data.x), a: snapA(data.a), f: data.f && !SYMMETRIC.has(S.piece) ? 1 : 0 };
      return true;
    }
    if (type === 'drop' && S.phase === 'aim' && pid === S.turn && ctx.sim) return drop(ctx, now, data);
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (!planck) {
      ensurePlanck();
      return false; // 엔진 받는 중 (인트로 동안 충분히 받아진다)
    }
    if (!ctx.sim) {
      ctx.sim = makeSim(S);
      ctx.simAt = now;
    }
    switch (S.phase) {
      case 'intro': {
        if (now < S.phaseEndsAt) return false;
        const first = newBag(S, null);
        S.next = { id: first, piece: drawPiece(ctx), lap: S.lap, at: now };
        return startTurn(ctx, now);
      }
      case 'aim':
        if (now < S.phaseEndsAt && ctx.isOnline(S.turn)) return false;
        return drop(ctx, now, S.aim); // 시간 끝: 지금 조준한 자리에 그대로
      case 'fall':
        return stepFall(ctx, now);
      case 'result':
        return now >= S.phaseEndsAt && startTurn(ctx, now);
      default:
        return false;
    }
  },

  // 봇: 착지 예상으로 기준선을 넘는 자리를 고르고(사람처럼 조금 빗나감), 천천히 조준해서 떨군다
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase !== 'aim' || S.turn !== id) return null;
    mem.skill ??= 0.55 + Math.random() * 0.4;
    const key = `${S.turnsPlayed}`;
    if (mem.key !== key) {
      const plan = planMove(S, S.piece, mem.skill);
      Object.assign(mem, {
        key, x: S.aim?.x || 0, tx: plan.x, ta: plan.a, tf: plan.f,
        dropAt: now + 1800 + Math.random() * 3000, sent: 0,
      });
    }
    if (now >= mem.dropAt) return { type: 'drop', data: { x: mem.tx, a: mem.ta, f: mem.tf }, say: Math.random() < 0.1 };
    if (now - mem.sent > 150) {
      mem.sent = now;
      mem.x += Math.sign(mem.tx - mem.x) * Math.min(0.5, Math.abs(mem.tx - mem.x));
      return { type: 'aim', data: { x: mem.x, a: mem.ta, f: mem.tf } };
    }
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const top = h('div', { class: 'tw-top' });
    const bodiesG = svg('g');
    const ghostG = svg('g', { class: 'pz-ghost' });
    const guide = svg('line', { class: 'tw-guide', x1: 0, y1: 0, x2: 0, y2: 0 });
    const previewPiece = svg('g');
    const previewG = svg('g', { class: 'tw-preview' }, guide, previewPiece);
    const lineText = svg('text', { class: 'pz-line-label', transform: 'translate(-6.75 0.14) scale(1,-1)' });
    const lineG = svg('g', { class: 'pz-line' }, svg('line', { class: 'pz-line-bar', x1: -30, y1: 0, x2: 30, y2: 0 }), lineText);
    const platform = svg('g', {},
      svg('rect', { x: -0.35, y: -9, width: 0.7, height: 9 - PLATFORM_H, fill: '#34495e' }),
      svg('rect', { x: -PLATFORM_W / 2, y: -PLATFORM_H, width: PLATFORM_W, height: PLATFORM_H, rx: 0.08, fill: '#34495e', stroke: '#2c3e50', 'stroke-width': 0.08 }),
      svg('rect', { x: -PLATFORM_W / 2 + 0.06, y: -0.16, width: PLATFORM_W - 0.12, height: 0.12, rx: 0.04, fill: '#4f6b85' }));
    // 블록 광택 (독박 타워 그림과 같은 #tw-shine)
    const shine = svg('linearGradient', { id: 'tw-shine', x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: 0, 'stop-color': '#000', 'stop-opacity': 0.22 }),
      svg('stop', { offset: 0.45, 'stop-color': '#fff', 'stop-opacity': 0 }),
      svg('stop', { offset: 0.8, 'stop-color': '#fff', 'stop-opacity': 0.28 }),
      svg('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0.5 }));
    const stage = svg('svg', { class: 'tw-svg', preserveAspectRatio: 'xMidYMax meet' },
      svg('defs', {}, shine),
      svg('g', { transform: 'scale(1,-1)' }, platform, bodiesG, ghostG, lineG, previewG));
    const fx = h('div', { class: 'tw-fx' });
    const nextBox = h('div', { class: 'tw-next', hidden: true });
    const stageWrap = h('div', { class: 'tw-stage' }, stage, nextBox, fx);
    const panel = h('div', { class: 'tw-panel' });
    const box = h('div', { class: 'tw-box' }, top, stageWrap, panel);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'tw pz' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    let solids = [];
    const shown = new Map(); // id → { el, keys, t }
    let camTop = 9;
    let lineShown = 0;
    let topKey = '';
    let panelKey = '';
    let nextKey = '';
    let sideKey = '';
    let ghostKey = '';
    let predEl = null;
    let seenFail = null;
    let seenLap = null;
    let seenRise = null;
    // 내 차례일 때 조준 (내 화면에서 바로 움직이고, 방장에게는 가끔 알려 준다)
    const aim = { x: 0, a: 0, f: 0, turnKey: '', dropped: false, sentAt: 0, sent: '' };
    const held = { left: false, right: false };
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const colorOf = id => who(id).color;
    const myTurn = () => S?.phase === 'aim' && S.turn === me;
    const m1 = v => `${(v || 0).toFixed(1)}m`;
    const m2 = v => `${Number((v || 0).toFixed(2))}m`; // 상승폭은 0.45m처럼 그대로

    function onKey(e) {
      if (isTyping(e) || !S) return;
      const down = e.type === 'keydown';
      const c = e.code;
      // 스페이스·방향키로 페이지가 스크롤되지 않게 (작은 화면에서 위쪽 기준선·타이머가 가려진다)
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
      if (c === 'ArrowLeft' || c === 'KeyA' || c === 'ArrowRight' || c === 'KeyD') {
        if (!myTurn()) return;
        const left = c === 'ArrowLeft' || c === 'KeyA';
        held[left ? 'left' : 'right'] = down;
        // 톡 치면 조금(미세 조정), 꾹 누르면 계속 이동
        if (down && !e.repeat && !aim.dropped) {
          aim.x = clampX(aim.x + (left ? -TAP : TAP));
          sendAim();
        }
        return;
      }
      if (!down || !myTurn() || aim.dropped) return;
      if (c === 'ArrowUp' || c === 'KeyW' || c === 'ArrowDown' || c === 'KeyS') {
        aim.a = snapA(aim.a + (c === 'ArrowUp' || c === 'KeyW' ? 1 : -1) * Q);
        sendAim();
      } else if ((c === 'ShiftLeft' || c === 'ShiftRight') && !e.repeat && !SYMMETRIC.has(S.piece)) {
        aim.f = aim.f ? 0 : 1;
        sendAim();
      } else if (c === 'Space' && !e.repeat) {
        aim.dropped = true;
        api.send('drop', { x: aim.x, a: aim.a, f: aim.f });
        renderPanel();
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    function sendAim() {
      const key = `${aim.x.toFixed(2)}:${aim.a.toFixed(3)}:${aim.f}`;
      if (key === aim.sent) return;
      aim.sent = key;
      aim.sentAt = performance.now();
      api.send('aim', { x: aim.x, a: aim.a, f: aim.f });
    }

    function syncBodies() {
      const now = performance.now();
      const live = new Set();
      for (const b of S.bodies || []) {
        live.add(b.id);
        const it = shown.get(b.id);
        if (!it) {
          const el = pieceGroup(defOf(b.k, b.f), colorOf(b.by));
          bodiesG.append(el);
          shown.set(b.id, { el, keys: [b, b], t: now });
          continue;
        }
        const last = it.keys[it.keys.length - 1];
        if (last.x === b.x && last.y === b.y && last.a === b.a) continue; // 이 블록은 안 움직임
        // 지금 그리던 자리 → 방장이 보낸 중간 자리들 → 새 자리를 차례로 따라간다
        it.keys = [current(it, now), ...(b.p || []).map(([x, y, a]) => ({ x, y, a })), b];
        it.t = now;
      }
      for (const [id, it] of shown) {
        if (live.has(id)) continue;
        it.el.remove();
        shown.delete(id);
      }
    }

    function current(it, now) {
      const { keys } = it;
      const k = Math.min(1, (now - it.t) / 110) * (keys.length - 1);
      const i = Math.min(keys.length - 2, Math.floor(k));
      const f = k - i;
      const p = keys[i];
      const q = keys[i + 1];
      let da = q.a - p.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, a: p.a + da * f };
    }

    function paint() {
      if (!S) return;
      const now = performance.now();
      if (myTurn() && !aim.dropped) {
        const dt = Math.min(0.05, (now - (aim.last || now)) / 1000);
        const dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
        if (dir) aim.x = clampX(aim.x + dir * MOVE_SPEED * dt);
        if (now - aim.sentAt > 120) sendAim();
      }
      aim.last = now;
      for (const it of shown.values()) {
        const p = current(it, now);
        it.el.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${(p.a * 180) / Math.PI})`);
      }
      // 기준선: 올라가거나 다시 맞춰질 때 스르륵
      lineShown += ((S.line || 0) - lineShown) * 0.12;
      lineG.setAttribute('transform', `translate(0 ${lineShown.toFixed(3)})`);
      // 조준 중: 떨어질 자리(미리보기) + 착지 예상 그림자 (기준선을 넘으면 초록, 모자라면 빨강)
      if (S.phase === 'aim' && S.piece) {
        const p = myTurn() ? aim : S.aim || { x: 0, a: 0, f: 0 };
        const f = p.f ? 1 : 0;
        const def = defOf(S.piece, f);
        const key = `${S.turnsPlayed}:${S.piece}:${f}`;
        if (ghostKey !== key) {
          ghostKey = key;
          previewPiece.replaceChildren(pieceGroup(def, colorOf(S.turn)));
          ghostG.replaceChildren(...ghostCells(def));
        }
        const y = spawnY(S, S.piece, f, p.x, p.a, solids);
        previewG.style.display = '';
        previewG.setAttribute('transform', `translate(${p.x} ${y})`);
        guide.setAttribute('y2', -y - 1);
        previewPiece.setAttribute('transform', `rotate(${(p.a * 180) / Math.PI})`);
        const L = landing(S, S.piece, f, p.x, p.a, solids);
        ghostG.style.display = L ? '' : 'none';
        if (L) {
          const ok = L.top >= S.line - TOL;
          ghostG.setAttribute('class', `pz-ghost ${ok && L.stable ? 'ok' : 'bad'}`);
          ghostG.setAttribute('transform', `translate(${p.x} ${L.y}) rotate(${(p.a * 180) / Math.PI})`);
        }
        if (predEl) {
          predEl.textContent = !L ? '⚠️ 받침대 밖이에요 (떨어짐)'
            : L.top >= S.line - TOL ? `예상 꼭대기 ${m1(Math.max(L.top, S.top))} ✅ 기준선 넘음${L.stable ? '' : ' · 😬 기울어질 듯'}`
              : `예상 꼭대기 ${m1(Math.max(L.top, S.top))} ❌ ${m1(S.line - Math.max(L.top, S.top))} 모자람`;
        }
      } else {
        previewG.style.display = 'none';
        ghostG.style.display = 'none';
      }
      // 카메라: 탑이나 기준선이 높아지면 위로. 처음엔 받침대까지 다 보이다가, 16m보다 높이 봐야 하면
      // 꼭대기 쪽만 따라 올라간다 (탑이 10m를 넘어도 블록이 너무 작아져서 조준이 힘들어지지 않게)
      const want = Math.max(9, Math.max(S.top || 0, S.line || 0) + 5.5);
      camTop += (want - camTop) * 0.08;
      const span = Math.min(VIEW_MAX, camTop + 3);
      const w = (14 * span) / 12;
      stage.setAttribute('viewBox', `${(-w / 2).toFixed(3)} ${(-camTop).toFixed(3)} ${w.toFixed(3)} ${span.toFixed(3)}`);
      lineText.setAttribute('transform', `translate(${(-w / 2 + 0.25).toFixed(3)} 0.14) scale(1,-1)`);
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function flash(text, cls = '') {
      const el = h('div', { class: `tw-flash ${cls}` }, text);
      fx.append(el);
      setTimeout(() => el.remove(), 1800);
    }

    function shake() {
      box.classList.add('shaking');
      setTimeout(() => box.classList.remove('shaking'), 500);
    }

    function checkEvents() {
      if (seenLap !== null && S.turnLap > seenLap && S.turnLap > 1) flash(`🎲 ${S.turnLap}바퀴! 순서 다시 섞음`);
      seenLap = S.turnLap || 0;
      if (seenRise !== null && S.rise > seenRise && S.phase === 'aim') flash(`⬆️ 기준선이 더 빨리 올라가요 (차례마다 +${m2(S.rise)})`);
      if (S.rise) seenRise = S.rise;
      const fails = S.fails || [];
      if (seenFail === null) {
        seenFail = Math.max(0, ...fails.map(x => x.at));
        return;
      }
      for (const f of fails) {
        if (f.at <= seenFail) continue;
        seenFail = f.at;
        flash(`💥 ${who(f.id).name} 독박!`, 'bad');
        shake();
      }
    }

    function renderTop() {
      const gap = r3((S.top || 0) - (S.line || 0));
      const timer = S.phase === 'aim' ? [S.phaseEndsAt, aimTime(S.turnLap)] : null;
      const key = JSON.stringify([S.turnLap, S.top, S.line, S.phase === 'aim', timer]);
      if (key === topKey) return;
      topKey = key;
      const started = ['aim', 'fall', 'result'].includes(S.phase);
      top.replaceChildren(...[
        h('span', {}, S.turnLap ? `${S.turnLap}바퀴` : '곧 시작'),
        h('span', {}, `탑 ${m1(S.top)}`),
        started ? h('span', {}, `기준선 ${m1(S.line)}`) : null,
        started && S.phase === 'aim'
          ? h('span', { class: `pz-chip ${gap >= -TOL ? 'ok' : 'bad'}` }, gap >= -TOL ? `여유 +${m1(Math.max(0, gap))}` : `${m1(-gap)} 더 올려야 함`)
          : null,
        timer ? countdown(timer[0], timer[1]) : null,
      ].filter(Boolean));
    }

    // NEXT: 다음 사람과 그 사람 블록 (12종 가방이라 미리 공개)
    function renderNext() {
      const n = S.next;
      const show = !!n && ['aim', 'fall', 'result'].includes(S.phase);
      nextBox.hidden = !show;
      if (!show) return;
      const key = `${n.id}:${n.at}:${n.piece}`;
      if (key === nextKey) return;
      nextKey = key;
      nextBox.replaceChildren(
        h('div', { class: 'tw-next-label' }, n.id === me ? 'NEXT · 나!' : 'NEXT'),
        h('div', { class: 'name-chip' }, avatar(who(n.id)), who(n.id).name),
        h('div', { class: 'tw-next-reel' }, pieceIcon(n.piece, colorOf(n.id))),
        h('div', { class: 'tw-next-piece' }, shapeName(n.piece)));
    }

    function panelView() {
      predEl = null;
      if (S.phase === 'intro') {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '🧩 독박쌓기'),
          S.again ? null : h('ul', { class: 'rules big' },
            h('li', {}, '돌아가며 받침대 위에 펜토미노(5칸 블록)를 하나씩 떨궈요. 12종이 한 바퀴씩 섞여 나오고 NEXT에 다음 사람 블록이 보여요'),
            h('li', {}, '빨간 기준선이 차례마다 올라가요. 내가 놓은 뒤 탑 꼭대기가 기준선보다 낮으면 독박!'),
            h('li', {}, '블록이 하나라도 떨어져도 독박 · 독박 나면 기준선은 남은 탑 높이로 다시 맞춰져요'),
            h('li', {}, '기준선은 처음엔 조금씩, 갈수록 많이 올라가요'),
            h('li', {}, '독박은 탑을 넘겨준 앞 사람의 킬 (다음 사람 블록을 보고 꼭대기를 괴롭게 남겨 보세요)'),
            h('li', {}, '← → 이동 · ↑ ↓ 90° 돌리기 · Shift 뒤집기 · 스페이스 떨구기')),
          countdown(S.phaseEndsAt, S.again ? AGAIN_INTRO : INTRO_TIME));
      }
      if (S.phase === 'final') {
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, `👑 ${who(S.placement?.[0]).name} 퍼즐 장인!`), podium(S.roster, S.standings, me));
      }
      const piece = shapeName(S.piece);
      if (S.phase === 'aim') {
        if (S.turn === me) {
          if (aim.dropped) return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '떨궜다! 🙏'));
          predEl = h('p', { class: 'pz-pred' });
          return h('div', { class: 'bt-act' },
            h('div', { class: 'bt-act-title hot' }, `내 차례! ${piece}`),
            h('p', {}, `기준선 ${m1(S.line)}까지 · 지금 꼭대기 ${m1(S.top)}`),
            predEl,
            h('p', { class: 'muted' }, `← → 이동 · ↑ ↓ 90° 돌리기${SYMMETRIC.has(S.piece) ? '' : ' · Shift 뒤집기'} · 스페이스 떨구기`));
        }
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `${who(S.turn).name} 차례`),
          h('p', {}, `${piece} · 기준선 ${m1(S.line)}까지`),
          S.next?.id === me ? h('p', { class: 'muted' }, `😰 다음은 나! 내 블록은 ${shapeName(S.next.piece)}`) : null);
      }
      if (S.phase === 'fall') {
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '떨어지는 중… 😬'), h('p', {}, `기준선 ${m1(S.line)}`));
      }
      if (S.phase === 'result') {
        const r = S.lastResult;
        const why = !r || r.ok ? '' : r.fell ? `블록 ${r.fell}개 추락` : `기준선까지 ${m1(Math.max(0.1, r.short))} 모자람`;
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, r && !r.ok ? `💥 ${who(r.id).name} 독박! (${why})` : `✅ 통과! 꼭대기 ${m1(r?.top)}`),
          h('p', {}, `다음: ${who(S.next.id).name} · ${shapeName(S.next.piece)} · 기준선 +${m2(riseOf(S.turnsPlayed))}`));
      }
      return h('div');
    }

    function renderPanel() {
      const key = [S.phase, S.turnsPlayed, S.turn, aim.dropped, S.next?.id].join('|');
      if (key === panelKey) return;
      panelKey = key;
      panel.replaceChildren(panelView());
    }

    function renderSide() {
      // 떨어지는 동안엔 상태가 초당 10번 오니, 순서·탈락이 바뀔 때만 다시 그린다 (얼굴 그림이 무거움)
      const key = JSON.stringify([S.lap, S.alive, S.turn, S.next?.id, S.bag, S.bagPos, S.outOrder, S.dead, S.rise]);
      if (key === sideKey) return;
      sideKey = key;
      const deadList = (S.outOrder || []).map(id => {
        const by = S.dead?.[id];
        return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${josa(who(by).name, '이', '가')} 넘긴 탑` : ' 🧩 독박');
      });
      const bag = (S.bag || []).map((id, i) => {
        const dead = !S.alive.includes(id);
        const cls = dead ? 'dead' : id === S.turn ? 'now' : id === S.next?.id ? 'next' : i < (S.bagPos ?? 0) ? 'done' : '';
        return h('li', { class: cls }, avatar(who(id)), h('span', {}, who(id).name),
          cls === 'now' ? h('em', {}, '차례') : cls === 'next' ? h('em', {}, '다음') : cls === 'done' ? h('em', {}, '✓') : null);
      });
      side.replaceChildren(...[
        h('h3', {}, S.lap ? `${S.lap}바퀴 순서 · 생존 ${S.alive.length}명` : `생존 ${S.alive.length}명`),
        bag.length
          ? h('ol', { class: 'tw-bag' }, bag)
          : h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), who(id).name))),
        S.rise ? h('p', { class: 'muted small' }, `기준선: 지금 차례마다 +${m2(S.rise)} (갈수록 커짐)`) : null,
        deadList.length ? h('h3', {}, '독박 기록') : null,
        deadList.length ? h('ul', { class: 'rules' }, deadList) : null,
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '← → (A D) 이동 · 톡 치면 미세 조정'),
          h('li', {}, '↑ ↓ (W S) 90° 돌리기'),
          h('li', {}, 'Shift 좌우 뒤집기'),
          h('li', {}, '스페이스 떨구기'),
          h('li', {}, '점선 그림자 = 떨어질 자리 (초록이면 기준선 넘음)')),
      ].filter(Boolean));
    }

    return {
      update({ state }) {
        S = state;
        solids = solidsOf(S);
        const turnKey = `${S.turnsPlayed}:${S.turn}`;
        if (aim.turnKey !== turnKey) {
          Object.assign(aim, { turnKey, x: S.aim?.x || 0, a: 0, f: 0, dropped: false, sent: '' });
          held.left = held.right = false;
          if (S.turn === me && S.phase === 'aim' && S.alive?.includes(me)) flash('👉 내 차례!');
        }
        if (S.phase === 'intro') lineShown = 0;
        lineText.textContent = `기준선 ${m1(S.line)}`;
        lineG.classList.toggle('safe', (S.top || 0) >= (S.line || 0) - TOL);
        lineG.style.display = ['aim', 'fall', 'result'].includes(S.phase) ? '' : 'none';
        syncBodies();
        checkEvents();
        renderTop();
        renderNext();
        renderPanel();
        renderSide();
      },
      unmount() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
      },
    };
  },
};
