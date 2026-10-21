// 독박빼기: 와바바박 쌓인 잡동사니 탑에서 돌아가며 물건 하나를 '아예 빼 버린다'. 그게 없어도 탑이 버티면 성공,
// 뭐라도 바닥에 떨어지면 독박(탈락). 독박이 나면 새 탑을 다시 쌓는다.
// 내 차례: 방향키로 커서를 옮겨 아무 물건이나 고르고, 스페이스 → 손 떨림 게이지가 왔다 갔다 → 스페이스로 멈춤.
// 초록 칸이면 살살 쏙, 빨간 칸에 가까울수록 확 잡아빼서 닿아 있던 물건들이 툭 흔들린다.
// 😈 악마 카드(1인 1장) = 손 떨림 저주: 내 차례가 끝나면 다음 사람 게이지를 2배 빠르게, 초록 칸을 절반으로.
// (예전엔 뺄 물건을 지목했는데, 후보가 '초록이면 버티는 것'뿐이라 오히려 살 길을 알려 주는 꼴이었다)
// 독박 = 저주 건 사람의 킬, 없으면 바로 앞 차례 사람의 킬(위험한 탑을 넘겼으니). 3차례마다 어려워진다.
// 하늘에서 잡동사니 투하는 없다: 아슬아슬한 탑을 투하가 대신 무너뜨리면 아무도 독박을 안 받아서 김이 샌다.
// 물리는 방장 컴퓨터만 계산한다(planck.js, js/vendor). 다른 사람은 위치만 받아서 그린다.
import { h, isTyping, josa, pick, shuffle, digitOf } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';
import { KINDS } from './pullout-art.js';

const PLANCK_URL = '../vendor/planck.mjs';
const GRAVITY = 12;
const PLAT_HALF = 1.6;        // 받침대 반폭 (탑 폭 2.5m보다 조금 넓다. 무너지면 대개 바닥까지)
const PLAT_TOP = 0.6;         // 받침대 윗면 (바닥은 0)
const LAYERS = 7;              // 나란히·가로·나란히·가로·나란히·가로·꼭대기 장식
const BUILD_GAP = 90;         // 탑 쌓을 때 하나씩 놓는 간격 (와바바박)
const DECIDE_TIME = 5000;
const RESULT_TIME = 1000;
const SETTLE_MAX = 5000;      // 이만큼 지나면 거의 멈춘 건 그대로 세우고 판정
const SETTLE_HARD = 9000;     // 아직 날아다녀도 이때는 무조건 판정
const JOLT = 2.6;             // 빨간 칸 끝에서 닿아 있던 물건을 치는 속도 (m/s)
const DEVIL_CARDS = 1;
// 난이도 단계: 인원과 상관없이 3차례마다 한 단계씩 (제한시간↓, 게이지 빨라지고 초록 칸 좁아짐)
const levelOf = turns => 1 + Math.floor(turns / 3);
const turnTime = level => Math.max(6000, 12000 - (level - 1) * 1200);
const placeTime = level => Math.max(5000, 9000 - (level - 1) * 700); // 뺀 물건을 맨 위에 올리는 시간
const PLACE_GAP = 0.6;        // 올릴 때 물건 맨 아래가 탑 꼭대기보다 이만큼 위에서 떨어진다
const MOVE_SPEED = 3;         // 올릴 자리 옮기는 속도 (m/s)
const gaugePeriod = level => Math.max(700, 1400 - (level - 1) * 120);
const greenWidth = level => Math.max(0.08, 0.26 - (level - 1) * 0.03);
const CURSE = 0.5; // 😈 저주받은 차례: 게이지 한 바퀴 시간과 초록 칸이 이만큼 (그리고 덜컥 2배, shakeOf)
const gaugeOf = S => {
  const c = S.cursedBy ? CURSE : 1;
  return { period: gaugePeriod(S.level || 1) * c, w: greenWidth(S.level || 1) * c };
};
// 게이지: 0 → 1 → 0 왕복. 가운데(0.5)가 초록
export const gaugeAt = (aim, t) => {
  const ph = (((t - aim.at) / aim.period) % 1 + 1) % 1;
  return ph < 0.5 ? ph * 2 : 2 - ph * 2;
};
// 흔들림 세기: 초록 칸 안이면 0, 끝(0이나 1)으로 갈수록 1
export const joltOf = (v, w) => Math.max(0, Math.min(1, (Math.abs(v - 0.5) - w / 2) / (0.5 - w / 2)));
// 손 떨림 바닥값: 단계가 오를수록 초록에서 빼도 조금씩 흔들린다 (2단계부터)
const tremor = level => Math.min(0.7, (level - 1) * 0.12);
// 실제로 치는 세기 (단계가 오를수록 덜컥도 더 세다). 저주받으면 덜컥만 2배 — 초록에 맞히면 보통과 같아서 살 길은 그대로
const shakeOf = (j, level, cursed = false) => Math.max(j * (cursed ? 2 : 1), tremor(level)) * (1 + 0.15 * (level - 1));

const r3 = v => Math.round(v * 1000) / 1000;
const r2 = v => Math.round(v * 100) / 100;
const kindOf = k => KINDS[k] || KINDS.box;

// 물건 끝점 (모양·회전 반영): 탑 설계, 떨굴 높이, 화면 커서 위치용
function extent(k, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  const add = (x, y) => {
    const X = x * c - y * s;
    const Y = x * s + y * c;
    lo = [Math.min(lo[0], X), Math.min(lo[1], Y)];
    hi = [Math.max(hi[0], X), Math.max(hi[1], Y)];
  };
  for (const part of kindOf(k).parts) {
    const [ax, ay] = part.at || [0, 0];
    if (part.circle) {
      for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(ax + u * part.circle, ay + v * part.circle);
    } else if (part.box) {
      for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(ax + u * part.box[0], ay + v * part.box[1]);
    } else {
      for (const [x, y] of part.poly) add(x + ax, y + ay);
    }
  }
  return { lo, hi };
}

/* ───────── 탑 설계: 젠가처럼 '같은 물건 나란히' 층과 '긴 것 하나 가로로' 층을 번갈아 ─────────
   윗면이 평평해서 탑이 제대로 선다. 가운데 것을 빼면 위의 다리가 양 끝에 걸쳐 버티고(젠가처럼),
   끝 것이나 다리를 빼면 위험하다. 빼면 뺄수록 구멍이 늘어 점점 어려워진다. */

const BLOCKS = [['box', 3], ['micro', 3], ['drum', 3], ['shelf', 3], ['fridge', 2], ['tv', 2], ['box', 3], ['drum', 3]];
const BRIDGES = ['mattress', 'ladder', 'door', 'sofa', 'mattress', 'door'];
const TOPPERS = ['chair', 'pot', 'bowling', 'tire', 'box', 'tv', 'micro'];

export function planTower() {
  const plan = [];
  let y = PLAT_TOP;
  const place = (k, x) => {
    const e = extent(k, 0);
    plan.push({ k, a: 0, x: r3(x), y: r3(y - e.lo[1] + 0.01) });
    return e.hi[1] - e.lo[1];
  };
  const blocks = shuffle(BLOCKS);
  for (let L = 0; L < LAYERS; L++) {
    let h = 0;
    if (L === LAYERS - 1) {
      // 꼭대기 장식 1~2개
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) h = Math.max(h, place(pick(TOPPERS), n === 1 ? (Math.random() - 0.5) * 0.6 : (i ? 0.6 : -0.6) + (Math.random() - 0.5) * 0.2));
    } else if (L % 2 === 1) {
      h = place(pick(BRIDGES), (Math.random() - 0.5) * 0.16);
    } else {
      const [k, n] = blocks[L / 2];
      const w = extent(k, 0).hi[0] * 2;
      const gap = 0.05;
      const span = n * w + (n - 1) * gap;
      const skip = n === 3 && Math.random() < 0.2 ? 1 : -1; // 가끔 가운데가 비어 있다
      for (let i = 0; i < n; i++) {
        if (i === skip) continue;
        h = Math.max(h, place(k, -span / 2 + w / 2 + i * (w + gap) + (Math.random() - 0.5) * 0.08));
      }
    }
    y += h + 0.01;
  }
  return plan;
}

/* ───────── 물리 (방장 전용) ───────── */

let planck = null;
let loading = null;
function ensurePlanck() {
  if (planck || loading) return;
  loading = import(PLANCK_URL).then(m => { planck = m; }).catch(e => {
    loading = null;
    console.error('[pullout] 물리 엔진을 불러오지 못했어요', e);
  });
}
export function usePlanck(m) { planck = m; } // 테스트용
export const testSurvey = (S, level) => survey(S, level); // 테스트용
export const testPull = (S, id, j, level, seed) => trialPull(S, id, shakeOf(j, level), seed); // 테스트용

function newWorld() {
  const { World, Vec2, Box } = planck;
  const world = new World({ gravity: new Vec2(0, -GRAVITY) });
  const floor = world.createBody();
  floor.createFixture(new Box(40, 0.5, new Vec2(0, -0.5), 0), { friction: 0.8 });
  world.createBody().createFixture(new Box(PLAT_HALF, PLAT_TOP / 2, new Vec2(0, PLAT_TOP / 2), 0), { friction: 0.9 });
  return { world, floor, bodies: new Map(), kinds: new Map() };
}

function makeSim(S) {
  const sim = newWorld();
  for (const b of S.bodies || []) addBody(sim, b, false); // 이어받은 탑은 잠든 채로
  return sim;
}

function addBody(sim, b, awake) {
  const { Vec2, Box, Circle, Polygon } = planck;
  const def = kindOf(b.k);
  // 둥근 건 구름 저항(각 감쇠): 풀려나면 데굴데굴 가다가 멈춘다
  const body = sim.world.createBody({ type: 'dynamic', position: new Vec2(b.x, b.y), angle: b.a || 0, awake, angularDamping: def.rolling || 0 });
  for (const part of def.parts) {
    const [ax, ay] = part.at || [0, 0];
    const shape = part.box ? new Box(part.box[0], part.box[1], new Vec2(ax, ay), 0)
      : part.circle ? new Circle(new Vec2(ax, ay), part.circle)
        : new Polygon(part.poly.map(([x, y]) => new Vec2(x + ax, y + ay)));
    body.createFixture(shape, { density: def.density, friction: def.friction, restitution: 0 });
  }
  body.setUserData(b.id);
  sim.bodies.set(b.id, body);
  sim.kinds.set(b.id, b.k);
  return body;
}

function removeBody(sim, id) {
  const body = sim.bodies.get(id);
  if (body) sim.world.destroyBody(body);
  sim.bodies.delete(id);
  sim.kinds.delete(id);
}

// 바닥에 닿았거나 멀리 날아간 물건
function floorTouches(sim) {
  const ids = new Set();
  for (let ce = sim.floor.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) ids.add(ce.other.getUserData());
  for (const [id, body] of sim.bodies) {
    const p = body.getPosition();
    if (p.y < -2 || Math.abs(p.x) > 14) ids.add(id);
  }
  return ids;
}

function touching(body) {
  for (let ce = body.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) return true;
  return false;
}
const flying = body => body.isAwake() && (body.getLinearVelocity().length() > 0.3 || !touching(body));

// 닿아 있는 잡동사니들
function neighbors(sim, body) {
  const ids = new Set();
  for (let ce = body.getContactList(); ce; ce = ce.next) {
    const id = ce.other.getUserData();
    if (ce.contact.isTouching() && sim.bodies.has(id)) ids.add(id);
  }
  return ids;
}

// 위에 뭐가 얹혀 있나 (닿은 면의 방향으로 판단)
function loaded(sim, body) {
  for (let ce = body.getContactList(); ce; ce = ce.next) {
    const c = ce.contact;
    if (!c.isTouching() || !sim.bodies.has(ce.other.getUserData())) continue;
    const n = c.getWorldManifold(null).normal;
    if ((c.getFixtureA().getBody() === body ? n.y : -n.y) > 0.4) return true;
  }
  return false;
}
// 젠가 규칙: 위에 아무것도 안 얹힌 물건은 못 뺀다 (그런 것만 남았으면 아무거나)
function freeIds(sim) {
  const free = [...sim.bodies].filter(([, b]) => !loaded(sim, b)).map(([id]) => id);
  return free.length === sim.bodies.size ? [] : free;
}

// 빼는 순간: 물건이 쏙 사라지고, 손이 떨렸으면(j>0) 닿아 있던 것들을 옆으로 툭 친다
function yank(sim, id, j, rand = Math.random) {
  const body = sim.bodies.get(id);
  if (!body) return;
  const near = neighbors(sim, body);
  removeBody(sim, id);
  for (const b of sim.bodies.values()) b.setAwake(true);
  if (j <= 0) return;
  for (const oid of near) {
    const o = sim.bodies.get(oid);
    const m = o.getMass();
    const side = (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5);
    o.applyLinearImpulse(new planck.Vec2(m * JOLT * j * side, m * 0.8 * j), o.getWorldCenter(), true);
  }
}

const pose = body => {
  const p = body.getPosition();
  return [r3(p.x), r3(p.y), r3(body.getAngle())];
};

// 물리를 시간만큼 돌린다. 위치는 0.1초마다 보내니, 꺾이며 움직인 물건은 중간 자리(p)도 같이 (독박 타워와 같은 방식)
function stepPhysics(ctx, now) {
  const sim = ctx.sim;
  const dt = Math.min(500, Math.max(0, now - (ctx.simAt || now)));
  ctx.simAt = now;
  const steps = Math.max(1, Math.round(dt / (1000 / 60)));
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
  return trail;
}

function snapshot(ctx, trail, now) {
  const S = ctx.state;
  const sim = ctx.sim;
  let top = PLAT_TOP;
  S.bodies = [...sim.bodies].map(([id, body]) => {
    const [x, y, a] = pose(body);
    const k = sim.kinds.get(id);
    top = Math.max(top, y + extent(k, a).hi[1]);
    const b = { id, k, x, y, a };
    if (trail?.has(id)) b.p = trail.get(id);
    return b;
  });
  S.top = r3(top);
  if (now) S.fx = (S.fx || []).filter(e => now - e.at < 1500);
}

function fx(S, now, e) {
  S.fxNo = (S.fxNo || 0) + 1;
  S.fx = [...(S.fx || []), { n: S.fxNo, at: now, ...e }].slice(-6);
}

function freeze(ctx) {
  for (const body of ctx.sim.bodies.values()) body.setAwake(false);
}

function clearFallen(ctx) {
  for (const id of floorTouches(ctx.sim)) removeBody(ctx.sim, id);
}

/* ───────── 시험 빼기: 살 길 보장·봇 판단용 ───────── */

// 같은 탑을 따로 만들어 이 물건을 이 세기로 빼 보고, 바닥에 떨어지는 게 없나
// (높은 탑은 천천히 기울다 넘어가서 2초로는 모자라다 → 다 멈추거나 4초까지)
function trialPull(S, id, j, seed = 1) {
  const sim = newWorld();
  for (const b of S.bodies) addBody(sim, b, true);
  sim.world.step(1 / 60, 8, 3); // 닿은 것 계산
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  yank(sim, id, j, rand);
  for (let i = 1; i <= 240; i++) {
    sim.world.step(1 / 60, 8, 3);
    if (i % 6) continue;
    if (floorTouches(sim).size) return false;
    if (i > 60 && ![...sim.bodies.values()].some(b => b.isAwake())) return true;
  }
  return true;
}

// 뺄 수 있는 물건마다: 초록에서 빼면 버티나(safe), 손이 좀 떨려도 버티나(steady) — 그 단계 손 떨림 기준
function survey(S, level) {
  const free = new Set(S.free || []);
  return S.bodies.filter(b => !free.has(b.id)).map((b, i) => {
    const safe = trialPull(S, b.id, shakeOf(0, level), 3 + i);
    return { id: b.id, safe, steady: safe && trialPull(S, b.id, shakeOf(0.5, level), 7 + i) };
  });
}

/* ───────── 진행 ───────── */

// 순서는 독박 타워처럼 바퀴마다 섞어서 모두 한 번씩 (방금 둔 사람이 새 바퀴 첫 순서가 되지 않게)
function newBag(S, justPlayed) {
  const bag = shuffle(S.alive);
  if (bag.length > 1 && bag[0] === justPlayed) {
    const k = 1 + Math.floor(Math.random() * (bag.length - 1));
    [bag[0], bag[k]] = [bag[k], bag[0]];
  }
  Object.assign(S, { bag, bagPos: 0, lap: (S.lap || 0) + 1 });
  return bag[0];
}
function nextInBag(S, justPlayed) {
  const bag = S.bag || [];
  for (let i = (S.bagPos ?? -1) + 1; i < bag.length; i++) {
    if (!S.alive.includes(bag[i])) continue;
    S.bagPos = i;
    return bag[i];
  }
  return newBag(S, justPlayed);
}

const canUseCard = (S, pid) => S.phase === 'decide' && pid === S.turn && (S.cards?.[pid] || 0) > 0 && !!S.next && !S.next.curse;

// 새 탑 쌓기 시작 (처음, 그리고 독박 날 때마다)
function startBuild(ctx, now) {
  const S = ctx.state;
  for (const id of [...ctx.sim.bodies.keys()]) removeBody(ctx.sim, id);
  snapshot(ctx, null, now);
  Object.assign(S, { phase: 'build', queue: planTower(), dropAt: now + 500, lastDrop: now + 500, gap: BUILD_GAP, towerNo: (S.towerNo || 0) + 1 });
  ctx.simAt = now;
  return true;
}

// 탑 쌓기: 계획한 자리에 하나씩 떨군다
function spawn(ctx, item) {
  const S = ctx.state;
  S.bodyNo = (S.bodyNo || 0) + 1;
  const { k, x, y, a } = item;
  addBody(ctx.sim, { id: `j${S.bodyNo}`, k, x, y, a: a || 0 }, true);
}

function tickBuild(ctx, now) {
  const S = ctx.state;
  if (S.queue?.length && now >= (S.dropAt || 0)) {
    spawn(ctx, S.queue[0]);
    S.queue = S.queue.slice(1);
    S.dropAt = now + (S.gap || BUILD_GAP);
    S.lastDrop = now;
  }
  snapshot(ctx, stepPhysics(ctx, now), now);
  const bodies = [...ctx.sim.bodies.values()];
  const age = now - (S.lastDrop || now);
  const settled = (!bodies.some(b => b.isAwake()) && age > 600) || (age > 2000 && !bodies.some(flying)) || age > 4000;
  if (S.queue?.length || !settled) return true;
  // 쌓다가 떨어진 건 그냥 치운다 (누구 탓도 아님)
  clearFallen(ctx);
  freeze(ctx);
  snapshot(ctx, null, now);
  if (S.bodies.length < 5) return startBuild(ctx, now); // 탑이 너무 무너졌으면 다시
  if (!S.next) S.next = { id: newBag(S, null), lap: S.lap };
  return prepareNext(ctx, now);
}

// 다음 사람이 정해진 뒤: 악마 카드 고민 → 차례 (빼고 하나 올리니 잡동사니 수는 그대로라 보충할 일 없음)
function prepareNext(ctx, now) {
  const S = ctx.state;
  if (!S.next) S.next = { id: nextInBag(S, S.turn), lap: S.lap };
  // 방금 둔 사람(독박 나서 유령이어도)에게 카드가 남았으면 다음 사람에게 저주 걸 기회
  const card = (S.cards?.[S.turn] || 0) > 0 && !!S.turn;
  // 위가 빈 물건(못 뺌)은 탑이 막 멈춘 지금 계산해 둔다 (닿은 면 정보가 살아 있을 때)
  S.free = freeIds(ctx.sim);
  const level = levelOf(S.turnsPlayed || 0);
  let rows = survey(S, level);
  // 살 길 보장: 뺄 수 있는 것 중 초록에서 빼도 버티는 게 하나도 없으면 이번만 위가 빈 것도 허용
  if (S.free.length && !rows.some(r => r.safe)) {
    S.free = [];
    rows = survey(S, level);
  }
  S.phase = card ? 'decide' : 'result';
  S.phaseEndsAt = now + (S.phase === 'decide' ? DECIDE_TIME : S.turn ? RESULT_TIME : 500);
  return true;
}

// 처음 커서: 뺄 수 있는 것 중 제일 높은 물건
const pullable = S => (S.bodies || []).filter(b => !(S.free || []).includes(b.id));
const topmost = S => [...pullable(S)].sort((p, q) => q.y - p.y)[0]?.id || null;

function beginTurn(ctx, now) {
  const S = ctx.state;
  const n = S.next;
  Object.assign(S, {
    prevTurn: S.turn || null,
    turn: n.id,
    turnLap: n.lap,
    level: levelOf(S.turnsPlayed || 0),
    cursor: topmost(S),
    cursedBy: n.curse?.by || null,
    aim: null,
    pulled: null,
    fail: null,
    fallen: null,
    slipped: false,
    phase: 'turn',
    next: null,
  });
  S.turnEndsAt = now + turnTime(S.level);
  ctx.simAt = now;
  return true;
}

function useCard(ctx, pid, now) {
  const S = ctx.state;
  if (!canUseCard(S, pid)) return false;
  S.cards = { ...S.cards, [pid]: S.cards[pid] - 1 };
  S.next = { ...S.next, curse: { by: pid } };
  ctx.announce(`😈 ${josa(ctx.nameOf(pid), '이', '가')} ${ctx.nameOf(S.next.id)}에게 손 떨림 저주!`);
  S.phase = 'result';
  S.phaseEndsAt = now + RESULT_TIME;
  return true;
}

// 실제로 빼기 (v = 게이지 값)
function pull(ctx, now, v) {
  const S = ctx.state;
  const id = S.cursor;
  const body = ctx.sim.bodies.get(id);
  if (!body) return false;
  const j = joltOf(v, S.aim?.w ?? gaugeOf(S).w);
  const p = body.getPosition();
  const kind = ctx.sim.kinds.get(id);
  yank(ctx.sim, id, shakeOf(j, S.level || 1, !!S.cursedBy));
  fx(S, now, { k: 'pop', x: r3(p.x), y: r3(p.y), a: r3(body.getAngle()), kind, j: r2(Math.min(1, j * (S.cursedBy ? 2 : 1))), slip: S.slipped || null, curse: S.cursedBy && j > 0 ? 1 : null });
  if (j === 0) S.greens = { ...(S.greens || {}), [S.turn]: (S.greens?.[S.turn] || 0) + 1 };
  Object.assign(S, { phase: 'settle', stage: 'pull', settleAt: now, pulled: { id, kind, a: r3(body.getAngle()), v: r2(v), j: r2(j) }, aim: S.aim ? { ...S.aim, stop: now, v: r2(v) } : null });
  ctx.simAt = now;
  return true;
}

// 젠가처럼 빼면 맨 위에 하나 올린다. 올릴 물건은 🎰 랜덤 (뺀 걸 그대로 올리면 늘 같은 자리라 안 끝날 수 있다)
// → 탑은 위로 자라고 아래는 구멍투성이, 맨 위는 늘 방금 올린 거라 못 뺌
const placeY = (S, k, a) => (S.top || PLAT_TOP) + PLACE_GAP - extent(k, a).lo[1];

function beginPlace(ctx, now) {
  const S = ctx.state;
  freeze(ctx);
  snapshot(ctx, null, now);
  const top = [...S.bodies].sort((p, q) => q.y - p.y)[0];
  const k = pick(Object.keys(KINDS));
  Object.assign(S, { phase: 'place', place: { k, x: r3(top?.x ?? 0), a: 0 }, placeEndsAt: now + placeTime(S.level || 1) });
  return true;
}

function dropPlace(ctx, now) {
  const S = ctx.state;
  const { k, x, a } = S.place;
  S.bodyNo = (S.bodyNo || 0) + 1;
  const id = `j${S.bodyNo}`;
  addBody(ctx.sim, { id, k, x, y: r3(placeY(S, k, a)), a }, true);
  Object.assign(S, { phase: 'settle', stage: 'place', settleAt: now, placed: id });
  ctx.simAt = now;
  snapshot(ctx, null, now);
  return true;
}

function tickTurn(ctx, now) {
  const S = ctx.state;
  if (now < S.turnEndsAt) return false;
  // 시간 끝: 게이지가 돌던 중이면 그 자리에서 멈추고, 아직이면 손이 미끄러져 아무렇게나 쑥
  S.slipped = !S.aim;
  const v = S.aim ? gaugeAt(S.aim, now) : Math.random() < 0.5 ? Math.random() * 0.15 : 0.85 + Math.random() * 0.15;
  if (!pullable(S).some(b => b.id === S.cursor)) S.cursor = topmost(S);
  return pull(ctx, now, v);
}

function markFail(S, ids, now) {
  const fresh = [...ids].filter(id => !(S.fallen || []).includes(id));
  if (!fresh.length) return;
  S.fallen = [...(S.fallen || []), ...fresh];
  if (!S.fail) {
    const b = S.bodies.find(x => x.id === fresh[0]);
    fx(S, now, { k: 'crash', x: b?.x ?? 0, y: 0.2 });
  }
  S.fail = { ids: S.fallen };
}

function tickSettle(ctx, now) {
  const S = ctx.state;
  const trail = stepPhysics(ctx, now);
  const touched = floorTouches(ctx.sim);
  if (touched.size) markFail(S, touched, now);
  snapshot(ctx, trail, now);
  const bodies = [...ctx.sim.bodies.values()];
  const age = now - S.settleAt;
  if (!((!bodies.some(b => b.isAwake()) && age > 700) || (age > SETTLE_MAX && !bodies.some(flying)) || age > SETTLE_HARD)) return true;
  // 빼고 버텼으면 이제 올리기, 올리고도 버텼으면 성공
  if (!S.fail && S.stage === 'pull') return beginPlace(ctx, now);
  return resolve(ctx, now);
}

function resolve(ctx, now) {
  const S = ctx.state;
  const id = S.turn;
  freeze(ctx);
  S.turnsPlayed = (S.turnsPlayed || 0) + 1;
  S.lastResult = { id, ok: !S.fail, at: now, kind: S.pulled?.kind, j: S.pulled?.j };
  if (S.fail) {
    S.alive = S.alive.filter(x => x !== id);
    S.outOrder = [...(S.outOrder || []), id];
    // 저주는 빼기에만 걸리니, 빼다가 무너졌을 때만 저주 킬 (올리다 떨어뜨린 건 그냥 위험한 탑 넘김)
    const byCurse = !!S.cursedBy && S.cursedBy !== id && S.stage === 'pull';
    const killer = byCurse ? S.cursedBy : S.prevTurn && S.prevTurn !== id ? S.prevTurn : null;
    S.dead = { ...(S.dead || {}), [id]: killer || '-' };
    S.fails = [...(S.fails || []), { id, at: now }].slice(-8);
    if (killer) {
      ctx.kill(killer, id, byCurse ? '😈 손 떨림 저주' : '🧨 위험한 탑 넘김');
      S.kills = { ...(S.kills || {}), [killer]: (S.kills?.[killer] || 0) + 1 };
      if (byCurse) S.cardKills = { ...(S.cardKills || {}), [killer]: (S.cardKills?.[killer] || 0) + 1 };
    } else {
      ctx.announce(`💥 ${ctx.nameOf(id)} 독박! (${(S.fail.ids || []).length}개 와르르)`);
    }
    if (S.alive.length <= 1) {
      snapshot(ctx, null, now);
      return finish(ctx, now);
    }
    // 독박 나면 새 탑: 다음 사람을 먼저 정해 두고 쌓는다
    S.next = { id: nextInBag(S, id), lap: S.lap };
    return startBuild(ctx, now);
  }
  S.removed = { ...(S.removed || {}), [id]: (S.removed?.[id] || 0) + 1 };
  snapshot(ctx, null, now);
  return prepareNext(ctx, now);
}

function finish(ctx, now) {
  const S = ctx.state;
  const placement = [...S.alive, ...[...(S.outOrder || [])].reverse()];
  for (const p of S.roster || ctx.roster) if (!placement.includes(p.id)) placement.push(p.id);
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  if (placement[0]) add(placement[0], '👑 마지막 생존자');
  const best = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  const [devil, dk] = best(S.cardKills);
  if (dk >= 1) add(devil, `😈 악마의 손 (${dk}킬)`);
  const [pro, n] = best(S.removed);
  if (n >= 3) add(pro, `🧹 빼기 장인 (${n}개)`);
  const [calm, g] = best(S.greens);
  if (g >= 3) add(calm, `🎯 강철 손 (초록 ${g}번)`);
  Object.assign(S, {
    placement,
    standings: Object.fromEntries(placement.map((id, i) => [id, placement.length - i])),
    titles,
    phase: 'final',
    over: true,
    next: null,
    endAt: now,
  });
  return true;
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

function objGroup(k) {
  return svg('g', { class: `po-obj po-${k}` }, kindOf(k).art.map(([tag, attrs]) => svg(tag, attrs)));
}

// 커서 테두리 (물리 모양 그대로)
function outlineGroup(k) {
  return svg('g', { class: 'po-outline' }, kindOf(k).parts.map(part => {
    const [ax, ay] = part.at || [0, 0];
    if (part.box) return svg('rect', { x: ax - part.box[0], y: ay - part.box[1], width: part.box[0] * 2, height: part.box[1] * 2, rx: 0.05 });
    if (part.circle) return svg('circle', { cx: ax, cy: ay, r: part.circle });
    return svg('polygon', { points: part.poly.map(([x, y]) => `${x + ax},${y + ay}`).join(' ') });
  }));
}

// 방향키로 그쪽에 있는 가장 가까운 물건으로 (정면에 가까울수록 우선)
function nearestInDir(bodies, fromId, dx, dy) {
  const from = bodies.find(b => b.id === fromId);
  if (!from) return bodies[0]?.id || null;
  let best = null;
  let score = Infinity;
  for (const b of bodies) {
    if (b.id === fromId) continue;
    const vx = b.x - from.x;
    const vy = b.y - from.y;
    const d = Math.hypot(vx, vy) || 0.001;
    const cos = (vx * dx + vy * dy) / d;
    if (cos < 0.35) continue;
    const s = d * (1 + 2.5 * (1 - cos));
    if (s < score) [best, score] = [b.id, s];
  }
  return best || fromId;
}

export default {
  id: 'pullout',
  title: '독박빼기',
  emoji: '🪑',
  tag: '우정파괴',
  color: '#16a085',
  desc: '와바바박 쌓인 잡동사니 탑에서 하나를 쏙! 그게 없어도 탑이 버텨야 해요. 무너지면 독박',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx) {
    ensurePlanck();
    return {
      phase: 'build',
      queue: planTower(),
      dropAt: ctx.now() + 700,
      lastDrop: ctx.now() + 700,
      gap: BUILD_GAP,
      towerNo: 1,
      alive: ctx.roster.map(p => p.id),
      cards: Object.fromEntries(ctx.roster.map(p => [p.id, DEVIL_CARDS])),
      top: PLAT_TOP,
      turnsPlayed: 0,
      lap: 0,
    };
  },

  onInput(ctx, { pid, type, data }) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'turn' && pid === S.turn) {
      if (type === 'cur' && !S.aim && pullable(S).some(b => b.id === data.id)) {
        S.cursor = data.id;
        return true;
      }
      if (type === 'aim' && !S.aim) {
        S.aim = { at: now, ...gaugeOf(S) };
        return true;
      }
      // 게이지 값은 누른 사람 화면 기준 시각으로 (통신이 늦어도 본 대로)
      if (type === 'pull' && S.aim && !S.aim.stop) {
        const t = Math.max(S.aim.at, Math.min(now, Number(data.t) || now));
        return pull(ctx, now, gaugeAt(S.aim, t));
      }
    }
    if (S.phase === 'place' && pid === S.turn) {
      if (type === 'pos') {
        const a = Math.round((Number(data.a) || 0) / (Math.PI / 2)) * (Math.PI / 2);
        S.place = { ...S.place, x: r3(Math.max(-2.6, Math.min(2.6, Number(data.x) || 0))), a: r3(a) };
        return true;
      }
      if (type === 'drop') return dropPlace(ctx, now);
    }
    if (type === 'devil') return useCard(ctx, pid, now);
    if (type === 'pass' && S.phase === 'decide' && pid === S.turn) return beginTurn(ctx, now);
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (!planck) {
      ensurePlanck();
      return false; // 엔진 받는 중
    }
    if (!ctx.sim) {
      ctx.sim = makeSim(S);
      ctx.simAt = now;
    }
    switch (S.phase) {
      case 'build':
        return tickBuild(ctx, now);
      case 'turn':
        return tickTurn(ctx, now);
      case 'place':
        return now >= S.placeEndsAt && dropPlace(ctx, now); // 시간 끝: 지금 자리에 그대로 떨굼
      case 'settle':
        return tickSettle(ctx, now);
      case 'decide':
        if (now < S.phaseEndsAt && ctx.isOnline(S.turn)) return false;
        return beginTurn(ctx, now);
      case 'result':
        return now >= S.phaseEndsAt && beginTurn(ctx, now);
      default:
        return false;
    }
  },

  // 봇: 방장이 몰래 시험해 본 결과로 대개 안전한 걸 고르고(가끔 실수), 게이지는 초록 근처에서 누른다(손이 조금 떨림)
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'turn' && S.turn === id) {
      const key = `t${S.turnsPlayed}`;
      if (mem.key !== key) {
        const rows = survey(S, S.level || 1);
        const steady = rows.filter(r => r.steady);
        const safe = rows.filter(r => r.safe);
        // 사람처럼 늘 정답을 고르진 않는다 (흔들려도 버티는 것 35% · 초록이면 버티는 것 25% · 아무거나 40%)
        const roll = Math.random();
        const from = roll < 0.35 && steady.length ? steady : roll < 0.6 && safe.length ? safe : rows;
        Object.assign(mem, { key, target: pick(from).id, at: now + 1200 + Math.random() * 1500, step: 0 });
      }
      if (now < mem.at) return null;
      if (mem.step === 0) {
        mem.step = 1;
        mem.at = now + 400;
        return mem.target !== S.cursor ? { type: 'cur', data: { id: mem.target } } : null;
      }
      if (mem.step === 1 && !S.aim) {
        mem.step = 2;
        return { type: 'aim' };
      }
      if (mem.step === 2 && S.aim) {
        // 가운데(0.5)를 지나는 때를 노려서 누른다 (0.1초쯤 오차)
        const P = S.aim.period;
        const k = 1 + Math.floor(Math.random() * 2);
        Object.assign(mem, { step: 3, at: S.aim.at + P / 4 + (k * P) / 2 + (Math.random() - 0.5) * 220 });
        return null;
      }
      if (mem.step === 3) {
        mem.step = 4;
        return { type: 'pull', data: { t: mem.at }, say: Math.random() < 0.1 }; // 노린 순간에 누른 걸로
      }
      return null;
    }
    if (S.phase === 'place' && S.turn === id) {
      const key = `p${S.turnsPlayed}`;
      if (mem.pkey !== key) {
        // 납작하게 눕힌 쪽이 안정적 → 탑 위 가운데쯤 (조금씩 빗나감)
        const k = S.place.k;
        const height = a => extent(k, a).hi[1] - extent(k, a).lo[1];
        const a = height(Math.PI / 2) < height(0) - 0.05 ? Math.PI / 2 : 0;
        const tops = [...S.bodies].sort((p, q) => q.y - p.y).slice(0, 2);
        const cx = tops.reduce((s, b) => s + b.x, 0) / Math.max(1, tops.length);
        Object.assign(mem, { pkey: key, px: r3(cx * 0.6 + (Math.random() - 0.5) * 0.7), pa: a, pat: now + 800 + Math.random() * 1500, pstep: 0 });
      }
      if (now < mem.pat) return null;
      if (mem.pstep === 0) {
        mem.pstep = 1;
        mem.pat = now + 400;
        return { type: 'pos', data: { x: mem.px, a: mem.pa } };
      }
      if (mem.pstep === 1) {
        mem.pstep = 2;
        return { type: 'drop' };
      }
      return null;
    }
    if (S.phase === 'decide' && S.turn === id && canUseCard(S, id)) {
      const key = `d${S.turnsPlayed}`;
      if (mem.key !== key) {
        const chance = 0.4 + (S.alive.length <= 2 ? 0.3 : 0) + (S.alive.includes(id) ? 0 : 0.3);
        Object.assign(mem, { key, use: Math.random() < chance, at: now + 1000 + Math.random() * 1500 });
      }
      if (now < mem.at) return null;
      return mem.use ? { type: 'devil', say: Math.random() < 0.5 } : { type: 'pass' };
    }
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const top = h('div', { class: 'po-top' });
    const bodiesG = svg('g');
    const outlineG = svg('g');
    const popG = svg('g');
    const world = svg('g', { transform: 'scale(1,-1)' },
      svg('rect', { class: 'po-floor', x: -20, y: -3, width: 40, height: 3 }),
      svg('rect', { class: 'po-table-leg', x: -PLAT_HALF + 0.15, y: 0, width: 0.18, height: PLAT_TOP - 0.12 }),
      svg('rect', { class: 'po-table-leg', x: PLAT_HALF - 0.33, y: 0, width: 0.18, height: PLAT_TOP - 0.12 }),
      svg('rect', { class: 'po-table', x: -PLAT_HALF, y: PLAT_TOP - 0.14, width: PLAT_HALF * 2, height: 0.14, rx: 0.03 }),
      bodiesG, outlineG, popG);
    // 올릴 물건 미리보기 (떨어질 높이 그대로, 점선은 똑바로 아래로)
    const guide = svg('line', { class: 'po-guide', x1: 0, y1: 0, x2: 0, y2: 0 });
    const previewPiece = svg('g');
    const previewG = svg('g', { class: 'po-preview' }, guide, previewPiece);
    world.append(previewG);
    const overlay = svg('g'); // 커서 화살표 (뒤집지 않은 좌표: y 아래로)
    const marker = svg('g', { class: 'po-marker' }, svg('text', {}, '▼'));
    overlay.append(marker);
    const stage = svg('svg', { class: 'po-svg', preserveAspectRatio: 'xMidYMax meet' }, world, overlay);
    const fx = h('div', { class: 'po-fx' });
    // 손 떨림 게이지: 빨강 | 노랑 | 초록 | 노랑 | 빨강, 바늘이 왔다 갔다
    const zone = h('i', { class: 'po-green' });
    const needle = h('b', { class: 'po-needle' });
    const gauge = h('div', { class: 'po-gauge', hidden: true }, h('div', { class: 'po-track' }, zone, needle));
    const panel = h('div', { class: 'po-panel' });
    const box = h('div', { class: 'po-box' }, top, h('div', { class: 'po-stage' }, stage, fx), gauge, panel);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'po' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    const shown = new Map(); // id → { el, ol, k, keys, t }
    let camTop = 6;
    let seenFx = null;
    let panelKey = '';
    let sideKey = '';
    let topKey = '';
    const mine = { key: '', cursor: null, sent: false }; // 내 차례: 커서는 내 화면에서 바로 움직인다
    // 올리기: 자리·회전도 내 화면에서 바로 움직이고 방장에게는 가끔 알려 준다
    const placing = { key: '', x: 0, a: 0, l: false, r: false, sentAt: 0, sent: '', last: 0, dropped: false };
    const who = id => S?.roster.find(p => p.id === id) || { id, name: '?' };
    const myTurn = () => S?.phase === 'turn' && S.turn === me;
    const myPlace = () => S?.phase === 'place' && S.turn === me;
    function sendPos(force) {
      const key = `${placing.x.toFixed(2)}:${placing.a.toFixed(2)}`;
      if (key === placing.sent && !force) return;
      placing.sent = key;
      placing.sentAt = performance.now();
      api.send('pos', { x: placing.x, a: placing.a });
    }
    const nameOfObj = id => kindOf(S.bodies?.find(b => b.id === id)?.k).name;
    const cursor = () => (myTurn() && !S.aim ? mine.cursor : S.cursor);

    function onKey(e) {
      if (!S || isTyping(e)) return;
      if (myPlace() && !placing.dropped) {
        const c = e.code;
        const down = e.type === 'keydown';
        const side = c === 'ArrowLeft' || c === 'KeyA' ? 'l' : c === 'ArrowRight' || c === 'KeyD' ? 'r' : null;
        if (side) {
          e.preventDefault();
          placing[side] = down;
          // 톡 치면 조금, 꾹 누르면 계속 (paint에서)
          if (down && !e.repeat) {
            placing.x = Math.max(-2.6, Math.min(2.6, placing.x + (side === 'l' ? -0.15 : 0.15)));
            sendPos();
          }
          return;
        }
        if (!down) return;
        if (c === 'ArrowUp' || c === 'KeyW' || c === 'ArrowDown' || c === 'KeyS') {
          e.preventDefault();
          placing.a = ((placing.a + (c === 'ArrowUp' || c === 'KeyW' ? 1 : -1) * (Math.PI / 2)) + Math.PI * 2) % (Math.PI * 2);
          sendPos();
        } else if (c === 'Space' && !e.repeat) {
          e.preventDefault();
          placing.dropped = true;
          sendPos(true);
          api.send('drop');
          render();
        }
        return;
      }
      if (e.type !== 'keydown') return;
      // 악마 카드: 1 = 저주 걸기, 스페이스 = 안 씀 (독박 타워와 같게. 스페이스 연타로 잘못 걸지 않게)
      if (S.phase === 'decide' && S.turn === me && canUseCard(S, me) && !e.repeat) {
        if (digitOf(e) === 1) {
          e.preventDefault();
          api.send('devil');
        } else if (e.code === 'Space') {
          e.preventDefault();
          api.send('pass');
        }
        return;
      }
      if (!myTurn()) return;
      const c = e.code;
      if (c === 'Space') {
        e.preventDefault();
        if (e.repeat || mine.sent) return;
        if (!S.aim) {
          if (mine.cursor !== S.cursor) api.send('cur', { id: mine.cursor });
          api.send('aim');
        } else if (!S.aim.stop) {
          mine.sent = true;
          api.send('pull', { t: api.now() });
        }
        return;
      }
      if (S.aim) return;
      const dir = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1] }[c];
      if (!dir) return;
      e.preventDefault();
      mine.cursor = nearestInDir(pullable(S), mine.cursor, dir[0], dir[1]);
      api.send('cur', { id: mine.cursor });
      render();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    function syncBodies() {
      const now = performance.now();
      const live = new Set();
      for (const b of S.bodies || []) {
        live.add(b.id);
        let it = shown.get(b.id);
        if (!it) {
          const el = objGroup(b.k);
          const ol = outlineGroup(b.k);
          bodiesG.append(el);
          outlineG.append(ol);
          shown.set(b.id, (it = { el, ol, k: b.k, keys: [b, b], t: now }));
          continue;
        }
        const last = it.keys[it.keys.length - 1];
        if (last.x === b.x && last.y === b.y && last.a === b.a) continue;
        it.keys = [current(it, now), ...(b.p || []).map(([x, y, a]) => ({ x, y, a })), b];
        it.t = now;
      }
      for (const [id, it] of shown) {
        if (live.has(id)) continue;
        it.el.remove();
        it.ol.remove();
        shown.delete(id);
      }
      const fallen = new Set(S.fallen || []);
      const free = new Set(S.phase === 'turn' ? S.free || [] : []); // 위가 빈 물건은 흐리게 (못 뺌)
      for (const [id, it] of shown) {
        it.el.classList.toggle('fallen', fallen.has(id));
        it.el.classList.toggle('locked', free.has(id));
      }
    }

    function current(it, now) {
      const ks = it.keys;
      const k = Math.min(1, (now - it.t) / 110) * (ks.length - 1);
      const i = Math.min(ks.length - 2, Math.floor(k));
      const f = k - i;
      const p = ks[i];
      const q = ks[i + 1];
      let da = q.a - p.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, a: p.a + da * f };
    }

    function paint() {
      if (!S) return;
      const now = performance.now();
      const pos = new Map();
      for (const [id, it] of shown) {
        const p = current(it, now);
        pos.set(id, p);
        const tr = `translate(${p.x} ${p.y}) rotate(${deg(p.a)})`;
        it.el.setAttribute('transform', tr);
        it.ol.setAttribute('transform', tr);
      }
      // 커서: 노란 테두리 + 위에 ▼
      const cur = S.phase === 'turn' ? cursor() : null;
      for (const [id, it] of shown) it.ol.classList.toggle('on', id === cur);
      marker.style.display = cur && pos.has(cur) ? '' : 'none';
      if (cur && pos.has(cur)) {
        const p = pos.get(cur);
        marker.setAttribute('transform', `translate(${p.x} ${-(p.y + extent(shown.get(cur).k, p.a).hi[1] + 0.35)})`);
      }
      // 게이지 바늘
      if (S.phase === 'turn' && S.aim) {
        const v = S.aim.stop ? S.aim.v ?? gaugeAt(S.aim, S.aim.stop) : gaugeAt(S.aim, api.now());
        needle.style.left = `${v * 100}%`;
      } else if (S.phase === 'settle' && S.aim?.v != null) {
        needle.style.left = `${S.aim.v * 100}%`;
      }
      // 올리기: 내 차례면 내 화면 자리로 바로, 남이면 방장이 알려 준 자리로
      let previewTop = 0;
      if (S.phase === 'place' && S.place) {
        if (myPlace() && !placing.dropped) {
          const dt = Math.min(0.05, (now - (placing.last || now)) / 1000);
          const dir = (placing.r ? 1 : 0) - (placing.l ? 1 : 0);
          placing.x = Math.max(-2.6, Math.min(2.6, placing.x + dir * MOVE_SPEED * dt));
          if (now - placing.sentAt > 120) sendPos();
        }
        const p = myPlace() ? placing : S.place;
        const y = placeY(S, S.place.k, p.a);
        if (previewG.dataset.key !== `${S.turnsPlayed}:${S.place.k}`) {
          previewG.dataset.key = `${S.turnsPlayed}:${S.place.k}`;
          previewPiece.replaceChildren(objGroup(S.place.k));
        }
        previewG.style.display = '';
        previewG.setAttribute('transform', `translate(${p.x} ${y})`);
        guide.setAttribute('y2', -y);
        previewPiece.setAttribute('transform', `rotate(${deg(p.a)})`);
        previewTop = y + extent(S.place.k, p.a).hi[1];
      } else {
        previewG.style.display = 'none';
      }
      placing.last = now;
      // 카메라: 받침대 폭에 맞추고, 탑이 높으면 위로 (올릴 땐 미리보기 꼭대기까지)
      const want = Math.max(5.4, (S.top || 0) + 1.2, previewTop + 0.5);
      camTop += (want - camTop) * 0.08;
      const half = Math.max(PLAT_HALF + 1.6, camTop * 0.62);
      stage.setAttribute('viewBox', `${-half} ${-camTop} ${half * 2} ${camTop + 0.5}`);
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function flash(text, cls = '') {
      const el = h('div', { class: `po-flash ${cls}` }, text);
      fx.append(el);
      setTimeout(() => el.remove(), 1800);
    }
    function shake() {
      box.classList.remove('shaking');
      void box.offsetWidth;
      box.classList.add('shaking');
      setTimeout(() => box.classList.remove('shaking'), 500);
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
        if (e.k === 'pop') {
          // 빠진 물건이 앞으로 쑥 튀어나오며 사라짐
          const ghost = svg('g', { transform: `translate(${e.x} ${e.y}) rotate(${deg(e.a || 0)})` }, svg('g', { class: 'po-popped' }, objGroup(e.kind)));
          popG.append(ghost);
          setTimeout(() => ghost.remove(), 700);
          flash(e.slip ? `⏰ 손이 미끄러짐! ${kindOf(e.kind).name} 쑥` : e.curse ? `😈 저주받은 손! ${kindOf(e.kind).name} 덜컥` : e.j === 0 ? `🎯 살살~ ${kindOf(e.kind).name} 쏙!` : e.j > 0.5 ? `😱 덜컥! ${kindOf(e.kind).name}` : `${kindOf(e.kind).name} 쏙!`, e.j > 0.5 ? 'bad' : '');
          if (e.j > 0.5) shake();
        }
        if (e.k === 'crash') {
          flash('💥 와르르!', 'bad');
          shake();
        }
      }
    }

    function renderTop() {
      const bits = [[S.lap ? `${S.lap}바퀴` : '쌓는 중'], [`${S.level || 1}단계`], [`잡동사니 ${(S.bodies || []).length}개`]];
      if (S.next?.id && S.phase !== 'final') bits.push([`다음: ${who(S.next.id).name}${S.next.curse ? ' 😈' : ''}`]);
      const timer = S.phase === 'turn' ? [S.turnEndsAt, turnTime(S.level || 1)]
        : S.phase === 'place' ? [S.placeEndsAt, placeTime(S.level || 1)]
          : S.phase === 'decide' ? [S.phaseEndsAt, DECIDE_TIME] : null;
      const key = JSON.stringify([bits, timer]);
      if (key === topKey) return;
      topKey = key;
      top.replaceChildren(...bits.map(([t, cls]) => h('span', { class: cls }, t)), ...(timer ? [countdown(timer[0], timer[1])] : []));
    }

    function curseButtons() {
      return [
        h('button', { class: 'tw-option devil', tabindex: '-1', onClick: () => api.send('devil') }, h('kbd', { class: 'num' }, '1'), h('b', {}, '😈 저주 걸기')),
        h('button', { class: 'tw-option', tabindex: '-1', onClick: () => api.send('pass') }, h('kbd', {}, '스페이스'), h('b', {}, '안 씀')),
      ];
    }

    function panelView() {
      if (S.phase === 'build' && !S.turnsPlayed) {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '🪑 독박빼기'),
          h('ul', { class: 'rules big' },
            h('li', {}, '돌아가며 탑에서 물건 하나를 쏙 빼요. 그게 없어도 버티면 성공, 뭐라도 바닥에 떨어지면 독박!'),
            h('li', {}, '젠가처럼 위에 아무것도 안 얹힌 물건은 못 빼요'),
            h('li', {}, '방향키로 고르고 스페이스 → 손 떨림 게이지 → 스페이스로 멈춤. 초록이면 살살, 빨강이면 덜컥'),
            h('li', {}, '버티면 🎰 랜덤 물건을 맨 위에 올려요 (← → 자리 · ↑ ↓ 돌리기 · 스페이스). 올리다 떨어져도 독박'),
            h('li', {}, '😈 악마 카드 1장 = 손 떨림 저주: 내 차례 끝나고 다음 사람 게이지를 2배 빠르게, 초록 칸 절반'),
            h('li', {}, '3차례마다 어려워져요(시간↓ 게이지↑ 손 떨림↑). 독박 나면 새 탑')),
          h('p', { class: 'muted dots' }, '잡동사니 쌓는 중'));
      }
      if (S.phase === 'build') return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '🏗️ 새 탑 와바바박 쌓는 중…'));
      if (S.phase === 'final') {
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, `👑 ${who(S.placement?.[0]).name} 마지막 생존!`), podium(S.roster, S.standings, me));
      }
      if (S.phase === 'turn') {
        const what = nameOfObj(cursor());
        const curse = S.cursedBy ? h('p', { class: 'po-cursed-note' }, `😈 ${who(S.cursedBy).name}의 손 떨림 저주! 게이지 2배 빠르고 초록 칸 절반`) : null;
        if (S.turn === me) {
          return h('div', { class: 'bt-act' },
            h('div', { class: 'bt-act-title hot' }, S.aim ? `지금! 초록에서 스페이스 — ${what}` : `내 차례! ${what}`),
            curse,
            h('p', {}, S.aim ? '스페이스 = 멈추고 빼기' : '← ↑ ↓ → 고르기 · 스페이스 = 빼기 시작 (게이지) · 위가 빈 물건은 못 빼요'));
        }
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `${who(S.turn).name}: ${what} ${S.aim ? '빼는 중…' : '고르는 중…'}`),
          curse,
          S.next?.id === me ? h('p', { class: 'muted' }, '😰 다음은 나…') : null);
      }
      if (S.phase === 'place') {
        const what = kindOf(S.place?.k).name;
        if (S.turn === me) {
          return h('div', { class: 'bt-act' },
            h('div', { class: 'bt-act-title hot' }, placing.dropped ? '떨궜다! 🙏' : `🎰 올릴 물건: ${what}!`),
            placing.dropped ? null : h('p', {}, '맨 위에 올려요 · ← → 자리 · ↑ ↓ 돌리기 · 스페이스 떨구기 (떨어뜨려도 독박)'));
        }
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `${who(S.turn).name}: 🎰 ${what} 올리는 중…`),
          S.next?.id === me ? h('p', { class: 'muted' }, '😰 다음은 나…') : null);
      }
      if (S.phase === 'settle') return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, S.fail ? '💥 와르르…' : S.stage === 'place' ? '😬 올린 거 버텨라…' : '😬 버텨라…'));
      if (S.phase === 'decide') {
        const next = who(S.next?.id);
        if (S.turn === me && canUseCard(S, me)) {
          return h('div', { class: 'bt-act' },
            h('div', { class: 'bt-act-title hot' }, `😈 ${next.name}한테 손 떨림 저주?`),
            h('div', { class: 'tw-options' }, curseButtons()),
            h('p', { class: 'muted' }, '저주받으면 다음 차례 게이지가 2배 빠르고 초록 칸이 절반 · 카드는 1장뿐'));
        }
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `😈 ${josa(who(S.turn).name, '이', '가')} 악마 카드 고민 중…`),
          h('p', {}, S.next?.id === me ? '😰 다음은 나… 제발' : `다음: ${next.name}`));
      }
      if (S.phase === 'result') {
        const r = S.lastResult;
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, !r ? '시작!' : r.ok ? `✅ ${who(r.id).name} 성공!` : `💥 ${who(r.id).name} 독박!`),
          h('p', {}, `다음: ${who(S.next?.id).name}${S.next?.curse ? ' · 😈 손 떨림 저주!' : ''}`));
      }
      return h('div');
    }

    function renderPanel() {
      const key = JSON.stringify([S.phase, S.stage, S.turn, S.turnsPlayed, S.towerNo, !!S.aim, S.cursedBy, cursor(), S.next, !!S.fail, S.cards?.[me], S.lastResult?.at, S.place?.k, placing.dropped]);
      if (key === panelKey) return;
      panelKey = key;
      panel.replaceChildren(panelView());
      gauge.hidden = !(S.phase === 'turn' || (S.phase === 'settle' && S.aim && S.stage === 'pull'));
      gauge.classList.toggle('cursed', !!S.cursedBy);
      const w = S.aim?.w ?? gaugeOf(S).w;
      zone.style.left = `${(0.5 - w / 2) * 100}%`;
      zone.style.width = `${w * 100}%`;
      if (!S.aim) needle.style.left = '0%';
    }

    function renderSide() {
      const key = JSON.stringify([S.lap, S.alive, S.turn, S.next?.id, S.bag, S.bagPos, S.cards, S.outOrder, S.dead, S.removed]);
      if (key === sideKey) return;
      sideKey = key;
      const order = (S.bag || []).map((id, i) => {
        const dead = !S.alive.includes(id);
        const cls = dead ? 'dead' : id === S.turn ? 'now' : id === S.next?.id ? 'next' : i < (S.bagPos ?? 0) ? 'done' : '';
        return h('li', { class: cls }, avatar(who(id)), h('span', {}, who(id).name),
          (S.cards?.[id] || 0) > 0 ? h('i', { class: 'tw-card', title: '악마 카드 남음' }, '😈') : null,
          S.removed?.[id] ? h('i', { class: 'tw-card' }, `🧹${S.removed[id]}`) : null,
          cls === 'now' ? h('em', {}, '차례') : cls === 'next' ? h('em', {}, '다음') : cls === 'done' ? h('em', {}, '✓') : null);
      });
      const deadList = (S.outOrder || []).map(id => {
        const by = S.dead?.[id];
        return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${who(by).name}` : ' 💥 독박');
      });
      side.replaceChildren(...[
        h('h3', {}, S.lap ? `${S.lap}바퀴 순서 · 생존 ${S.alive.length}명` : `생존 ${S.alive.length}명`),
        order.length ? h('ol', { class: 'tw-bag' }, order) : null,
        deadList.length ? h('h3', {}, '독박 기록') : null,
        deadList.length ? h('ul', { class: 'rules' }, deadList) : null,
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '← ↑ ↓ → (WASD) 물건 고르기 (흐린 건 못 뺌)'),
          h('li', {}, '스페이스 = 빼기 시작 → 게이지 초록에서 스페이스'),
          h('li', {}, '초록 = 살살 · 빨강 = 덜컥 (주변이 흔들림)'),
          h('li', {}, '올리기: ← → 자리 · ↑ ↓ 돌리기 · 스페이스 떨구기'),
          h('li', {}, '😈 악마 카드(저주): 내 차례 끝나고 1 = 걸기 · 스페이스 = 안 씀')),
      ].filter(Boolean));
    }

    function render() {
      renderTop();
      renderPanel();
      renderSide();
    }

    return {
      update({ state }) {
        S = state;
        const placeKey = `${S.turnsPlayed}:${S.turn}`;
        if (S.phase === 'place' && placing.key !== placeKey) {
          Object.assign(placing, { key: placeKey, x: S.place.x, a: S.place.a, l: false, r: false, sent: '', dropped: false });
        }
        const turnKey = `${S.turnsPlayed}:${S.turn}:${S.phase === 'turn'}`;
        if (mine.key !== turnKey) Object.assign(mine, { key: turnKey, cursor: S.cursor, sent: false });
        if (!S.bodies?.some(b => b.id === mine.cursor)) mine.cursor = S.cursor;
        syncBodies();
        playFx();
        render();
      },
      unmount() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
      },
    };
  },
};
