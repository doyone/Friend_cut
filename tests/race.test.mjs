import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, newCar, stepCar, locate, pointAt, LAPS } from '../js/games/race-core.js';
import game from '../js/games/race.js';

const T = buildTrack();

test('트랙: 한 바퀴 약 600m, 지름길 다리가 눈길보다 짧고, 8자 교차에서 다른 층을 잡지 않음', () => {
  assert.ok(T.main.len > 550 && T.main.len < 750, `한 바퀴 ${T.main.len}`);
  assert.ok(T.branch.len < T.branch.to - T.branch.from);
  // 출발 직선(아래층)의 교차점에서 찾으면 아래층, 고가 다리(위층)에서 찾으면 위층
  const under = T.main.pts.find(p => p.sec === 0 && Math.hypot(p.x - T.cross.x, p.y - T.cross.y) < 1.2);
  const over = T.main.pts.find(p => p.sec === 4 && Math.hypot(p.x - T.cross.x, p.y - T.cross.y) < 1.2);
  assert.ok(under && over);
  const i0 = T.main.pts.indexOf(under);
  const i1 = T.main.pts.indexOf(over);
  assert.equal(T.main.pts[locate(T, { path: 'main', seg: i0 }, T.cross.x, T.cross.y).seg].sec, 0);
  assert.equal(T.main.pts[locate(T, { path: 'main', seg: i1 }, T.cross.x, T.cross.y).seg].layer, 1);
});

test('물리: 길 밖(물)으로 나가면 풍덩, 1.2초 뒤 다시 섬', () => {
  const car = newCar(T);
  const p = pointAt(T.main, 60);
  Object.assign(car, { x: p.x, y: p.y, seg: p.i, s: 60, ms: 60 });
  let t = 0;
  let ev = [];
  for (let i = 0; i < 120 && !ev.includes('splash'); i++) {
    t += 1000 / 60;
    ev = stepCar(T, car, { x: -p.ty, y: p.tx }, 1 / 60, t); // 옆으로 계속
  }
  assert.ok(ev.includes('splash'));
  let back = [];
  for (let i = 0; i < 90 && !back.includes('respawn'); i++) {
    t += 1000 / 60;
    back = stepCar(T, car, null, 1 / 60, t);
  }
  assert.ok(back.includes('respawn'));
  assert.ok(Math.abs(locate(T, car, car.x, car.y).lat) < 0.5, '가운데 선에서 다시 섬');
});

test('물리: 점프대는 빠르면 건너고 느리면 빠짐', () => {
  for (const [speed, want] of [[18, 'land'], [8, 'splash']]) {
    const car = newCar(T);
    const p = pointAt(T.main, T.jump.ramp - 6);
    Object.assign(car, { x: p.x, y: p.y, seg: p.i, s: p.s, ms: p.s, vx: p.tx * speed, vy: p.ty * speed });
    const seen = [];
    let t = 0;
    for (let i = 0; i < 120; i++) {
      t += 1000 / 60;
      // 빠른 차는 앞으로 계속 밀고, 느린 차는 손 떼고 굴러감
      seen.push(...stepCar(T, car, speed > 12 && !car.air ? { x: p.tx, y: p.ty } : null, 1 / 60, t));
      if (seen.includes(want)) break;
    }
    assert.ok(seen.includes(want), `${speed}m/s → ${seen.join(',')}`);
  }
});

function race(n, humans = 0) {
  let now = 10000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `봇${i}`, bot: i >= humans }));
  const ctx = { roster, secret: {}, now: () => now, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  return { ctx, step(ms = 100) { now += ms; game.tick(ctx); }, now: () => now };
}

test('봇끼리 2바퀴: 다 끝나고 완주 순서대로 등수', () => {
  const r = race(4);
  while (!r.ctx.state.over && r.now() < 10000 + 400000) r.step();
  const S = r.ctx.state;
  assert.ok(S.over);
  const fins = S.order.map(id => S.cars[id].fin).filter(Boolean);
  assert.ok(fins.length >= 1);
  assert.deepEqual(fins, [...fins].sort((a, b) => a - b));
  assert.ok(fins[0] > 40000 && fins[0] < 150000, `1등 ${fins[0]}ms`);
  assert.ok(S.titles[S.order[0]].some(t => t.startsWith('🏁 우승')));
  for (const id of S.order.filter(x => S.cars[x].fin)) assert.equal(S.cars[id].lap, LAPS);
});

test('사람 차: 순간이동은 무시, 물에서 다시 설 때만 뒤로 이동 인정', () => {
  const r = race(2, 1);
  while (r.ctx.state.phase !== 'race') r.step();
  const S = r.ctx.state;
  const c = S.cars.p0;
  const far = pointAt(T.main, 300);
  assert.equal(game.onInput(r.ctx, { pid: 'p0', type: 'car', data: { x: far.x, y: far.y, path: 'main', seg: far.i, t: r.now() } }), false);
  const near = pointAt(T.main, (c.ms + 2) % T.main.len);
  assert.equal(game.onInput(r.ctx, { pid: 'p0', type: 'car', data: { x: near.x, y: near.y, path: 'main', seg: near.i, t: r.now() + 100 } }), true);
  const back = pointAt(T.main, T.main.len - 30);
  assert.equal(game.onInput(r.ctx, { pid: 'p0', type: 'car', data: { x: back.x, y: back.y, path: 'main', seg: back.i, rs: 1, ev: ['respawn'], t: r.now() + 200 } }), true);
});

test('바퀴: 체크포인트를 다 지나야 결승선 통과가 한 바퀴', () => {
  const r = race(2, 1);
  while (r.ctx.state.phase !== 'race') r.step();
  const S = r.ctx.state;
  let t = r.now();
  // 결승선만 왔다 갔다 하면 바퀴가 안 늘어남
  for (const s of [T.main.len - 3, 2, T.main.len - 3, 3]) {
    const p = pointAt(T.main, s);
    t += 100;
    game.onInput(r.ctx, { pid: 'p0', type: 'car', data: { x: p.x, y: p.y, path: 'main', seg: p.i, rs: 1, t } });
  }
  assert.equal(S.cars.p0.lap, 0);
  // 2m씩 한 바퀴 돌면 1바퀴
  for (let s = 4; s < T.main.len + 3; s += 2) {
    const p = pointAt(T.main, s % T.main.len);
    t += 100;
    game.onInput(r.ctx, { pid: 'p0', type: 'car', data: { x: p.x, y: p.y, path: 'main', seg: p.i, t } });
  }
  assert.equal(S.cars.p0.lap, 1);
});
