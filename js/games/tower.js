// 독박 타워: 좁은 받침대에 돌아가며 물리 블록을 쌓는다.
// 블록은 🎰 룰렛(보통 + 특이한 모양 중 완전 랜덤)으로 정해지고,
// 각자 한 판에 한 번 '😈 악마 카드'로 다음 사람에게 악마 블록을 강제로 줄 수 있다 (그걸로 죽으면 내 킬).
// 블록이 하나라도 떨어지면 놓은 사람 탈락. 순서는 바퀴마다 섞는다(테트리스 가방처럼). 마지막 1명 우승.
// 물리는 방장 컴퓨터만 계산하고(planck.js), 다른 사람은 위치만 받아서 그린다.
import { h, isTyping, josa, pick, shuffle } from '../util.js';
import { avatar, countdown, keyNav, podium } from '../ui.js';

const PLANCK_URL = 'https://cdn.jsdelivr.net/npm/planck@1.4.2/+esm';
const INTRO_TIME = 7000;
const DEVIL_TIME = 5000;     // 악마 카드 쓸지 고민하는 시간
const SPIN_TIME = 1700;      // 룰렛 도는 시간
const SETTLE_MAX = 5000;     // 떨군 뒤 최대 이만큼 기다리면 다음 차례
const DEVIL_CARDS = 1;       // 한 판에 1인당 악마 카드
const PLATFORM_W = 5.2;
const PLATFORM_H = 0.6;
const FALL_Y = -2;           // 이 아래로 내려가면 떨어진 것
const X_LIMIT = 5;           // 조준 좌우 한계
const ROT_STEP = Math.PI / 12; // 15도
const MOVE_SPEED = 5;        // 초당
const GUST = 6;              // 유령 입김 세기

/* ───────── 블록 모양 (단위: m, 몸통 기준점 0,0) ─────────
   물리 엔진은 볼록한 조각만 받아서, 오목한 모양은 여러 조각(parts)으로 나눈다.
   kind: normal(보통) · odd(특이한 모양) → 룰렛 / devil(악마) → 악마 카드 전용 */
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

export const SHAPES = {
  // 보통
  plank: { name: '널빤지', kind: 'normal', parts: [{ box: [1.6, 0.25] }] },
  brick: { name: '벽돌', kind: 'normal', parts: [{ box: [1.0, 0.4] }] },
  cube: { name: '정육면체', kind: 'normal', parts: [{ box: [0.6, 0.6] }] },
  pillar: { name: '기둥', kind: 'normal', parts: [{ box: [0.35, 1.0] }] },
  lblock: { name: 'L블록', kind: 'normal', parts: [{ box: [0.9, 0.3], at: [0, -0.3] }, { box: [0.3, 0.6], at: [-0.6, 0.3] }] },
  tblock: { name: 'T블록', kind: 'normal', parts: [{ box: [1.0, 0.25], at: [0, 0.35] }, { box: [0.25, 0.6], at: [0, -0.35] }] },
  // 특이한 모양
  hexagon: { name: '육각형', kind: 'odd', parts: [{ poly: ellipse(6, 0.65) }] },
  star: { name: '별', kind: 'odd', parts: starParts(0.95, 0.38) },
  stairs: { name: '계단', kind: 'odd', parts: [{ box: [0.9, 0.2], at: [0, -0.4] }, { box: [0.6, 0.2], at: [0.3, 0] }, { box: [0.3, 0.2], at: [0.6, 0.4] }] },
  cross: { name: '십자가', kind: 'odd', parts: [{ box: [0.9, 0.2] }, { box: [0.2, 0.9] }] },
  halfmoon: { name: '반달', kind: 'odd', parts: [{ poly: halfDisc(0.85, 8) }] },
  ushape: { name: 'U자', kind: 'odd', parts: [{ box: [0.9, 0.15], at: [0, -0.45] }, { box: [0.15, 0.45], at: [-0.75, 0] }, { box: [0.15, 0.45], at: [0.75, 0] }] },
  house: { name: '집', kind: 'odd', parts: [{ box: [0.6, 0.45], at: [0, -0.25] }, { poly: [[-0.8, 0.2], [0.8, 0.2], [0, 0.9]] }] },
  trapezoid: { name: '사다리꼴', kind: 'odd', parts: [{ poly: [[-1.0, -0.4], [1.0, -0.4], [0.55, 0.4], [-0.55, 0.4]] }] },
  bone: {
    name: '뼈다귀', kind: 'odd',
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
  bouncy: { name: '탱탱볼', kind: 'devil', parts: [{ circle: 0.45 }], props: { restitution: 0.85 }, look: { fill: '#ff5fa2', mark: '★' } },
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
const isDevil = s => SHAPES[s]?.kind === 'devil';

// 블록 맨 윗부분의 높이 (실제 모양과 회전을 반영)
function topOf(s, x, y, a) {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const wy = (lx, ly) => y + lx * sn + ly * c;
  let top = -Infinity;
  for (const part of SHAPES[s].parts) {
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
  const world = new World({ gravity: new Vec2(0, -10) });
  const ground = world.createBody();
  ground.createFixture(new Box(PLATFORM_W / 2, PLATFORM_H / 2, new Vec2(0, -PLATFORM_H / 2), 0), { friction: 0.9 });
  const sim = { world, bodies: new Map(), meta: new Map() };
  // 이어받은 탑은 잠든 상태로 복원해야 혼자 흔들리지 않는다
  for (const b of S.bodies || []) addBody(sim, b, false);
  return sim;
}

function addBody(sim, b, awake) {
  const { Vec2, Box, Circle, Polygon } = planck;
  const def = SHAPES[b.s];
  const props = def.props || {};
  const body = sim.world.createBody({ type: 'dynamic', position: new Vec2(b.x, b.y), angle: b.a, awake });
  for (const part of def.parts) {
    const [ax, ay] = part.at || [0, 0];
    let shape;
    if (part.box) shape = new Box(part.box[0], part.box[1], new Vec2(ax, ay), part.rot || 0);
    else if (part.circle) shape = new Circle(new Vec2(ax, ay), part.circle);
    else shape = new Polygon(part.poly.map(([x, y]) => new Vec2(x + ax, y + ay)));
    body.createFixture(shape, { density: props.density ?? 1, friction: props.friction ?? 0.7, restitution: props.restitution ?? 0.05 });
  }
  sim.bodies.set(b.id, body);
  sim.meta.set(b.id, { s: b.s, by: b.by });
  return body;
}

function snapshot(ctx) {
  const S = ctx.state;
  const sim = ctx.sim;
  let top = 0;
  S.bodies = [...sim.bodies].map(([id, body]) => {
    const p = body.getPosition();
    const a = body.getAngle();
    const m = sim.meta.get(id);
    top = Math.max(top, topOf(m.s, p.x, p.y, a));
    return { id, s: m.s, by: m.by, x: round3(p.x), y: round3(p.y), a: round3(a) };
  });
  S.top = round3(top);
}

const spawnY = S => (S.top || 0) + 3;

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

// 다음 사람 블록 정하기: 악마 카드를 썼으면 그 블록, 아니면 룰렛(완전 랜덤)
function startSpin(ctx, now, devil) {
  const S = ctx.state;
  S.phase = 'spin';
  S.spinKind = devil ? 'devil' : 'roulette';
  S.piece = devil || pick(ROULETTE);
  S.chooser = devil ? S.picker : null;
  S.spinEnd = now + SPIN_TIME;
  S.options = null;
  return true;
}

function startAim(ctx, now) {
  const S = ctx.state;
  S.phase = 'aim';
  S.turn = S.nextTurn;
  S.aim = { x: 0, a: 0 };
  S.phaseEndsAt = now + aimTime(S.lap);
  S.picker = null;
  S.gusted = null;
  return true;
}

function drop(ctx, now, aim) {
  const S = ctx.state;
  S.bodyNo = (S.bodyNo || 0) + 1;
  const id = `k${S.bodyNo}`;
  const x = Math.max(-X_LIMIT, Math.min(X_LIMIT, Number(aim?.x) || 0));
  const a = Number(aim?.a) || 0;
  addBody(ctx.sim, { id, s: S.piece, by: S.turn, x, y: spawnY(S), a }, true);
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
  for (let i = 0; i < steps; i++) sim.world.step(1 / 60, 8, 3);
  for (const [id, body] of [...sim.bodies]) {
    const p = body.getPosition();
    if (p.y > FALL_Y && Math.abs(p.x) < 14) continue;
    sim.world.destroyBody(body);
    sim.bodies.delete(id);
    sim.meta.delete(id);
    S.toppled = (S.toppled || 0) + 1;
  }
  snapshot(ctx);
  const moving = [...sim.bodies.values()].some(b => b.isAwake());
  if ((!moving && now - S.dropAt > 800) || now - S.dropAt > SETTLE_MAX) settle(ctx, now);
  return true;
}

function settle(ctx, now) {
  const S = ctx.state;
  const name = ctx.nameOf;
  const active = S.turn;
  S.turnsPlayed = (S.turnsPlayed || 0) + 1;
  if (S.toppled) {
    S.fails = [...(S.fails || []), { id: active, at: now, n: S.toppled }].slice(-8);
    if (S.alive.includes(active)) {
      S.alive = S.alive.filter(id => id !== active);
      S.outOrder = [...(S.outOrder || []), active];
      const killer = S.chooser && S.chooser !== active ? S.chooser : null;
      S.dead = { ...(S.dead || {}), [active]: killer || '-' };
      if (killer) {
        ctx.kill(killer, active, `😈 ${SHAPES[S.piece].name}`);
        S.kills = { ...(S.kills || {}), [killer]: (S.kills?.[killer] || 0) + 1 };
      } else {
        ctx.announce(`🎰 룰렛의 저주! ${name(active)} 탈락 (${SHAPES[S.piece].name} · 블록 ${S.toppled}개 추락)`);
      }
    }
  } else if (!S.best || S.top > S.best.h) {
    S.best = { id: active, h: S.top };
  }
  S.toppled = 0;
  S.pieceId = null;
  if (S.alive.length <= 1) return finish(ctx);
  // 방금 둔 사람(죽었어도 유령으로)에게 악마 카드가 남았으면 쓸지 고를 기회
  S.picker = active;
  S.nextTurn = nextInBag(S, active);
  if ((S.cards?.[active] || 0) > 0) {
    S.phase = 'devil';
    S.options = shuffle(DEVILS).slice(0, 3);
    S.phaseEndsAt = now + DEVIL_TIME;
    return true;
  }
  return startSpin(ctx, now, null);
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
  const def = SHAPES[s] || SHAPES.cube;
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
  const r = (SHAPES[s] || SHAPES.cube).r + 0.15;
  return svg('svg', { viewBox: `${-r} ${-r} ${2 * r} ${2 * r}`, class: 'tw-icon' },
    svg('g', { transform: 'scale(1,-1)' }, shapeGroup(s, color)));
}

export default {
  id: 'tower',
  title: '독박 타워',
  emoji: '🧱',
  tag: '우정파괴',
  color: '#e67e22',
  desc: '돌아가며 블록을 쌓아요. 블록은 🎰 룰렛! 한 판에 한 번 😈 악마 카드로 다음 사람에게 악마 블록을 줄 수 있어요. 떨어뜨리면 탈락!',
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
    if (type === 'devil' && S.phase === 'devil' && pid === S.picker && (S.cards?.[pid] || 0) > 0
        && Number.isInteger(data.i) && S.options?.[data.i]) {
      const shape = S.options[data.i];
      S.cards = { ...S.cards, [pid]: S.cards[pid] - 1 };
      S.cardUses = [...(S.cardUses || []), { by: pid, to: S.nextTurn, s: shape, at: now }].slice(-8);
      ctx.announce(`😈 ${josa(ctx.nameOf(pid), '이', '가')} ${ctx.nameOf(S.nextTurn)}에게 악마 카드! → ${SHAPES[shape].name}`);
      return startSpin(ctx, now, shape);
    }
    if (type === 'pass' && S.phase === 'devil' && pid === S.picker) return startSpin(ctx, now, null);
    if (type === 'gust' && S.phase === 'fall' && ctx.sim) {
      const ghost = S.roster.some(p => p.id === pid) && !S.alive.includes(pid);
      const piece = ctx.sim.bodies.get(S.pieceId);
      if (!ghost || !piece || S.gusted?.[pid] || now - S.dropAt > 2500) return false;
      const dir = data.dir < 0 ? -1 : 1;
      piece.applyLinearImpulse(new planck.Vec2(dir * GUST * piece.getMass() * 0.25, 0), piece.getWorldCenter(), true);
      S.gusted = { ...(S.gusted || {}), [pid]: true };
      S.gusts = [...(S.gusts || []), { by: pid, dir, at: now }].slice(-10);
      return true;
    }
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
      case 'intro':
        if (now < S.phaseEndsAt) return false;
        S.nextTurn = newBag(S, null);
        S.picker = null;
        return startSpin(ctx, now, null);
      case 'devil':
        if (now < S.phaseEndsAt && ctx.isOnline(S.picker)) return false;
        return startSpin(ctx, now, null);
      case 'spin':
        return now >= S.spinEnd && startAim(ctx, now);
      case 'aim':
        if (now < S.phaseEndsAt && ctx.isOnline(S.turn)) return false;
        return drop(ctx, now, S.aim);
      case 'fall':
        return stepFall(ctx, now);
      default:
        return false;
    }
  },

  // 봇: 탑 꼭대기 근처를 노려 천천히 조준하고 떨군다. 악마 카드는 탑이 높을수록·막판일수록 잘 씀. 유령이면 가끔 입김.
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'aim' && S.turn === id) {
      const key = `${S.turnsPlayed}`;
      if (mem.key !== key) {
        const topBody = [...(S.bodies || [])].sort((a, b) => b.y - a.y)[0];
        mem.key = key;
        mem.x = 0;
        mem.tx = Math.max(-2, Math.min(2, (topBody?.x || 0) + (Math.random() - 0.5) * 0.9));
        mem.ta = isDevil(S.piece) && Math.random() < 0.5 ? ROT_STEP * pick([-1, 1]) : 0;
        mem.dropAt = now + 1500 + Math.random() * 2500;
        mem.sent = 0;
      }
      if (now >= mem.dropAt) return { type: 'drop', data: { x: mem.tx, a: mem.ta }, say: Math.random() < 0.1 };
      if (now - mem.sent > 150) {
        mem.sent = now;
        mem.x += Math.sign(mem.tx - mem.x) * Math.min(0.5, Math.abs(mem.tx - mem.x));
        return { type: 'aim', data: { x: mem.x, a: mem.ta } };
      }
      return null;
    }
    if (S.phase === 'devil' && S.picker === id) {
      mem.decideAt ||= now + 800 + Math.random() * 1500;
      if (now < mem.decideAt) return null;
      mem.decideAt = 0;
      const chance = 0.25 + Math.min(0.4, (S.top || 0) * 0.06) + (S.alive.length <= 2 ? 0.3 : 0);
      if (Math.random() < chance) return { type: 'devil', data: { i: Math.floor(Math.random() * 3) }, say: Math.random() < 0.5 };
      return { type: 'pass' };
    }
    if (S.phase === 'fall' && !S.alive.includes(id) && !S.gusted?.[id] && now - S.dropAt > 250 && Math.random() < 0.04) {
      return { type: 'gust', data: { dir: pick([-1, 1]) } };
    }
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const top = h('div', { class: 'tw-top' });
    const bodiesG = svg('g');
    const previewG = svg('g', { class: 'tw-preview' });
    const platform = svg('g', {},
      svg('rect', { x: -PLATFORM_W / 2, y: -PLATFORM_H, width: PLATFORM_W, height: PLATFORM_H, rx: 0.08, fill: '#34495e', stroke: '#2c3e50', 'stroke-width': 0.08 }),
      svg('rect', { x: -0.35, y: -9, width: 0.7, height: 9 - PLATFORM_H, fill: '#34495e' }));
    const stage = svg('svg', { class: 'tw-svg', preserveAspectRatio: 'xMidYMax meet' },
      svg('g', { transform: 'scale(1,-1)' }, platform, bodiesG, previewG));
    const fx = h('div', { class: 'tw-fx' });
    const stageWrap = h('div', { class: 'tw-stage' }, stage, fx);
    const panel = h('div', { class: 'tw-panel' });
    const box = h('div', { class: 'tw-box' }, top, stageWrap, panel);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'tw' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    const shown = new Map(); // id → { el, from, to, t }
    let camTop = 9;
    let panelKey = '';
    let nav = null;
    let reelTimer = 0;
    let seenFail = null;
    let seenGust = null;
    let seenCard = null;
    let seenLap = null;
    // 내 차례일 때 조준 (내 화면에서 바로 움직이고, 방장에게는 가끔 알려 준다)
    const aim = { x: 0, a: 0, turnKey: '', dropped: false, sentAt: 0, sent: '' };
    const held = { left: false, right: false };
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const colorOf = id => who(id).color;
    const myTurn = () => S?.phase === 'aim' && S.turn === me;
    const isGhost = () => S.roster.some(p => p.id === me) && !S.alive.includes(me);
    const label = s => `${isDevil(s) ? '😈 ' : ''}${SHAPES[s]?.name || '?'}`;

    function onKey(e) {
      if (isTyping(e) || !S) return;
      const down = e.type === 'keydown';
      const c = e.code;
      // 악마 카드 고민 중: 스페이스 = 안 씀(룰렛). 숫자키는 keyNav가 받는다.
      if (down && c === 'Space' && S.phase === 'devil' && S.picker === me) {
        e.preventDefault();
        if (!e.repeat) api.send('pass');
        return;
      }
      if (c === 'ArrowLeft' || c === 'KeyA' || c === 'ArrowRight' || c === 'KeyD') {
        const left = c === 'ArrowLeft' || c === 'KeyA';
        if (myTurn()) {
          e.preventDefault();
          held[left ? 'left' : 'right'] = down;
          // 톡 치면 조금(미세 조정), 꾹 누르면 계속 이동
          if (down && !e.repeat && !aim.dropped) {
            aim.x = Math.max(-X_LIMIT, Math.min(X_LIMIT, aim.x + (left ? -0.25 : 0.25)));
            sendAim();
          }
        } else if (down && !e.repeat && S.phase === 'fall' && isGhost() && !S.gusted?.[me]) {
          e.preventDefault();
          api.send('gust', { dir: left ? -1 : 1 });
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
        let it = shown.get(b.id);
        if (!it) {
          const el = shapeGroup(b.s, colorOf(b.by));
          bodiesG.append(el);
          it = { el, from: b, to: b, t: now };
          shown.set(b.id, it);
        } else {
          it.from = current(it, now);
          it.to = b;
          it.t = now;
        }
      }
      for (const [id, it] of shown) {
        if (live.has(id)) continue;
        it.el.remove();
        shown.delete(id);
      }
    }

    function current(it, now) {
      const k = Math.min(1, (now - it.t) / 110);
      let da = it.to.a - it.from.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      return { x: it.from.x + (it.to.x - it.from.x) * k, y: it.from.y + (it.to.y - it.from.y) * k, a: it.from.a + da * k };
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
      // 조준 중인 블록 미리보기
      if (S.phase === 'aim') {
        const p = myTurn() ? aim : S.aim || { x: 0, a: 0 };
        const y = spawnY(S);
        if (previewG.dataset.key !== `${S.turnsPlayed}:${S.piece}`) {
          previewG.dataset.key = `${S.turnsPlayed}:${S.piece}`;
          previewG.replaceChildren(
            svg('line', { class: 'tw-guide', x1: 0, y1: 0, x2: 0, y2: -y - 1 }),
            shapeGroup(S.piece, colorOf(S.turn)));
        }
        previewG.style.display = '';
        previewG.setAttribute('transform', `translate(${p.x} ${y}) rotate(${(p.a * 180) / Math.PI})`);
      } else {
        previewG.style.display = 'none';
      }
      // 카메라: 탑이 높아지면 위로
      const want = Math.max(9, spawnY(S) + 2.5);
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
      if (seenLap !== null && S.lap > seenLap && S.lap > 1) flash(`🎲 ${S.lap}바퀴! 순서 다시 섞음`);
      seenLap = S.lap || 0;
      const fails = S.fails || [];
      const gusts = S.gusts || [];
      const cards = S.cardUses || [];
      if (seenFail === null) {
        seenFail = Math.max(0, ...fails.map(x => x.at));
        seenGust = Math.max(0, ...gusts.map(x => x.at));
        seenCard = Math.max(0, ...cards.map(x => x.at));
        return;
      }
      for (const f of fails) {
        if (f.at <= seenFail) continue;
        seenFail = f.at;
        flash(`💥 와르르! ${who(f.id).name} 탈락`, 'bad');
        shake();
      }
      for (const g of gusts) {
        if (g.at <= seenGust) continue;
        seenGust = g.at;
        flash(`👻 ${who(g.by).name}의 입김 ${g.dir < 0 ? '←' : '→'}`);
      }
      for (const u of cards) {
        if (u.at <= seenCard) continue;
        seenCard = u.at;
        flash(`😈 ${who(u.by).name}의 악마 카드 → ${who(u.to).name}`, 'bad');
        shake();
      }
    }

    function renderTop() {
      const bits = [h('span', {}, S.lap ? `${S.lap}바퀴` : '곧 시작'), h('span', {}, `높이 ${(S.top || 0).toFixed(1)}m`)];
      if (S.phase === 'aim') bits.push(countdown(S.phaseEndsAt, aimTime(S.lap)));
      if (S.phase === 'devil') bits.push(countdown(S.phaseEndsAt, DEVIL_TIME));
      top.replaceChildren(...bits);
    }

    // 룰렛: 블록 그림이 촤라락 바뀌다가 점점 느려지며 멈춘다
    function runReel(reel, name) {
      const pool = S.spinKind === 'devil' ? DEVILS : ROULETTE;
      const end = S.spinEnd;
      const final = S.piece;
      const color = colorOf(S.nextTurn);
      const step = () => {
        const now = api.now();
        if (now >= end) {
          reel.replaceChildren(shapeIcon(final, color));
          reel.classList.add('land');
          name.textContent = `${label(final)}!`;
          return;
        }
        reel.replaceChildren(shapeIcon(pick(pool), color));
        const k = Math.min(1, Math.max(0, 1 - (end - now) / SPIN_TIME));
        reelTimer = setTimeout(step, 45 + 260 * k * k);
      };
      step();
    }

    function panelView() {
      if (S.phase === 'intro') {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '🧱 독박 타워'),
          h('ul', { class: 'rules big' },
            h('li', {}, '돌아가며 받침대 위에 블록을 하나씩 쌓아요. 블록은 🎰 룰렛으로 랜덤!'),
            h('li', {}, `😈 악마 카드 ${DEVIL_CARDS}장: 내 차례가 끝나면 다음 사람에게 악마 블록을 줄 수 있어요 (그걸로 죽으면 내 킬)`),
            h('li', {}, '← → 이동 · ↑ ↓ 회전 · 스페이스 떨구기'),
            h('li', {}, '블록이 하나라도 떨어지면 놓은 사람 탈락'),
            h('li', {}, '순서는 바퀴마다 랜덤 · 바퀴마다 시간이 줄어요 · 탈락하면 👻 ← → 입김')),
          countdown(S.phaseEndsAt, INTRO_TIME));
      }
      if (S.phase === 'final') {
        const winner = who(S.placement?.[0]);
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, `👑 ${winner.name} 마지막 건축가!`), podium(S.roster, S.standings, me));
      }
      if (S.phase === 'devil') {
        const next = who(S.nextTurn);
        if (S.picker === me) {
          const btns = (S.options || []).map((s, i) => h('button', {
            class: 'tw-option devil', tabindex: '-1',
            onClick: () => { btns.forEach(b => { b.disabled = true; }); api.send('devil', { i }); },
          }, shapeIcon(s, next.color), h('b', {}, SHAPES[s].name)));
          nav = keyNav(btns, { space: false });
          return h('div', { class: 'bt-act' },
            h('div', { class: 'bt-act-title hot' }, `😈 ${next.name}한테 악마 카드 쓸래?`),
            h('div', { class: 'tw-options' }, btns),
            h('p', { class: 'muted' }, `숫자키 1·2·3 = 이걸로 저주 · 스페이스 = 안 씀 (룰렛) · 남은 카드 ${S.cards?.[me] || 0}장`));
        }
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `😈 ${josa(who(S.picker).name, '이', '가')} 악마 카드 고민 중…`),
          h('p', {}, S.nextTurn === me ? '😰 다음은 내 차례… 제발 쓰지 마' : `다음: ${next.name}`));
      }
      if (S.phase === 'spin') {
        const reel = h('div', { class: `tw-reel${S.spinKind === 'devil' ? ' devil' : ''}` });
        const name = h('div', { class: 'tw-reel-name' });
        const head = S.spinKind === 'devil' ? `😈 ${who(S.chooser).name}의 악마 카드!` : '🎰 룰렛!';
        queueMicrotask(() => runReel(reel, name));
        return h('div', { class: 'bt-act' },
          h('div', { class: `bt-act-title${S.spinKind === 'devil' ? ' hot' : ''}` }, head),
          reel, name,
          h('p', { class: 'muted' }, S.nextTurn === me ? '내가 놓을 블록!' : `${josa(who(S.nextTurn).name, '이', '가')} 놓을 블록`));
      }
      if (S.phase === 'aim') {
        const from = S.chooser ? `${who(S.chooser).name}의 악마 카드: ` : '🎰 ';
        if (S.turn === me) {
          if (aim.dropped) return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '떨궜다! 🙏'));
          return h('div', { class: 'bt-act' },
            h('div', { class: 'bt-act-title hot' }, `내 차례! ${from}${label(S.piece)}`),
            h('p', {}, '← → 이동 · ↑ ↓ 회전 · 스페이스 떨구기'));
        }
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `${who(S.turn).name} 차례`),
          h('p', {}, `${from}${label(S.piece)} 놓는 중…`));
      }
      if (S.phase === 'fall') {
        if (isGhost() && !S.gusted?.[me]) {
          return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '👻 지금이야!'), h('p', {}, '← 또는 → 로 입김 한 번 (떨어지는 블록을 밀어요)'));
        }
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '떨어지는 중… 😬'));
      }
      return h('div');
    }

    function renderPanel() {
      const key = [S.phase, S.turnsPlayed, S.turn, S.picker, S.spinEnd, aim.dropped, S.gusted?.[me] ? 'g' : ''].join('|');
      if (key === panelKey) return;
      panelKey = key;
      nav?.destroy();
      nav = null;
      clearTimeout(reelTimer);
      panel.replaceChildren(panelView());
    }

    function renderSide() {
      const deadList = (S.outOrder || []).map(id => {
        const by = S.dead?.[id];
        return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${who(by).name}의 😈` : ' 🎰 룰렛');
      });
      // 이번 바퀴 순서 (가방): 끝난 사람 / 지금 / 남은 사람 / 탈락. 😈 = 악마 카드 남음
      const next = S.phase === 'devil' || S.phase === 'spin';
      const current = next ? S.nextTurn : S.phase === 'aim' || S.phase === 'fall' ? S.turn : null;
      const bag = (S.bag || []).map((id, i) => {
        const dead = !S.alive.includes(id);
        const cls = dead ? 'dead' : id === current ? 'now' : i < (S.bagPos ?? 0) ? 'done' : '';
        return h('li', { class: cls }, avatar(who(id)), h('span', {}, who(id).name),
          (S.cards?.[id] || 0) > 0 ? h('i', { class: 'tw-card', title: '악마 카드 남음' }, '😈') : null,
          cls === 'now' ? h('em', {}, next ? '다음' : '차례') : cls === 'done' ? h('em', {}, '✓') : null);
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
          h('li', {}, '← → (A D) 이동'),
          h('li', {}, '↑ ↓ (W S) 15° 회전'),
          h('li', {}, '스페이스 떨구기'),
          h('li', {}, '😈 악마 카드: 숫자키 1·2·3, 안 쓰면 스페이스'),
          h('li', {}, '유령: 떨어질 때 ← → 입김')),
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
        renderPanel();
        renderSide();
      },
      unmount() {
        cancelAnimationFrame(raf);
        clearTimeout(reelTimer);
        nav?.destroy();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
      },
    };
  },
};
