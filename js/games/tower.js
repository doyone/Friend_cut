// 독박 타워: 좁은 받침대에 돌아가며 물리 블록을 쌓는다.
// 블록은 🎰 룰렛(기본 4칸 블록 7종 + 추가 블록, 완전 랜덤)으로 차례가 시작될 때 뽑는다. NEXT는 '?'로만 보인다.
// 각자 한 판에 한 번 '😈 악마 카드'로 다음 사람 블록을 내가 고른 악마 블록으로 정해 버릴 수 있다 (그걸로 죽으면 내 킬).
// 카드는 내 차례 내내 쓸 수 있고, 내 블록이 멈춘 뒤에도 최대 5초 고민할 수 있다.
// 블록이 하나라도 떨어지면 놓은 사람 탈락. 순서는 바퀴마다 섞는다(테트리스 가방처럼). 마지막 1명 우승.
// 물리는 방장 컴퓨터만 계산하고(planck.js), 다른 사람은 위치만 받아서 그린다.
import { h, isTyping, josa, pick, shuffle, digitOf } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';

const PLANCK_URL = 'https://cdn.jsdelivr.net/npm/planck@1.4.2/+esm';
const INTRO_TIME = 4000;
const DECIDE_TIME = 5000;    // 내 블록이 멈춘 뒤 악마 카드 고민 시간 (고르면 바로 끝)
const RESULT_TIME = 1500;    // 결과 잠깐 보여 주기
const SPIN_TIME = 1300;      // 차례 시작할 때 룰렛 도는 시간
const SETTLE_MAX = 5000;     // 떨군 뒤 이만큼 지나면 거의 멈춘 건 그 자리에 세우고 다음 차례
const SETTLE_HARD = 9000;    // 아직 날아다니는 게 있어도 이때는 무조건 다음 차례
const DEVIL_CARDS = 1;       // 한 판에 1인당 악마 카드
const PLATFORM_W = 6.24;     // 받침대 폭 (예전 5.2의 1.2배)
const PLATFORM_H = 0.6;
const GRAVITY = 15;          // 실제(10)의 1.5배: 빨리 떨어지고 쿵 내려앉아서 묵직하다
const DROP_GAP = 1.5;        // 떨구는 높이: 블록 맨 아래가 탑 꼭대기보다 이만큼 위
const FALL_Y = -2;           // 이 아래로 내려가면 떨어진 것
const X_LIMIT = 5;           // 조준 좌우 한계
const ROT_STEP = Math.PI / 12; // 15도
const MOVE_SPEED = 5;        // 초당

/* ───────── 블록 모양 (단위: m, 몸통 기준점 0,0) ─────────
   물리 엔진은 볼록한 조각만 받아서, 오목한 모양은 여러 조각(parts)으로 나눈다.
   kind: base(기본 4칸) · extra(추가) → 룰렛 / devil(악마) → 악마 카드 전용 */
const deg = d => (d * Math.PI) / 180;
const P = (x, y) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
const ellipse = (n, rx, ry = rx) => Array.from({ length: n }, (_, k) => P(rx * Math.cos(deg((360 * k) / n)), ry * Math.sin(deg((360 * k) / n))));
function halfDisc(r, n) {
  const dy = (4 * r) / (3 * Math.PI); // 무게중심이 0,0 근처에 오도록
  return Array.from({ length: n + 1 }, (_, k) => P(r * Math.cos(Math.PI * (k / n)), r * Math.sin(Math.PI * (k / n)) - dy));
}
function starParts(ro, ri) {
  const at = (r, d) => P(r * Math.cos(deg(d)), r * Math.sin(deg(d)));
  const inner = Array.from({ length: 5 }, (_, k) => at(ri, 126 + 72 * k));
  return [{ poly: inner }, ...inner.map((p, k) => ({ poly: [inner[(k + 4) % 5], p, at(ro, 90 + 72 * k)] }))];
}
// 4칸 블록: 칸 좌표로 정의하고 무게중심을 0,0에 맞춘다
const CELL = 0.6;
function cells(list) {
  const cx = list.reduce((s, [x]) => s + x, 0) / list.length;
  const cy = list.reduce((s, [, y]) => s + y, 0) / list.length;
  return list.map(([x, y]) => ({ box: [CELL / 2, CELL / 2], at: P((x - cx) * CELL, (y - cy) * CELL) }));
}

export const SHAPES = {
  // 기본 4칸 블록
  I: { name: 'I블록', kind: 'base', parts: cells([[0, 0], [1, 0], [2, 0], [3, 0]]) },
  O: { name: 'O블록', kind: 'base', parts: cells([[0, 0], [1, 0], [0, 1], [1, 1]]) },
  T: { name: 'T블록', kind: 'base', parts: cells([[0, 0], [1, 0], [2, 0], [1, 1]]) },
  S: { name: 'S블록', kind: 'base', parts: cells([[0, 0], [1, 0], [1, 1], [2, 1]]) },
  Z: { name: 'Z블록', kind: 'base', parts: cells([[0, 1], [1, 1], [1, 0], [2, 0]]) },
  J: { name: 'J블록', kind: 'base', parts: cells([[0, 1], [0, 0], [1, 0], [2, 0]]) },
  L: { name: 'L블록', kind: 'base', parts: cells([[2, 1], [0, 0], [1, 0], [2, 0]]) },
  // 추가 블록
  cross: { name: '십자가', kind: 'extra', parts: [{ box: [0.9, 0.2] }, { box: [0.2, 0.9] }] },
  ushape: { name: 'U자', kind: 'extra', parts: [{ box: [0.9, 0.15], at: [0, -0.45] }, { box: [0.15, 0.45], at: [-0.75, 0] }, { box: [0.15, 0.45], at: [0.75, 0] }] },
  halfmoon: { name: '반달', kind: 'extra', parts: [{ poly: halfDisc(0.85, 8) }] },
  house: { name: '집', kind: 'extra', parts: [{ box: [0.6, 0.45], at: [0, -0.25] }, { poly: [[-0.8, 0.2], [0.8, 0.2], [0, 0.9]] }] },
  hexagon: { name: '육각형', kind: 'extra', parts: [{ poly: ellipse(6, 0.65) }] },
  star: { name: '별', kind: 'extra', parts: starParts(0.95, 0.38) },
  bone: {
    name: '뼈다귀', kind: 'extra',
    parts: [{ box: [0.8, 0.15] }, { circle: 0.22, at: [-0.85, 0.15] }, { circle: 0.22, at: [-0.85, -0.15] }, { circle: 0.22, at: [0.85, 0.15] }, { circle: 0.22, at: [0.85, -0.15] }],
  },
  // 😈 악마 (악마 카드로만)
  ball: { name: '공', kind: 'devil', parts: [{ circle: 0.55 }] },
  stick: { name: '젓가락', kind: 'devil', parts: [{ box: [1.8, 0.12] }] },
  tri: { name: '세모', kind: 'devil', parts: [{ poly: [[-0.9, -0.55], [0.9, -0.55], [0, 0.85]] }] },
  wedge: { name: '뒤집힌 세모', kind: 'devil', parts: [{ poly: [[-0.9, 0.55], [0, -0.85], [0.9, 0.55]] }] },
  dumbbell: { name: '아령', kind: 'devil', parts: [{ circle: 0.4, at: [-0.9, 0] }, { circle: 0.4, at: [0.9, 0] }, { box: [0.9, 0.12] }] },
  diamond: { name: '다이아', kind: 'devil', parts: [{ poly: [[0, -1.0], [0.65, 0], [0, 1.0], [-0.65, 0]] }] },
  rugby: { name: '럭비공', kind: 'devil', parts: [{ poly: ellipse(12, 1.0, 0.5) }] },
  ice: { name: '미끌 얼음', kind: 'devil', parts: [{ box: [0.7, 0.4] }], props: { friction: 0 }, look: { fill: '#bfe9ff', mark: '❄' } },
  bouncy: { name: '탱탱볼', kind: 'devil', parts: [{ circle: 0.45 }], props: { restitution: 0.75 }, look: { fill: '#ff5fa2', mark: '★' } },
  iron: { name: '쇠공', kind: 'devil', parts: [{ circle: 0.42 }], props: { density: 6 }, look: { fill: '#636e72', mark: '⚙' } },
  xshape: { name: '엑스', kind: 'devil', parts: [{ box: [1.0, 0.1], rot: Math.PI / 4 }, { box: [1.0, 0.1], rot: -Math.PI / 4 }] },
  beads: { name: '꼬치', kind: 'devil', parts: [{ circle: 0.32, at: [-0.64, 0] }, { circle: 0.32 }, { circle: 0.32, at: [0.64, 0] }, { box: [0.95, 0.05] }] },
  pole: { name: '장대', kind: 'devil', parts: [{ box: [0.1, 1.4] }] },
};
// 아이콘 크기용 반지름
for (const def of Object.values(SHAPES)) {
  def.r = Math.max(...def.parts.map(part => {
    const off = Math.hypot(...(part.at || [0, 0]));
    if (part.box) return off + Math.hypot(part.box[0], part.box[1]);
    if (part.circle) return off + part.circle;
    return off + Math.max(...part.poly.map(([x, y]) => Math.hypot(x, y)));
  }));
}
export const ROULETTE = Object.keys(SHAPES).filter(k => SHAPES[k].kind !== 'devil');
export const DEVILS = Object.keys(SHAPES).filter(k => SHAPES[k].kind === 'devil');
// 예전 판에서 넘어온 모르는 모양이 있어도 깨지지 않게
const shapeOf = s => SHAPES[s] || SHAPES.O;
const isDevil = s => SHAPES[s]?.kind === 'devil';

// 블록 맨 윗부분의 높이 (실제 모양과 회전을 반영)
function topOf(s, x, y, a) {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const wy = (lx, ly) => y + lx * sn + ly * c;
  let top = -Infinity;
  for (const part of shapeOf(s).parts) {
    const [ax, ay] = part.at || [0, 0];
    if (part.circle) {
      top = Math.max(top, wy(ax, ay) + part.circle);
      continue;
    }
    let pts = part.poly;
    if (part.box) {
      const [hx, hy] = part.box;
      const rc = Math.cos(part.rot || 0);
      const rs = Math.sin(part.rot || 0);
      pts = [[hx, hy], [-hx, hy], [hx, -hy], [-hx, -hy]].map(([u, v]) => [u * rc - v * rs, u * rs + v * rc]);
    }
    for (const [px, py] of pts) top = Math.max(top, wy(px + ax, py + ay));
  }
  return top;
}

// 방장만 물리 엔진이 필요하다. 게임이 시작될 때 처음 한 번 불러온다.
let planck = null;
let loading = null;
function ensurePlanck() {
  if (planck || loading) return;
  loading = import(PLANCK_URL).then(m => { planck = m; }).catch(e => {
    loading = null;
    console.error('[tower] 물리 엔진을 불러오지 못했어요', e);
  });
}
export function usePlanck(m) { planck = m; } // 테스트용

const aimTime = lap => Math.max(6000, 11000 - (lap - 1) * 2000);
const round3 = v => Math.round(v * 1000) / 1000;

/* ───────── 물리 (방장 전용) ───────── */

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
  const { Vec2, Box, Circle, Polygon } = planck;
  const def = shapeOf(b.s);
  const props = def.props || {};
  const body = sim.world.createBody({ type: 'dynamic', position: new Vec2(b.x, b.y), angle: b.a, awake });
  for (const part of def.parts) {
    const [ax, ay] = part.at || [0, 0];
    let shape;
    if (part.box) shape = new Box(part.box[0], part.box[1], new Vec2(ax, ay), part.rot || 0);
    else if (part.circle) shape = new Circle(new Vec2(ax, ay), part.circle);
    else shape = new Polygon(part.poly.map(([x, y]) => new Vec2(x + ax, y + ay)));
    // 튕김 없음(탱탱볼만 예외): 떨어지면 그 자리에 철퍼덕
    body.createFixture(shape, { density: props.density ?? 1, friction: props.friction ?? 0.7, restitution: props.restitution ?? 0 });
  }
  sim.bodies.set(b.id, body);
  sim.meta.set(b.id, { s: b.s, by: b.by });
  return body;
}

// trail: 이번 틱 동안 지나간 중간 자리들 (꺾이며 움직인 블록만) → b.p
function snapshot(ctx, trail) {
  const S = ctx.state;
  const sim = ctx.sim;
  let top = 0;
  S.bodies = [...sim.bodies].map(([id, body]) => {
    const p = body.getPosition();
    const a = body.getAngle();
    const m = sim.meta.get(id);
    top = Math.max(top, topOf(m.s, p.x, p.y, a));
    const b = { id, s: m.s, by: m.by, x: round3(p.x), y: round3(p.y), a: round3(a) };
    if (trail?.has(id)) b.p = trail.get(id);
    return b;
  });
  S.top = round3(top);
}

const pose = body => {
  const p = body.getPosition();
  return [round3(p.x), round3(p.y), round3(body.getAngle())];
};

// 떨굴 때 블록 중심 높이: 블록 맨 아래가 탑 꼭대기 + DROP_GAP에 오게 (모양·회전 반영).
// 180° 더 돌린 모양의 꼭대기 = 지금 모양에서 중심부터 맨 아래까지 깊이
const spawnY = (S, s, a) => (S.top || 0) + DROP_GAP + topOf(s, 0, 0, a + Math.PI);

/* ───────── 진행 ───────── */

// 순서는 테트리스 가방(7-bag)처럼: 바퀴마다 살아 있는 사람을 섞어서 모두 한 번씩 둔다.
// 가방이 비면 새로 섞는데, 방금 둔 사람이 바로 또 첫 순서가 되면 안 된다
// (연속으로 두는 데다 자기 블록에 자기가 악마 카드를 쓰게 되니까).
export function newBag(S, justPlayed) {
  const bag = shuffle(S.alive);
  if (bag.length > 1 && bag[0] === justPlayed) {
    const k = 1 + Math.floor(Math.random() * (bag.length - 1));
    [bag[0], bag[k]] = [bag[k], bag[0]];
  }
  S.bag = bag;
  S.bagPos = 0;
  S.lap = (S.lap || 0) + 1;
  return bag[0];
}

// 가방에서 다음 사람 (그사이 탈락한 사람은 건너뜀). 다 돌았으면 새 가방.
export function nextInBag(S, justPlayed) {
  const bag = S.bag || [];
  for (let i = (S.bagPos ?? -1) + 1; i < bag.length; i++) {
    if (!S.alive.includes(bag[i])) continue;
    S.bagPos = i;
    return bag[i];
  }
  return newBag(S, justPlayed);
}

// 다음 사람은 미리 정하지만(순서 가방), 그 사람 블록은 비밀이다 — 차례가 시작될 때 룰렛으로 뽑는다.
// 악마 카드를 쓰면 그때 '내가 고른 악마 블록'으로 정해져서 모두에게 보인다.
function rollNext(ctx, now, after) {
  const S = ctx.state;
  S.next = { id: nextInBag(S, after), kind: 'random', lap: S.lap, at: now };
}

function startTurn(ctx, now) {
  const S = ctx.state;
  const n = S.next;
  S.phase = 'spin';
  S.turn = n.id;
  S.spinKind = n.kind === 'devil' ? 'devil' : 'roulette';
  S.piece = n.kind === 'devil' ? n.piece : pick(ROULETTE);
  S.chooser = n.kind === 'devil' ? n.by : null;
  S.turnLap = n.lap;
  S.spinEnd = now + SPIN_TIME;
  S.aim = { x: 0, a: 0 };
  S.devilOptions = shuffle(DEVILS).slice(0, 3); // 이번 차례에 내가 쓸 수 있는 악마 블록 3개
  rollNext(ctx, now, S.turn);
  return true;
}

// 지금 차례인 사람만, 내 차례 동안(룰렛·조준·낙하·고민) 다음 사람에게 쓸 수 있다
const canUseCard = (S, pid) => pid === S.turn && ['spin', 'aim', 'fall', 'decide'].includes(S.phase)
  && (S.cards?.[pid] || 0) > 0 && !!S.next && S.next.kind !== 'devil';

function useCard(ctx, pid, i, now) {
  const S = ctx.state;
  const shape = S.devilOptions?.[i];
  if (!shape || !canUseCard(S, pid)) return false;
  S.cards = { ...S.cards, [pid]: S.cards[pid] - 1 };
  S.next = { ...S.next, piece: shape, kind: 'devil', by: pid, at: now };
  S.cardUses = [...(S.cardUses || []), { by: pid, to: S.next.id, s: shape, at: now }].slice(-8);
  ctx.announce(`😈 ${josa(ctx.nameOf(pid), '이', '가')} ${ctx.nameOf(S.next.id)}의 블록을 바꿔치기! → ${SHAPES[shape].name}`);
  if (S.phase === 'decide') {
    S.phase = 'result';
    S.phaseEndsAt = now + RESULT_TIME;
  }
  return true;
}

function drop(ctx, now, aim) {
  const S = ctx.state;
  S.bodyNo = (S.bodyNo || 0) + 1;
  const id = `k${S.bodyNo}`;
  const x = Math.max(-X_LIMIT, Math.min(X_LIMIT, Number(aim?.x) || 0));
  const a = Number(aim?.a) || 0;
  addBody(ctx.sim, { id, s: S.piece, by: S.turn, x, y: spawnY(S, S.piece, a), a }, true);
  S.pieceId = id;
  S.phase = 'fall';
  S.dropAt = now;
  S.toppled = 0;
  ctx.simAt = now;
  snapshot(ctx);
  return true;
}

function stepFall(ctx, now) {
  const S = ctx.state;
  const sim = ctx.sim;
  const dt = Math.min(500, Math.max(0, now - (ctx.simAt || now)));
  ctx.simAt = now;
  const steps = Math.max(1, Math.round(dt / (1000 / 60)));
  // 위치는 0.1초마다 보내는데, 그것만 직선으로 이으면 튕기거나 부딪히는 순간이 빠져서
  // 허공에서 꺾이고 착지도 사뿐해 보인다. 그래서 틱 사이 중간 자리도 고르게 몇 개 기록한다.
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
  // 곧게 움직였거나 가만히 있던 건 직선으로 이어도 되니 빼고, 꺾인 것만 보낸다
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
  // 다 멈췄으면 끝. 오래 걸려도 공중에 떠 있거나 빠르게 움직이는 게 있으면 결판날 때까지 기다린다
  // (중간에 멈추면 허공에 뜬 채로 다음 차례에 이어지고, 그때 떨어지면 애꿎은 다음 사람이 탈락한다)
  if ((!bodies.some(b => b.isAwake()) && age > 800) || (age > SETTLE_MAX && !bodies.some(flying)) || age > SETTLE_HARD) {
    settle(ctx, now);
  }
  return true;
}

function touching(body) {
  for (let ce = body.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) return true;
  return false;
}
const flying = body => body.isAwake() && (body.getLinearVelocity().length() > 0.3 || !touching(body));

function settle(ctx, now) {
  const S = ctx.state;
  const name = ctx.nameOf;
  const active = S.turn;
  const toppled = S.toppled || 0;
  // 아직 꿈틀대던 건 그 자리에 세워서(재워서) 다음 차례로 움직임이 넘어가지 않게.
  // 다음 블록이 건드리면 다시 깨어난다.
  for (const body of ctx.sim.bodies.values()) body.setAwake(false);
  snapshot(ctx); // 중간 자리(p)는 떨어지는 동안에만 필요하다
  S.turnsPlayed = (S.turnsPlayed || 0) + 1;
  S.lastResult = { id: active, ok: !toppled, n: toppled, at: now };
  if (toppled) {
    S.fails = [...(S.fails || []), { id: active, at: now, n: toppled }].slice(-8);
    if (S.alive.includes(active)) {
      S.alive = S.alive.filter(id => id !== active);
      S.outOrder = [...(S.outOrder || []), active];
      const killer = S.chooser && S.chooser !== active ? S.chooser : null;
      S.dead = { ...(S.dead || {}), [active]: killer || '-' };
      if (killer) {
        ctx.kill(killer, active, `😈 ${shapeOf(S.piece).name}`);
        S.kills = { ...(S.kills || {}), [killer]: (S.kills?.[killer] || 0) + 1 };
      } else {
        ctx.announce(`🎰 룰렛의 저주! ${name(active)} 탈락 (${shapeOf(S.piece).name} · 블록 ${toppled}개 추락)`);
      }
    }
  } else if (!S.best || S.top > S.best.h) {
    S.best = { id: active, h: S.top };
  }
  S.toppled = 0;
  S.pieceId = null;
  if (S.alive.length <= 1) return finish(ctx);
  // 카드가 남았으면(탈락했어도 유령으로) 넉넉하게 고민할 시간, 아니면 결과만 잠깐
  if (canUseCard({ ...S, phase: 'decide' }, active)) {
    S.phase = 'decide';
    S.phaseEndsAt = now + DECIDE_TIME;
  } else {
    S.phase = 'result';
    S.phaseEndsAt = now + RESULT_TIME;
  }
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const placement = [...S.alive, ...[...(S.outOrder || [])].reverse()];
  for (const p of S.roster) if (!placement.includes(p.id)) placement.push(p.id);
  S.placement = placement;
  S.standings = Object.fromEntries(placement.map((id, i) => [id, placement.length - i]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  if (S.alive[0]) add(S.alive[0], '👑 마지막 건축가');
  const [killer, kills] = Object.entries(S.kills || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (kills >= 1) add(killer, `😈 악마의 선택 (${kills}킬)`);
  if (S.best?.h >= 3) add(S.best.id, `🏗️ 최고층 ${S.best.h.toFixed(1)}m`);
  S.titles = titles;
  S.next = null;
  S.phase = 'final';
  S.over = true;
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
const safeColor = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#bdc3c7');

function shapeGroup(s, color) {
  const def = shapeOf(s);
  const style = { fill: safeColor(def.look?.fill || color), stroke: '#2c3e50', 'stroke-width': 0.07, 'stroke-linejoin': 'round' };
  const parts = def.parts.map(part => {
    const [ax, ay] = part.at || [0, 0];
    if (part.box) {
      return svg('rect', {
        x: ax - part.box[0], y: ay - part.box[1], width: part.box[0] * 2, height: part.box[1] * 2, rx: 0.06,
        transform: part.rot ? `rotate(${(part.rot * 180) / Math.PI} ${ax} ${ay})` : null, ...style,
      });
    }
    if (part.circle) return svg('circle', { cx: ax, cy: ay, r: part.circle, ...style });
    return svg('polygon', { points: part.poly.map(([x, y]) => `${x + ax},${y + ay}`).join(' '), ...style });
  });
  if (def.look?.mark) {
    parts.push(svg('text', {
      class: 'tw-mark', x: 0, y: 0, transform: 'scale(1,-1)', 'font-size': 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    }, def.look.mark));
  }
  return svg('g', {}, parts);
}

function shapeIcon(s, color) {
  const r = shapeOf(s).r + 0.15;
  return svg('svg', { viewBox: `${-r} ${-r} ${2 * r} ${2 * r}`, class: 'tw-icon' },
    svg('g', { transform: 'scale(1,-1)' }, shapeGroup(s, color)));
}

export default {
  id: 'tower',
  title: '독박 타워',
  emoji: '🧱',
  tag: '우정파괴',
  color: '#e67e22',
  desc: '돌아가며 블록을 쌓아요. 블록은 🎰 룰렛! 한 판에 한 번 😈 악마 카드로 다음 사람 블록을 내가 정해 버릴 수 있어요. 떨어뜨리면 탈락',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx) {
    ensurePlanck();
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + INTRO_TIME,
      alive: ctx.roster.map(p => p.id),
      cards: Object.fromEntries(ctx.roster.map(p => [p.id, DEVIL_CARDS])),
      top: 0,
      turnsPlayed: 0,
      lap: 0, // 가방(바퀴) 번호. 첫 가방을 섞을 때 1이 된다
    };
  },

  onInput(ctx, { pid, type, data }) {
    const S = ctx.state;
    const now = ctx.now();
    if (type === 'aim' && S.phase === 'aim' && pid === S.turn) {
      S.aim = { x: round3(Math.max(-X_LIMIT, Math.min(X_LIMIT, Number(data.x) || 0))), a: round3(Number(data.a) || 0) };
      return true;
    }
    if (type === 'drop' && S.phase === 'aim' && pid === S.turn && ctx.sim) return drop(ctx, now, data);
    if (type === 'devil' && Number.isInteger(data.i)) return useCard(ctx, pid, data.i, now);
    if (type === 'pass' && S.phase === 'decide' && pid === S.turn) return startTurn(ctx, now);
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
        S.next = { id: first, kind: 'random', lap: S.lap, at: now };
        return startTurn(ctx, now);
      }
      case 'spin':
        if (now < S.spinEnd) return false;
        S.phase = 'aim';
        S.phaseEndsAt = now + aimTime(S.turnLap);
        return true;
      case 'aim':
        if (now < S.phaseEndsAt && ctx.isOnline(S.turn)) return false;
        return drop(ctx, now, S.aim);
      case 'fall':
        return stepFall(ctx, now);
      case 'decide':
        if (now < S.phaseEndsAt && ctx.isOnline(S.turn)) return false;
        return startTurn(ctx, now);
      case 'result':
        return now >= S.phaseEndsAt && startTurn(ctx, now);
      default:
        return false;
    }
  },

  // 봇: 내 차례 동안 악마 카드를 쓸지 정하고(탑이 높을수록·막판일수록·죽었을 때 잘 씀),
  // 탑 꼭대기 근처를 노려 천천히 조준하고 떨군다.
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (canUseCard(S, id)) {
      const key = `${S.turn}:${(S.devilOptions || []).join()}`;
      if (mem.cardKey !== key) {
        mem.cardKey = key;
        const chance = 0.25 + Math.min(0.35, (S.top || 0) * 0.05) + (S.alive.length <= 2 ? 0.3 : 0)
          + (S.alive.includes(id) ? 0 : 0.4);
        mem.useCard = Math.random() < chance;
        mem.cardAt = now + 2000 + Math.random() * 6000;
        mem.passAt = 0;
      }
      if (mem.useCard && (now >= mem.cardAt || S.phase === 'decide')) {
        mem.useCard = false;
        return { type: 'devil', data: { i: Math.floor(Math.random() * 3) }, say: Math.random() < 0.5 };
      }
      if (S.phase === 'decide' && !mem.useCard) {
        mem.passAt ||= now + 800 + Math.random() * 1200;
        return now >= mem.passAt ? { type: 'pass' } : null;
      }
    }
    if (S.phase === 'aim' && S.turn === id) {
      const key = `${S.turnsPlayed}`;
      if (mem.key !== key) {
        const topBody = [...(S.bodies || [])].sort((a, b) => b.y - a.y)[0];
        mem.key = key;
        mem.x = 0;
        mem.tx = Math.max(-2.4, Math.min(2.4, (topBody?.x || 0) + (Math.random() - 0.5) * 0.9));
        mem.ta = isDevil(S.piece) && Math.random() < 0.5 ? ROT_STEP * pick([-1, 1]) : 0;
        mem.dropAt = now + 2000 + Math.random() * 3500;
        mem.sent = 0;
      }
      if (now >= mem.dropAt) return { type: 'drop', data: { x: mem.tx, a: mem.ta }, say: Math.random() < 0.1 };
      if (now - mem.sent > 150) {
        mem.sent = now;
        mem.x += Math.sign(mem.tx - mem.x) * Math.min(0.5, Math.abs(mem.tx - mem.x));
        return { type: 'aim', data: { x: mem.x, a: mem.ta } };
      }
    }
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const top = h('div', { class: 'tw-top' });
    const bodiesG = svg('g');
    const guide = svg('line', { class: 'tw-guide', x1: 0, y1: 0, x2: 0, y2: 0 });
    const previewPiece = svg('g');
    const previewG = svg('g', { class: 'tw-preview' }, guide, previewPiece);
    const platform = svg('g', {},
      svg('rect', { x: -PLATFORM_W / 2, y: -PLATFORM_H, width: PLATFORM_W, height: PLATFORM_H, rx: 0.08, fill: '#34495e', stroke: '#2c3e50', 'stroke-width': 0.08 }),
      svg('rect', { x: -0.35, y: -9, width: 0.7, height: 9 - PLATFORM_H, fill: '#34495e' }));
    const stage = svg('svg', { class: 'tw-svg', preserveAspectRatio: 'xMidYMax meet' },
      svg('g', { transform: 'scale(1,-1)' }, platform, bodiesG, previewG));
    const fx = h('div', { class: 'tw-fx' });
    const nextBox = h('div', { class: 'tw-next', hidden: true });
    const stageWrap = h('div', { class: 'tw-stage' }, stage, nextBox, fx);
    const panel = h('div', { class: 'tw-panel' });
    const box = h('div', { class: 'tw-box' }, top, stageWrap, panel);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'tw' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    const shown = new Map(); // id → { el, from, to, t }
    let camTop = 9;
    let panelKey = '';
    let nextKey = '';
    let reelTimer = 0;
    let seenFail = null;
    let seenCard = null;
    let seenLap = null;
    // 내 차례일 때 조준 (내 화면에서 바로 움직이고, 방장에게는 가끔 알려 준다)
    const aim = { x: 0, a: 0, turnKey: '', dropped: false, sentAt: 0, sent: '' };
    const held = { left: false, right: false };
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const colorOf = id => who(id).color;
    const myTurn = () => S?.phase === 'aim' && S.turn === me;
    const label = s => `${isDevil(s) ? '😈 ' : ''}${shapeOf(s).name}`;
    const nextLabel = () => (S.next?.kind === 'devil' ? `😈 ${shapeOf(S.next.piece).name}` : '❓ 랜덤');

    function onKey(e) {
      if (isTyping(e) || !S) return;
      const down = e.type === 'keydown';
      const c = e.code;
      // 악마 카드: 내 차례 동안 숫자키 1·2·3, 다 놓은 뒤 고민 중엔 스페이스 = 안 씀
      if (down && !e.repeat && canUseCard(S, me)) {
        const d = digitOf(e);
        if (d >= 1 && d <= 3) {
          e.preventDefault();
          api.send('devil', { i: d - 1 });
          return;
        }
        if (c === 'Space' && S.phase === 'decide') {
          e.preventDefault();
          api.send('pass');
          return;
        }
      }
      if (c === 'ArrowLeft' || c === 'KeyA' || c === 'ArrowRight' || c === 'KeyD') {
        if (!myTurn()) return;
        const left = c === 'ArrowLeft' || c === 'KeyA';
        e.preventDefault();
        held[left ? 'left' : 'right'] = down;
        // 톡 치면 조금(미세 조정), 꾹 누르면 계속 이동
        if (down && !e.repeat && !aim.dropped) {
          aim.x = Math.max(-X_LIMIT, Math.min(X_LIMIT, aim.x + (left ? -0.25 : 0.25)));
          sendAim();
        }
        return;
      }
      if (!down || !myTurn()) return;
      if (c === 'ArrowUp' || c === 'KeyW' || c === 'ArrowDown' || c === 'KeyS') {
        e.preventDefault();
        aim.a += (c === 'ArrowUp' || c === 'KeyW' ? 1 : -1) * ROT_STEP;
        sendAim();
      } else if (c === 'Space' && !e.repeat && !aim.dropped) {
        e.preventDefault();
        aim.dropped = true;
        api.send('drop', { x: aim.x, a: aim.a });
        renderPanel();
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    function sendAim() {
      const key = `${aim.x.toFixed(2)}:${aim.a.toFixed(3)}`;
      if (key === aim.sent) return;
      aim.sent = key;
      aim.sentAt = performance.now();
      api.send('aim', { x: aim.x, a: aim.a });
    }

    function syncBodies() {
      const now = performance.now();
      const live = new Set();
      for (const b of S.bodies || []) {
        live.add(b.id);
        const it = shown.get(b.id);
        if (!it) {
          const el = shapeGroup(b.s, colorOf(b.by));
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
      // 내 조준 움직이기
      if (myTurn() && !aim.dropped) {
        const dt = Math.min(0.05, (now - (aim.last || now)) / 1000);
        const dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
        aim.x = Math.max(-X_LIMIT, Math.min(X_LIMIT, aim.x + dir * MOVE_SPEED * dt));
        if (now - aim.sentAt > 120) sendAim();
      }
      aim.last = now;
      for (const it of shown.values()) {
        const p = current(it, now);
        it.el.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${(p.a * 180) / Math.PI})`);
      }
      // 조준 중인 블록 미리보기 (떨어질 높이 그대로, 점선은 돌려도 똑바로 아래로)
      if (S.phase === 'aim') {
        const p = myTurn() ? aim : S.aim || { x: 0, a: 0 };
        const y = spawnY(S, S.piece, p.a);
        if (previewG.dataset.key !== `${S.turnsPlayed}:${S.piece}`) {
          previewG.dataset.key = `${S.turnsPlayed}:${S.piece}`;
          previewPiece.replaceChildren(shapeGroup(S.piece, colorOf(S.turn)));
        }
        previewG.style.display = '';
        previewG.setAttribute('transform', `translate(${p.x} ${y})`);
        guide.setAttribute('y2', -y - 1);
        previewPiece.setAttribute('transform', `rotate(${(p.a * 180) / Math.PI})`);
      } else {
        previewG.style.display = 'none';
      }
      // 카메라: 탑이 높아지면 위로 (세워 든 긴 블록도 다 보이게)
      const want = Math.max(9, (S.top || 0) + 5.5);
      camTop += (want - camTop) * 0.08;
      stage.setAttribute('viewBox', `-7 ${-camTop} 14 ${camTop + 3}`);
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
      const fails = S.fails || [];
      const cards = S.cardUses || [];
      if (seenFail === null) {
        seenFail = Math.max(0, ...fails.map(x => x.at));
        seenCard = Math.max(0, ...cards.map(x => x.at));
        return;
      }
      for (const f of fails) {
        if (f.at <= seenFail) continue;
        seenFail = f.at;
        flash(`💥 와르르! ${who(f.id).name} 탈락`, 'bad');
        shake();
      }
      for (const u of cards) {
        if (u.at <= seenCard) continue;
        seenCard = u.at;
        flash(`😈 ${who(u.by).name}의 바꿔치기 → ${who(u.to).name}`, 'bad');
        shake();
      }
    }

    // NEXT: 다음 사람. 블록은 '?' (차례 때 룰렛) — 악마 카드로 정해졌으면 그 블록이 빨갛게 보인다.
    function renderNext() {
      const n = S.next;
      const show = !!n && ['spin', 'aim', 'fall', 'decide', 'result'].includes(S.phase);
      nextBox.hidden = !show;
      if (!show) return;
      const key = `${n.id}:${n.at}:${n.kind}`;
      if (key === nextKey) return;
      nextKey = key;
      const devil = n.kind === 'devil';
      nextBox.classList.toggle('devil', devil);
      nextBox.replaceChildren(...[
        h('div', { class: 'tw-next-label' }, n.id === me ? 'NEXT · 나!' : 'NEXT'),
        h('div', { class: 'name-chip' }, avatar(who(n.id)), who(n.id).name),
        devil ? h('div', { class: 'tw-next-reel' }, shapeIcon(n.piece, colorOf(n.id))) : h('div', { class: 'tw-mystery' }, '?'),
        h('div', { class: 'tw-next-piece' }, devil ? label(n.piece) : '🎰 랜덤'),
        devil ? h('div', { class: 'tw-next-by' }, `😈 ${josa(who(n.by).name, '이', '가')} 정함`) : null,
      ].filter(Boolean));
    }

    // 차례 시작: 룰렛이 촤라락 돌다가 멈춘다 (악마 카드로 정해졌으면 바로 공개)
    function runReel(reel, name) {
      clearTimeout(reelTimer);
      const final = S.piece;
      const end = S.spinEnd;
      const color = colorOf(S.turn);
      const land = () => {
        reel.replaceChildren(shapeIcon(final, color));
        reel.classList.add('land');
        name.textContent = `${label(final)}!`;
      };
      if (S.spinKind === 'devil') return land();
      const step = () => {
        const left = end - api.now();
        if (left <= 0) return land();
        reel.replaceChildren(shapeIcon(pick(ROULETTE), color));
        const k = Math.min(1, Math.max(0, 1 - left / SPIN_TIME));
        reelTimer = setTimeout(step, 45 + 240 * k * k);
      };
      step();
    }

    function renderTop() {
      const bits = [h('span', {}, S.turnLap ? `${S.turnLap}바퀴` : '곧 시작'), h('span', {}, `높이 ${(S.top || 0).toFixed(1)}m`)];
      if (S.phase === 'aim') bits.push(countdown(S.phaseEndsAt, aimTime(S.turnLap)));
      if (S.phase === 'spin') bits.push(h('span', {}, '🎰 룰렛!'));
      if (S.phase === 'decide') bits.push(countdown(S.phaseEndsAt, DECIDE_TIME));
      top.replaceChildren(...bits);
    }

    // 악마 카드 버튼들 (작게: 내 차례 중, 크게: 다 놓고 고민할 때)
    function devilButtons(big) {
      const next = who(S.next.id);
      return (S.devilOptions || []).map((s, i) => h('button', {
        class: big ? 'tw-option devil' : 'tw-devil-btn', tabindex: '-1',
        onClick: () => api.send('devil', { i }),
      }, h('kbd', { class: big ? 'num' : '' }, String(i + 1)), shapeIcon(s, next.color), h('b', {}, SHAPES[s].name)));
    }

    function devilStrip() {
      if (!canUseCard(S, me)) return null;
      return h('div', { class: 'tw-devil' },
        h('b', {}, `😈 악마 카드: ${who(S.next.id).name}의 다음 블록(?)을 내가 정하기`),
        devilButtons(false),
        h('span', { class: 'muted small' }, `지금 안 써도 블록 놓은 뒤에 ${DECIDE_TIME / 1000}초 더 고민할 수 있어요`));
    }

    function panelView() {
      if (S.phase === 'intro') {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '🧱 독박 타워'),
          h('ul', { class: 'rules big' },
            h('li', {}, '돌아가며 받침대 위에 블록을 하나씩 쌓아요. 블록은 🎰 룰렛으로 랜덤!'),
            h('li', {}, '다음 사람 블록은 ? — 그 사람 차례가 와야 룰렛으로 정해져요'),
            h('li', {}, `😈 악마 카드 ${DEVIL_CARDS}장: 내 차례 동안 숫자키 1·2·3으로 다음 사람 블록을 내가 고른 악마 블록으로 정해 버리기 (그걸로 죽으면 내 킬)`),
            h('li', {}, '← → 이동 · ↑ ↓ 회전 · 스페이스 떨구기'),
            h('li', {}, '블록이 하나라도 떨어지면 놓은 사람 탈락 · 순서는 바퀴마다 랜덤')),
          countdown(S.phaseEndsAt, INTRO_TIME));
      }
      if (S.phase === 'final') {
        const winner = who(S.placement?.[0]);
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, `👑 ${winner.name} 마지막 건축가!`), podium(S.roster, S.standings, me));
      }
      const from = S.chooser ? `${who(S.chooser).name}의 😈 ` : '🎰 ';
      if (S.phase === 'spin') {
        const reel = h('div', { class: `tw-reel${S.spinKind === 'devil' ? ' devil' : ''}` });
        const name = h('div', { class: 'tw-reel-name' });
        queueMicrotask(() => runReel(reel, name));
        const whose = S.turn === me ? '내' : `${who(S.turn).name}의`;
        return h('div', { class: 'bt-act' },
          h('div', { class: `bt-act-title${S.spinKind === 'devil' ? ' hot' : ''}` },
            S.spinKind === 'devil' ? `😈 ${josa(who(S.chooser).name, '이', '가')} 정한 ${whose} 블록!` : `🎰 ${whose} 블록은…`),
          reel, name, S.turn === me ? devilStrip() : null);
      }
      if (S.phase === 'aim') {
        if (S.turn === me) {
          if (aim.dropped) return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '떨궜다! 🙏'), devilStrip());
          return h('div', { class: 'bt-act' },
            h('div', { class: 'bt-act-title hot' }, `내 차례! ${from}${shapeOf(S.piece).name}`),
            h('p', {}, '← → 이동 · ↑ ↓ 회전 · 스페이스 떨구기'),
            devilStrip());
        }
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `${who(S.turn).name} 차례`),
          h('p', {}, `${from}${shapeOf(S.piece).name} 놓는 중…`),
          S.next?.id === me ? h('p', { class: 'muted' }, S.next.kind === 'devil' ? `😰 다음은 나… ${nextLabel()} 확정` : '😰 다음은 나! 내 블록은 ?') : null);
      }
      if (S.phase === 'fall') {
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '떨어지는 중… 😬'), S.turn === me ? devilStrip() : null);
      }
      if (S.phase === 'decide') {
        const next = who(S.next.id);
        if (S.turn === me) {
          return h('div', { class: 'bt-act' },
            h('div', { class: 'bt-act-title hot' }, `😈 ${next.name}한테 악마 카드 쓸래?`),
            h('p', {}, `안 쓰면 ${next.name}의 블록은 🎰 랜덤(?) · 남은 카드 ${S.cards?.[me] || 0}장`),
            h('div', { class: 'tw-options' }, devilButtons(true)),
            h('p', { class: 'muted' }, '숫자키 1·2·3 = 이걸로 바꿔치기 · 스페이스 = 안 씀'));
        }
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `😈 ${josa(who(S.turn).name, '이', '가')} 악마 카드 고민 중…`),
          h('p', {}, S.next.id === me ? '😰 다음은 나… 제발 쓰지 마' : `다음: ${next.name}`));
      }
      if (S.phase === 'result') {
        const r = S.lastResult;
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, r && !r.ok ? `💥 ${who(r.id).name} 탈락!` : '✅ 버텼다!'),
          h('p', {}, `다음: ${who(S.next.id).name} · ${nextLabel()}`));
      }
      return h('div');
    }

    function renderPanel() {
      const key = [S.phase, S.turnsPlayed, S.turn, S.spinEnd, aim.dropped, S.next?.kind, S.cards?.[me]].join('|');
      if (key === panelKey) return;
      panelKey = key;
      clearTimeout(reelTimer);
      panel.replaceChildren(panelView());
    }

    function renderSide() {
      const deadList = (S.outOrder || []).map(id => {
        const by = S.dead?.[id];
        return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${who(by).name}의 😈` : ' 🎰 룰렛');
      });
      // 순서 (가방): 끝난 사람 / 지금 / 다음 / 탈락. 😈 = 악마 카드 남음
      const bag = (S.bag || []).map((id, i) => {
        const dead = !S.alive.includes(id);
        const cls = dead ? 'dead' : id === S.turn ? 'now' : id === S.next?.id ? 'next' : i < (S.bagPos ?? 0) ? 'done' : '';
        return h('li', { class: cls }, avatar(who(id)), h('span', {}, who(id).name),
          (S.cards?.[id] || 0) > 0 ? h('i', { class: 'tw-card', title: '악마 카드 남음' }, '😈') : null,
          cls === 'now' ? h('em', {}, '차례') : cls === 'next' ? h('em', {}, '다음') : cls === 'done' ? h('em', {}, '✓') : null);
      });
      side.replaceChildren(...[
        h('h3', {}, S.lap ? `${S.lap}바퀴 순서 · 생존 ${S.alive.length}명` : `생존 ${S.alive.length}명`),
        bag.length
          ? h('ol', { class: 'tw-bag' }, bag)
          : h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), who(id).name))),
        deadList.length ? h('h3', {}, '탈락 기록') : null,
        deadList.length ? h('ul', { class: 'rules' }, deadList) : null,
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '← → (A D) 이동 · 톡 치면 미세 조정'),
          h('li', {}, '↑ ↓ (W S) 15° 회전'),
          h('li', {}, '스페이스 떨구기'),
          h('li', {}, '😈 악마 카드: 내 차례 동안 숫자키 1·2·3'),
          h('li', {}, '다 놓고 고민할 땐 스페이스 = 안 씀')),
      ].filter(Boolean));
    }

    return {
      update({ state }) {
        S = state;
        const turnKey = `${S.turnsPlayed}:${S.turn}`;
        if (aim.turnKey !== turnKey) {
          aim.turnKey = turnKey;
          aim.x = 0;
          aim.a = 0;
          aim.dropped = false;
          held.left = held.right = false;
        }
        syncBodies();
        checkEvents();
        renderTop();
        renderNext();
        renderPanel();
        renderSide();
      },
      unmount() {
        cancelAnimationFrame(raf);
        clearTimeout(reelTimer);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
      },
    };
  },
};
