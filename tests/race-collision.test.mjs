import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, newCar, pointAt, locate, drive, stepCar, SURF, KART, PHYS, resolveKartContacts } from '../js/games/race-core.js';

const T = buildTrack(true);
const dt = 1 / 60;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
function at(s, lat = 0, speed = 0) {
  const p = pointAt(T.main, s);
  return { ...newCar(T), x: p.x - p.ty * lat, y: p.y + p.tx * lat, seg: p.i, s, ms: s,
    vx: p.tx * speed, vy: p.ty * speed, hx: p.tx, hy: p.ty };
}

test('카트 최고 속도는 28, 부스트는 38이며 직선 입력으로 속도가 요동하지 않는다', () => {
  const car = { vx: 0, vy: 0, hx: 1, hy: 0 };
  const speeds = [];
  for (let i = 0; i < 240; i++) {
    drive(car, { throttle: 1 }, SURF.asphalt, dt);
    speeds.push(Math.hypot(car.vx, car.vy));
  }
  assert.ok(speeds[29] > 12 && speeds[29] < 15);
  assert.ok(speeds[59] > 24 && speeds[59] < KART.max);
  close(speeds[119], KART.max);
  assert.ok(speeds.every((v, i) => i === 0 || v >= speeds[i - 1] - 1e-8));
  car.boostLeft = 1;
  for (let i = 0; i < 30; i++) drive(car, { throttle: 1 }, SURF.asphalt, dt);
  close(car.vx, KART.boost);
  car.boostLeft = 0;
  drive(car, { throttle: 1 }, SURF.asphalt, dt);
  assert.ok(car.vx > 37 && car.vx < KART.boost, '부스트가 끝나도 속도는 부드럽게 내려간다');
  for (let i = 0; i < 60; i++) drive(car, { throttle: 1 }, SURF.asphalt, dt);
  close(car.vx, KART.max);
});

test('가속에는 점진적인 추진력이 있고 두 페달을 함께 누르면 제동만 한다', () => {
  const fresh = { vx: 10, vy: 0, hx: 1, hy: 0 };
  const warmed = { ...fresh, throttleTime: KART.thrustTime };
  drive(fresh, { throttle: 1 }, SURF.asphalt, dt);
  drive(warmed, { throttle: 1 }, SURF.asphalt, dt);
  assert.ok(warmed.vx - 10 > (fresh.vx - 10) * 1.5);
  const car = { vx: KART.max, vy: 0, hx: 1, hy: 0 };
  for (let i = 0; i < 24; i++) drive(car, { brake: true }, SURF.asphalt, dt);
  assert.ok(car.vx > 0 && car.vx < 8, `제동 후 ${car.vx}`);
  close(car.hx, 1);
  for (let i = 0; i < 120; i++) drive(car, { throttle: 1, brake: true }, SURF.asphalt, dt);
  close(car.vx, 0); close(car.vy, 0);
  close(PHYS.max, 21);
});

test('조향하며 드리프트하면 충전되고 놓으면 부스트, 직선에서는 충전되지 않는다', () => {
  const car = { vx: KART.max, vy: 0, hx: 1, hy: 0 };
  for (let i = 0; i < 120; i++) drive(car, { throttle: 1, drift: true }, SURF.asphalt, dt);
  close(car.charge, 0);
  for (let i = 0; i < 150; i++) drive(car, { throttle: 1, steer: 0.7, drift: true }, SURF.asphalt, dt);
  assert.ok(car.charge >= 1.15);
  drive(car, { throttle: 1, steer: 0.7 }, SURF.asphalt, dt);
  assert.ok(car.boostLeft > 1);
});

test('뒤에서 박으면 앞차를 밀고 뒤차는 감속한다. 운동량은 보존되고 반복 접촉이 가속을 만들지 않는다', () => {
  const a = at(12, 0, 28);
  const b = at(13.4, 0, 10);
  const before = { vx: a.vx + b.vx, vy: a.vy + b.vy };
  const energy = a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2;
  const hits = resolveKartContacts(T, [{ id: 'a', car: a }, { id: 'b', car: b }]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].a, 'a');
  assert.equal(hits[0].b, 'b');
  assert.ok(hits[0].strength > 17);
  assert.ok(Math.hypot(a.vx, a.vy) < 28);
  assert.ok(Math.hypot(b.vx, b.vy) > 10);
  close(a.vx + b.vx, before.vx);
  close(a.vy + b.vy, before.vy);
  assert.ok(a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2 < energy);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= KART.radius * 2 - 0.01);
  const resolved = [a.vx, a.vy, b.vx, b.vy];
  for (let i = 0; i < 20; i++) assert.deepEqual(resolveKartContacts(T, [{ id: 'a', car: a }, { id: 'b', car: b }]), []);
  assert.deepEqual([a.vx, a.vy, b.vx, b.vy], resolved);
});

test('이미 벌어지는 차량은 위치만 분리하고 공중·복귀·완주 차량은 충돌하지 않는다', () => {
  const a = at(12, 0, 10);
  const b = at(13, 0, 20);
  const speeds = [a.vx, a.vy, b.vx, b.vy];
  assert.deepEqual(resolveKartContacts(T, [{ id: 'a', car: a }, { id: 'b', car: b }]), []);
  assert.deepEqual([a.vx, a.vy, b.vx, b.vy], speeds);
  for (const flag of ['air', 'sp', 'fin']) {
    const c = at(12, 0, 28);
    const d = at(13, 0, 0);
    d[flag] = 1000;
    const original = structuredClone([c, d]);
    assert.deepEqual(resolveKartContacts(T, [{ id: 'c', car: c }, { id: 'd', car: d }]), []);
    assert.deepEqual([c, d], original);
  }
});

test('8자 교차의 위층과 아래층은 같은 좌표에서도 부딪히지 않는다', () => {
  const under = T.main.pts.findIndex(p => p.sec === 0 && Math.hypot(p.x - T.cross.x, p.y - T.cross.y) < 1.2);
  const over = T.main.pts.findIndex(p => p.sec === 4 && Math.hypot(p.x - T.cross.x, p.y - T.cross.y) < 1.2);
  const a = { ...newCar(T), x: T.cross.x, y: T.cross.y, seg: under, vx: 20, vy: 0 };
  const b = { ...newCar(T), x: T.cross.x, y: T.cross.y, seg: over, vx: -20, vy: 0 };
  assert.notEqual(locate(T, a, a.x, a.y).p.layer, locate(T, b, b.x, b.y).p.layer);
  const before = structuredClone([a, b]);
  assert.deepEqual(resolveKartContacts(T, [{ id: 'a', car: a }, { id: 'b', car: b }]), []);
  assert.deepEqual([a, b], before);
});

test('벽 옆 충돌은 차체를 난간 안에 두고 최종 도로 위치도 동기화한다', () => {
  const p = pointAt(T.main, 12);
  const a = at(12, p.half - KART.radius - 0.8);
  const b = at(12, p.half - KART.radius - 0.05);
  a.vx = -p.ty * 20;
  a.vy = p.tx * 20;
  const hits = resolveKartContacts(T, [{ id: 'a', car: a }, { id: 'b', car: b }]);
  assert.ok(hits.length);
  for (const car of [a, b]) {
    const loc = locate(T, car, car.x, car.y);
    assert.ok(Math.abs(loc.lat) <= loc.p.half - KART.radius + 0.005);
    close(car.ms, loc.ms);
    close(car.lat, loc.lat);
    assert.equal(car.seg, loc.seg);
  }
});

test('60Hz 최고 부스트 속도의 정면 충돌은 서로 통과하지 않는다', () => {
  const a = at(12, 0, KART.boost);
  const b = at(14.5, 0, -KART.boost);
  a.boostLeft = 2;
  b.boostLeft = 2;
  const inputA = { throttle: 1 };
  const inputB = { throttle: 1 };
  b.hx *= -1; b.hy *= -1;
  let collided = false;
  for (let i = 1; i <= 10; i++) {
    stepCar(T, a, inputA, dt, i * 1000 / 60);
    stepCar(T, b, inputB, dt, i * 1000 / 60);
    const hits = resolveKartContacts(T, [{ id: 'a', car: a }, { id: 'b', car: b }]);
    if (hits.length) { collided = true; break; }
  }
  assert.ok(collided);
  const p = pointAt(T.main, 12);
  assert.ok((b.x - a.x) * p.tx + (b.y - a.y) * p.ty > 0);
});

test('눈에 보이는 범퍼와 타이어 가장자리에서 접촉한다. 차체 방향도 판정에 반영한다', () => {
  for (const angle of [-Math.PI / 4, 0, Math.PI / 4, Math.PI / 2]) {
    const a = at(12);
    a.hx = Math.cos(angle); a.hy = Math.sin(angle);
    const b = { ...a, x: a.x + a.hx * 2.3, y: a.y + a.hy * 2.3 };
    a.vx = a.hx * 20; a.vy = a.hy * 20;
    const hits = resolveKartContacts(T, [{ id: 'a', car: a }, { id: 'b', car: b }]);
    assert.equal(hits.length, 1, `방향 ${angle}의 앞 범퍼`);
  }
  const a = at(12);
  const b = at(12, 2);
  a.vx = -a.hy * 20; a.vy = a.hx * 20;
  assert.equal(resolveKartContacts(T, [{ id: 'a', car: a }, { id: 'b', car: b }]).length, 1, '바퀴 옆면');
});

test('최고속도로 비스듬히 스치는 접촉도 이전 위치를 주면 걸음 사이에서 검출한다', () => {
  const p = pointAt(T.main, 12);
  const halfTravel = KART.boost * dt * 0.5;
  const a = at(12, halfTravel);
  const b = at(14.64, -halfTravel);
  a.vx = -p.ty * KART.boost; a.vy = p.tx * KART.boost;
  b.vx = p.ty * KART.boost; b.vy = -p.tx * KART.boost;
  const pa = at(12, -halfTravel);
  const pb = at(14.64, halfTravel);
  const miss = resolveKartContacts(T, [{ id: 'a', car: { ...a } }, { id: 'b', car: { ...b } }]);
  assert.equal(miss.length, 0, '현재 위치만 보면 이미 지나친 접촉');
  const hits = resolveKartContacts(T, [{ id: 'a', car: a, prev: pa }, { id: 'b', car: b, prev: pb }], dt);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].strength > 10);
  assert.ok(a.vx * -p.ty + a.vy * p.tx < KART.boost, '충돌한 차는 옆 방향 속도를 잃는다');
  assert.ok([a.x, a.y, b.x, b.y].every(Number.isFinite));
});

test('좌우를 번갈아 눌러도 운전대는 중앙을 통과하고 회전 속도가 튀지 않는다', () => {
  const car = { vx: KART.max, vy: 0, hx: 1, hy: 0, steerInput: 0, steer: 0, yawRate: 0 };
  let previousInput = 0;
  let previousSteer = 0;
  let previousYaw = 0;
  for (let i = 0; i < 180; i++) {
    const steering = i < 60 ? 1 : i < 120 ? -1 : 0;
    const hx = car.hx;
    const hy = car.hy;
    drive(car, { throttle: 1, steer: steering }, SURF.asphalt, dt);
    const turn = Math.atan2(hx * car.hy - hy * car.hx, hx * car.hx + hy * car.hy);
    const steerRate = steering === 0 ? KART.steerReturn : steering * previousInput < 0 ? KART.steerOpposite : KART.steerInputSlew;
    assert.ok(Math.abs(car.steerInput - previousInput) <= steerRate * dt + 1e-8);
    assert.ok(Math.abs(car.steer - previousSteer) <= KART.steerSlew * dt + 1e-8);
    assert.ok(Math.abs(car.yawRate - previousYaw) <= KART.yawAccel * dt + 1e-8);
    assert.ok(Math.abs(turn) < 0.04, '한 걸음에 차체 방향이 튀지 않는다');
    if (i === 60) assert.ok(car.steerInput > 0.9 && car.yawRate > 0, '왼쪽 키를 눌러도 즉시 반대로 꺾이지 않는다');
    if (i === 71) assert.ok(car.steerInput < 0, '반대 입력은 중앙을 지나 부드럽게 바뀐다');
    previousInput = car.steerInput; previousSteer = car.steer; previousYaw = car.yawRate;
  }
  close(car.steerInput, 0);
  close(car.steer, 0);
  close(car.yawRate, 0);
});

test('조향만으로는 가속하거나 제자리 회전하지 않고 가속은 차체 앞쪽으로만 작용한다', () => {
  const car = { vx: 0, vy: 0, hx: 0, hy: 1 };
  for (let i = 0; i < 180; i++) drive(car, { steer: 1 }, SURF.asphalt, dt);
  close(car.vx, 0); close(car.vy, 0); close(car.hx, 0); close(car.hy, 1);
  drive(car, { throttle: 1 }, SURF.asphalt, dt);
  close(car.vx, 0);
  assert.ok(car.vy > 0);
  const coasting = { vx: 20, vy: 0, hx: 1, hy: 0 };
  for (let i = 0; i < 60; i++) drive(coasting, { steer: 1 }, SURF.asphalt, dt);
  assert.ok(Math.atan2(coasting.hy, coasting.hx) > 0.6, '가속 페달을 떼도 굴러가며 조향한다');
  assert.ok(Math.hypot(coasting.vx, coasting.vy) < 20);
});

test('8대가 같은 출발선에 카트 폭보다 넓은 간격으로 설 수 있다', () => {
  const p = pointAt(T.main, T.start);
  const spacing = 2.15;
  assert.ok(p.half >= spacing * 3.5 + KART.radius, `시작 구간 반폭 ${p.half}`);
  const cars = Array.from({ length: 8 }, (_, i) => ({ id: String(i), car: at(T.start, (i - 3.5) * spacing) }));
  const before = structuredClone(cars);
  assert.deepEqual(resolveKartContacts(T, cars), []);
  assert.deepEqual(cars, before);
});

test('가로로 선 카트의 앞 범퍼도 난간을 뚫지 않는다', () => {
  const p = pointAt(T.main, 12);
  const car = at(12, p.half - KART.radius);
  car.hx = -p.ty; car.hy = p.tx;
  stepCar(T, car, null, dt, 1000);
  const loc = locate(T, car, car.x, car.y);
  assert.ok(loc.lat + KART.radius + KART.capsuleFront <= loc.p.half + 0.005);
});

test('S를 유지하면 완전히 멈춘 뒤 잠깐 기다렸다가 낮은 속도로 후진한다', () => {
  const car = { vx: 20, vy: 0, hx: 1, hy: 0 };
  let stopped = false;
  let firstReverse = null;
  let stoppedAt = null;
  for (let i = 1; i <= 180; i++) {
    drive(car, { brake: true }, SURF.asphalt, dt);
    if (Math.abs(car.vx) < 1e-9 && !stopped) { stopped = true; stoppedAt = i * dt; }
    if (car.vx < 0 && firstReverse === null) {
      assert.ok(stopped, '후진 전에 정지한 걸음이 있다');
      firstReverse = i * dt;
    }
  }
  assert.ok(firstReverse - stoppedAt >= KART.reverseDelay - dt - 1e-8);
  close(car.vx, -KART.reverseMax);
  close(car.vy, 0);
  assert.ok(car.reverseHold >= KART.reverseDelay);
});

test('후진 중 W를 누르면 제동해 정지한 다음 전진하며 페달을 떼면 후진 대기가 초기화된다', () => {
  const car = { vx: -KART.reverseMax, vy: 0, hx: 1, hy: 0, reverseHold: KART.reverseDelay };
  let stopped = false;
  let forward = false;
  for (let i = 0; i < 90; i++) {
    const before = car.vx;
    drive(car, { throttle: 1 }, SURF.asphalt, dt);
    if (car.vx === 0) stopped = true;
    if (car.vx > 0) { assert.ok(stopped); forward = true; }
    if (before < 0) assert.ok(car.vx <= 0, '한 걸음에 후진에서 전진으로 튀지 않는다');
  }
  assert.ok(forward);
  assert.ok(car.vx > 20);
  close(car.reverseHold, 0);
  const waiting = { vx: 0, vy: 0, hx: 1, hy: 0 };
  for (let i = 0; i < 5; i++) drive(waiting, { brake: true }, SURF.asphalt, dt);
  assert.ok(waiting.reverseHold > 0);
  drive(waiting, null, SURF.asphalt, dt);
  close(waiting.reverseHold, 0);
});

test('같은 운전대 입력의 차체 회전은 후진에서 반대로 작동한다', () => {
  const forward = { vx: 6, vy: 0, hx: 1, hy: 0 };
  const reverse = { vx: -6, vy: 0, hx: 1, hy: 0 };
  for (let i = 0; i < 45; i++) {
    drive(forward, { steer: 1 }, SURF.asphalt, dt);
    drive(reverse, { steer: 1 }, SURF.asphalt, dt);
  }
  assert.ok(forward.hy > 0.2);
  assert.ok(reverse.hy < -0.2);
  close(forward.hx, reverse.hx);
  close(forward.hy, -reverse.hy);
});

test('운전대 반응은 더 빠르지만 매 걸음 연속이고 고속에서도 작은 입력을 조절할 수 있다', () => {
  const car = { vx: KART.max, vy: 0, hx: 1, hy: 0 };
  let fullAt = null;
  for (let i = 1; i <= 30; i++) {
    drive(car, { throttle: 1, steer: 1 }, SURF.asphalt, dt);
    if (car.steerInput >= 1 - 1e-9 && fullAt === null) fullAt = i * dt;
  }
  assert.ok(fullAt <= 0.28 && fullAt >= 0.25, `끝까지 돌리는 시간 ${fullAt}`);
  let centeredAt = null;
  let oppositeAt = null;
  for (let i = 1; i <= 60; i++) {
    drive(car, { throttle: 1, steer: -1 }, SURF.asphalt, dt);
    if (car.steerInput <= 0 && centeredAt === null) centeredAt = i * dt;
    if (car.steerInput <= -1 + 1e-9 && oppositeAt === null) oppositeAt = i * dt;
  }
  assert.ok(centeredAt < 0.2, `반대로 돌려 중앙 통과 ${centeredAt}`);
  assert.ok(oppositeAt < 0.48, `반대 끝까지 ${oppositeAt}`);
  const wheelAtMax = KART.steerMax / (1 + KART.max * KART.steerSpeed);
  assert.ok(wheelAtMax > 0.17 && wheelAtMax < 0.18);
});
