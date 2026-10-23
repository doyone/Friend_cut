// 하늘끝까지의 탑 물리: 각자 노트북이 자기 탑을, 방장이 봇 탑을 같은 코드로 돌린다 (planck.js).
// 짐은 독박 시소 물건 그대로(모양·무게·그림). 받침대 위에 계속 떨궈서 높이 쌓는다.
// 좌표: 위가 +y, 받침대 윗면이 y = 0.
import { KINDS, ROULETTE, extent } from './seesaw.js';

export const GOAL = 10;          // 하늘 끝 (m)
export const SPACE_Y = 7;        // 이 위는 우주: 중력 절반
export const PLATFORM_W = 6;     // 받침대 폭
export const X_LIMIT = 3.8;      // 조준 좌우 한계
export const DROP_GAP = 0.5;     // 떨굴 때 짐 맨 아래가 그 자리 꼭대기보다 이만큼 위 (살살 내려놓기)
const GRAVITY = 12;
const CHUTE_DAMP = 4;            // 보급 상자: 공중에서 낙하산
const FALL_Y = -4;               // 이 아래로 떨어진 짐은 없앤다
// 아래층은 굳는다: 꼭대기에서 이만큼 아래에 있고 자리 잡은 짐은 움직이지 않게 (위쪽만 와르르, 탑 전체가 무너지진 않게).
// 봇 시험(1분 30초): 굳기 없으면 5~7m, 1m로 굳히면 9~10m
export const FREEZE_DEPTH = 1;
export const STEP = 1 / 60;

// 상태로 보낼 때 짐 이름 대신 번호로 (짧게)
export const KEYS = Object.keys(KINDS);
// 😈 택배로 보내는 짐: 굴러가거나 미끄러지거나 꼭대기가 뾰족하거나 어색한 것 (쌓기 게임이라 룰렛에선 뺀다)
export const PARCELS = ['bowling', 'melon', 'tire', 'gymball', 'cart', 'cone', 'ice', 'anchor'];
// 룰렛: 시소 룰렛에서 카드 짐(악마의 선물)과 택배 짐을 뺀다
export const POOL = ROULETTE.filter(r => r.k !== 'gift' && !PARCELS.includes(r.k));

const r2 = v => Math.round(v * 100) / 100;

// 모두가 같은 순서로 받는 짐 목록 (방금 짐은 다시 안 나옴)
export function makeSeq(n, rand = Math.random) {
  const seq = [];
  const total = POOL.reduce((s, p) => s + p.w, 0);
  while (seq.length < n) {
    let r = rand() * total;
    let k = POOL[POOL.length - 1].k;
    for (const p of POOL) if ((r -= p.w) <= 0) { k = p.k; break; }
    if (k !== seq[seq.length - 1]) seq.push(k);
  }
  return seq;
}

export function makeTower(planck) {
  const { World, Vec2, Box } = planck;
  const world = new World({ gravity: new Vec2(0, -GRAVITY) });
  const ground = world.createBody();
  ground.createFixture(new Box(PLATFORM_W / 2, 0.3, new Vec2(0, -0.3), 0), { friction: 0.9 });
  return { planck, world, ground, items: new Map(), chutes: new Set(), fell: 0, no: 0, ticks: 0 };
}

// 짐 하나 (부품마다 밀도·마찰·반발이 다를 수 있다: 독박 시소와 같은 방식)
export function addItem(T, k, x, y, a, awake = true) {
  const { Vec2, Box, Circle, Polygon } = T.planck;
  const def = KINDS[k];
  const chute = !!def.chute && awake;
  const body = T.world.createBody({
    type: 'dynamic', position: new Vec2(x, y), angle: a, awake,
    angularDamping: def.rolling || 0, linearDamping: chute ? CHUTE_DAMP : def.linDamp || 0,
  });
  for (const part of def.parts) {
    const [ax, ay] = part.at || [0, 0];
    const shape = part.box ? new Box(part.box[0], part.box[1], new Vec2(ax, ay), 0)
      : part.circle ? new Circle(new Vec2(ax, ay), part.circle)
        : new Polygon(part.poly.map(([px, py]) => new Vec2(px + ax, py + ay)));
    body.createFixture(shape, {
      density: part.density ?? def.density, friction: part.friction ?? def.friction, restitution: part.restitution ?? def.restitution ?? 0,
    });
  }
  const id = ++T.no;
  T.items.set(id, { body, k });
  if (chute) T.chutes.add(id);
  return id;
}

function touching(body) {
  for (let ce = body.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) return true;
  return false;
}

// 한 걸음: 우주(10m 위)에선 중력 절반, 낙하산은 처음 닿으면 접힘, 받침대 밖으로 떨어진 건 없앤다
export function stepTower(T, dt = STEP) {
  for (const { body } of T.items.values()) {
    if (!body.isAwake()) continue;
    const g = body.getPosition().y > SPACE_Y ? 0.5 : 1;
    if (body.getGravityScale() !== g) body.setGravityScale(g);
  }
  T.world.step(dt, 8, 3);
  if (++T.ticks % 30 === 0) freezeLow(T);
  for (const id of T.chutes) {
    const it = T.items.get(id);
    if (it && !touching(it.body)) continue;
    if (it) it.body.setLinearDamping(KINDS[it.k].linDamp || 0);
    T.chutes.delete(id);
  }
  for (const [id, { body }] of T.items) {
    if (body.getPosition().y > FALL_Y) continue;
    T.world.destroyBody(body);
    T.items.delete(id);
    T.chutes.delete(id);
    T.fell++;
  }
}

const topOf = (k, body) => body.getPosition().y + extent(k, body.getAngle()).hi[1];
const settledBody = body => !body.isAwake() || (body.getLinearVelocity().length() < 0.25 && Math.abs(body.getAngularVelocity()) < 0.4 && touching(body));

// 굳히기: 0.5초에 한 번, 지금 높이보다 FREEZE_DEPTH 아래에 꼭대기가 있는 자리 잡은 짐을 고정
function freezeLow(T) {
  const h = heightOf(T);
  for (const it of T.items.values()) {
    if (it.frozen || !settledBody(it.body) || topOf(it.k, it.body) > h - FREEZE_DEPTH) continue;
    it.body.setLinearVelocity(T.planck.Vec2(0, 0));
    it.body.setAngularVelocity(0);
    it.body.setStatic();
    it.frozen = true;
  }
}

// 지금 높이: 자리 잡은 짐(느리고 뭔가에 닿아 있는 것)의 맨 꼭대기. 떨어지는 중인 짐은 안 센다
export function heightOf(T) {
  let top = 0;
  for (const { body, k, frozen } of T.items.values()) if (frozen || settledBody(body)) top = Math.max(top, topOf(k, body));
  return top;
}

// 떨굴 때 짐 중심 높이: 짐 맨 아래가 그 자리(짐 폭만큼) 가장 높은 곳 + DROP_GAP
export function spawnY(T, k, x, a) {
  const e = extent(k, a);
  const l = x + e.lo[0];
  const r = x + e.hi[0];
  let top = 0;
  for (const { body, k: bk } of T.items.values()) {
    const p = body.getPosition();
    const be = extent(bk, body.getAngle());
    if (p.x + be.lo[0] < r + 0.1 && p.x + be.hi[0] > l - 0.1) top = Math.max(top, p.y + be.hi[1]);
  }
  return top + DROP_GAP - e.lo[1];
}

export function dropItem(T, k, x, a) {
  const cx = Math.max(-X_LIMIT, Math.min(X_LIMIT, x));
  return addItem(T, k, cx, spawnY(T, k, cx, a), a);
}

// 다른 사람 화면에 그릴 요약: [짐 번호, x, y, 각도, 굳음(1/0)]
export const snapTower = T => [...T.items.values()].map(({ body, k, frozen }) => {
  const p = body.getPosition();
  return [KEYS.indexOf(k), r2(p.x), r2(p.y), r2(body.getAngle()), frozen ? 1 : 0];
});

// 새로 고침 뒤 이어서: 요약에서 잠든 채로 다시 세운다 (굳은 건 굳은 채로)
export function restoreTower(T, list) {
  for (const [ki, x, y, a, f] of list || []) {
    if (!KEYS[ki]) continue;
    const it = T.items.get(addItem(T, KEYS[ki], x, y, a, false));
    if (f) {
      it.body.setStatic();
      it.frozen = true;
    }
  }
}

// 봇: 가운데 2.4m 기둥 안에서 발 디딜 곳이 가장 낮은 자리(움푹한 데 채우기)에 납작하게. err = 빗나가는 정도(m)
export function botAim(T, k, err = 0.3, rand = Math.random) {
  const h = a => extent(k, a).hi[1] - extent(k, a).lo[1];
  const a = h(Math.PI / 2) < h(0) ? Math.PI / 2 : 0;
  let bx = 0;
  let bt = Infinity;
  for (let x = -1.2; x <= 1.2001; x += 0.2) {
    const t = spawnY(T, k, x, a) + Math.abs(x) * 0.05;
    if (t < bt) {
      bt = t;
      bx = x;
    }
  }
  return { x: Math.max(-X_LIMIT, Math.min(X_LIMIT, bx + (rand() - 0.5) * 2 * err)), a };
}
