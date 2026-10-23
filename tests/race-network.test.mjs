import test from 'node:test';
import assert from 'node:assert/strict';
import game, { useKartMaps } from '../js/games/race.js';
// 이 파일은 예전 와이드 8자 트랙 좌표로 시험한다 (게임은 원래 경기마다 다른 맵)
useKartMaps(['wide']);
import { buildTrack, newCar, pointAt, locate } from '../js/games/race-core.js';
import { prune } from '../js/net/prune.js';
import { createRacePrediction } from '../js/games/race-prediction.js';

const T = buildTrack(true);
const speed = car => Math.hypot(car.vx, car.vy);

function fixture(bots = [false, false]) {
  let now = 10_000;
  let ctx;
  const roster = bots.map((bot, i) => ({ id: `p${i}`, name: `P${i}`, bot }));
  const makeContext = (state, secret = {}) => ({
    state, secret, roster, now: () => now, isOnline: () => true,
    nameOf: id => id, announce() {}, kill() {},
  });
  ctx = makeContext();
  ctx.state = { ...game.setup(ctx), roster, run: 'network-test' };
  while (ctx.state.phase !== 'race') {
    now += 50;
    game.tick(ctx);
  }
  return {
    get ctx() { return ctx; },
    get state() { return ctx.state; },
    now: () => now,
    step(ms = 50) { now += ms; game.tick(ctx); },
    drive(pid, values = {}) {
      return game.onInput(ctx, { pid, type: 'drive', data: {
        round: ctx.state.round, seq: (ctx.state.cars[pid]?.seq || 0) + 1,
        throttle: 0, steer: 0, brake: false, drift: false, ...values,
      } });
    },
    migrate() {
      ctx = makeContext(JSON.parse(JSON.stringify(prune(ctx.state))), JSON.parse(JSON.stringify(ctx.secret)));
    },
  };
}

function place(r, id, s, velocity = 0, lateral = 0) {
  const c = r.state.cars[id];
  const p = pointAt(T.main, s);
  Object.assign(c, newCar(T), {
    x: p.x - p.ty * lateral, y: p.y + p.tx * lateral,
    vx: p.tx * velocity, vy: p.ty * velocity,
    hx: p.tx, hy: p.ty, h: Math.atan2(p.ty, p.tx),
    seg: p.i, s, ms: s, lat: lateral, dist: 0,
    throttle: 0, steerIntent: 0, braking: false, held: false, inputAt: r.now(), t: r.now(),
  });
  const at = locate(T, c, c.x, c.y);
  Object.assign(c, { seg: at.seg, s: at.s, ms: at.ms, lat: at.lat });
  delete c.fin;
  return c;
}

function spread(r) {
  place(r, 'p0', T.start + 12);
  place(r, 'p1', T.start + 55);
}

test('drive: host integrates controls and ignores client position reports', () => {
  const r = fixture();
  spread(r);
  const c = r.state.cars.p0;
  const before = { x: c.x, y: c.y };
  assert.equal(game.onInput(r.ctx, { pid: 'p0', type: 'car', data: {
    round: r.state.round, x: 99999, y: 99999, vx: 99999, rs: 1,
  } }), false);
  assert.deepEqual({ x: c.x, y: c.y }, before);
  assert.equal(r.drive('p0', { throttle: 1 }), true);
  r.step(200);
  assert.ok(Math.hypot(c.x - before.x, c.y - before.y) > .1);
  assert.ok(speed(c) > 1 && speed(c) < 50);
});

test('drive: stale round, outsider, replay and reordered sequence cannot overwrite controls', () => {
  const r = fixture();
  spread(r);
  assert.equal(r.drive('p0', { seq: 5, throttle: 1, steer: .5 }), true);
  for (const data of [
    { seq: 5, throttle: 0 }, { seq: 4, throttle: 0 },
    { seq: 6, round: r.state.round - 1, throttle: 0 },
    { seq: Infinity }, { seq: 6, throttle: NaN },
    { seq: 6, throttle: 1.1 }, { seq: 6, throttle: -1 },
    { seq: 6, steer: Infinity }, { seq: 6, steer: -1.1 },
    { seq: 6, brake: 1 }, { seq: 6, drift: 1 },
  ]) assert.equal(r.drive('p0', data), false);
  assert.equal(game.onInput(r.ctx, { pid: 'outsider', type: 'drive', data: {
    round: r.state.round, seq: 1, throttle: 1, steer: 0, brake: false, drift: false,
  } }), false);
  assert.equal(r.state.cars.p0.seq, 5);
  assert.equal(r.state.cars.p0.throttle, 1);
  assert.equal(r.state.cars.p0.steerIntent, .5);
  assert.equal(r.drive('p0', { seq: 6, steer: -1 }), true);
  assert.equal(r.state.cars.p0.throttle, 0);
  assert.equal(r.state.cars.p0.steerIntent, -1);
});

test('drive: key release removes thrust immediately and a missing release expires after its lease', () => {
  const released = fixture();
  const expired = fixture();
  for (const r of [released, expired]) {
    spread(r);
    r.drive('p0', { throttle: 1 });
    r.step(200);
  }
  const beforeRelease = speed(released.state.cars.p0);
  released.drive('p0');
  released.step(200);
  assert.ok(speed(released.state.cars.p0) < beforeRelease, 'keyup causes coasting instead of continued acceleration');
  for (let i = 0; i < 10; i++) expired.step(50);
  const afterLease = speed(expired.state.cars.p0);
  expired.step(200);
  assert.ok(speed(expired.state.cars.p0) < afterLease, 'lost keyup does not keep thrusting after 600ms');
  assert.ok(afterLease > beforeRelease, 'lease allows a held control between heartbeat messages');
});

test('host migration: JSON/Firebase roundtrip preserves boost, controls, timing and collision outcome', () => {
  const uninterrupted = fixture();
  const migrated = fixture();
  for (const r of [uninterrupted, migrated]) {
    const back = place(r, 'p0', T.start + 15, 24);
    place(r, 'p1', T.start + 17, 2);
    back.boostLeft = .8;
    back.charge = .7;
    back.driftHeld = true;
    r.drive('p0', { throttle: 1, steer: .3, drift: true });
  }
  migrated.migrate();
  for (let i = 0; i < 6; i++) {
    uninterrupted.step(50);
    migrated.step(50);
  }
  for (const id of ['p0', 'p1']) {
    const a = uninterrupted.state.cars[id];
    const b = migrated.state.cars[id];
    for (const key of ['x', 'y', 'vx', 'vy', 'hx', 'hy', 'steer', 'steerInput', 'yawRate', 'boostLeft', 'charge', 'ms', 't']) {
      assert.ok(Math.abs((a[key] || 0) - (b[key] || 0)) < .0001, `${id}.${key} survives host handoff`);
    }
    assert.equal(a.seq, b.seq);
  }
});

test('same-layer rear impact transfers momentum; a finished kart neither blocks nor receives it', () => {
  const live = fixture();
  const finished = fixture();
  for (const r of [live, finished]) {
    place(r, 'p0', T.start + 15, 24);
    place(r, 'p1', T.start + 17, 0);
  }
  finished.state.cars.p1.fin = 100;
  const finishPose = { x: finished.state.cars.p1.x, y: finished.state.cars.p1.y };
  live.step(50);
  finished.step(50);
  assert.ok(speed(live.state.cars.p1) > 3, 'rear kart physically pushes the front kart');
  assert.ok(speed(live.state.cars.p0) < speed(finished.state.cars.p0) - 2, 'rear kart gives up momentum');
  assert.deepEqual({ x: finished.state.cars.p1.x, y: finished.state.cars.p1.y }, finishPose);
  assert.equal(speed(finished.state.cars.p1), 0);
});

test('human and bot share one collision world', () => {
  const impact = fixture([false, true]);
  const control = fixture([false, true]);
  for (const r of [impact, control]) {
    place(r, 'p0', T.start + 15, 24);
    place(r, 'p1', T.start + 17, 0);
  }
  place(control, 'p0', T.start + 50, 24);
  impact.step(50);
  control.step(50);
  assert.ok(speed(impact.state.cars.p1) > speed(control.state.cars.p1) + 3, 'human impact changes the authoritative bot velocity');
  assert.ok(speed(impact.state.cars.p0) < speed(control.state.cars.p0) - 2);
});

test('forward throttle follows the current kart heading rather than a screen direction', () => {
  for (const angle of [0, Math.PI / 2, Math.PI]) {
    const r = fixture();
    spread(r);
    const c = r.state.cars.p0;
    Object.assign(c, { hx: Math.cos(angle), hy: Math.sin(angle), h: angle });
    const before = { x: c.x, y: c.y };
    r.drive('p0', { throttle: 1 });
    r.step(200);
    const forward = (c.x - before.x) * Math.cos(angle) + (c.y - before.y) * Math.sin(angle);
    const sideways = -(c.x - before.x) * Math.sin(angle) + (c.y - before.y) * Math.cos(angle);
    assert.ok(forward > .2, `heading ${angle}: throttle moves the kart forward`);
    assert.ok(Math.abs(sideways) < .001);
    assert.ok(c.hx * Math.cos(angle) + c.hy * Math.sin(angle) > .999);
  }
});

test('steering alone turns the wheel gradually without moving or rotating a stopped kart', () => {
  const r = fixture();
  spread(r);
  const c = r.state.cars.p0;
  const before = { x: c.x, y: c.y, hx: c.hx, hy: c.hy };
  r.drive('p0', { steer: 1 });
  r.step(200);
  assert.equal(c.steerIntent, 1);
  assert.ok(c.steer > 0 && c.steer < 1, 'steerIntent is separate from the gradually moving wheel');
  assert.ok(speed(c) < .000001);
  assert.deepEqual({ x: c.x, y: c.y, hx: c.hx, hy: c.hy }, before);
});

test('holding S brakes first, then reverses; releasing S coasts and W returns to forward motion', () => {
  const r = fixture();
  spread(r);
  const c = place(r, 'p0', T.start + 12, 18);
  let sawStop = false;
  let sawReverse = false;
  for (let i = 0; i < 15; i++) {
    r.drive('p0', { brake: true });
    r.step(100);
    const forward = c.vx * c.hx + c.vy * c.hy;
    sawStop ||= speed(c) < .1;
    sawReverse ||= forward < -1;
    assert.ok(forward >= -9.00001, 'reverse speed is limited to 9m/s');
  }
  assert.ok(sawStop, 'S must stop before applying reverse');
  assert.ok(sawReverse, 'holding S after the neutral dwell engages reverse');
  const beforeRelease = speed(c);
  r.drive('p0');
  r.step(200);
  assert.ok(speed(c) < beforeRelease, 'releasing S removes reverse thrust');
  assert.ok(c.vx * c.hx + c.vy * c.hy < 0, 'keyup coasts instead of instantly switching direction');
  for (let i = 0; i < 8; i++) {
    r.drive('p0', { throttle: 1 });
    r.step(100);
  }
  assert.ok(c.vx * c.hx + c.vy * c.hy > 3, 'W brakes backward motion before driving forward');
});

test('host and prediction match for throttle, gradual steering, braking and release', () => {
  const r = fixture();
  spread(r);
  const prediction = createRacePrediction(T, 'p0');
  prediction.sync(structuredClone(r.state), r.now());
  for (const input of [
    { throttle: 1, steer: 0, brake: false, drift: false },
    { throttle: 1, steer: .6, brake: false, drift: false },
    { throttle: 0, steer: -.3, brake: true, drift: false },
    { throttle: .5, steer: 0, brake: false, drift: false },
  ]) {
    const seq = r.state.cars.p0.seq + 1;
    assert.equal(prediction.recordInput({ ...input, seq }, r.now()), true);
    assert.equal(r.drive('p0', { ...input, seq }), true);
    r.step(100);
    prediction.step(.1, r.now());
    for (const id of ['p0', 'p1']) {
      for (const key of ['x', 'y', 'vx', 'vy', 'hx', 'hy', 'steer', 'steerInput', 'yawRate']) {
        assert.ok(Math.abs((r.state.cars[id][key] || 0) - (prediction.car(id)[key] || 0)) < .00001, `${id}.${key} matches host physics`);
      }
    }
  }
});

test('host handoff and prediction retain the reverse dwell, backward steering and forward return', () => {
  const uninterrupted = fixture();
  const handedOff = fixture();
  const prediction = createRacePrediction(T, 'p0');
  for (const r of [uninterrupted, handedOff]) spread(r);
  prediction.sync(structuredClone(uninterrupted.state), uninterrupted.now());
  const inputs = [
    ...Array.from({ length: 10 }, () => ({ throttle: 0, steer: 0, brake: true, drift: false })),
    ...Array.from({ length: 3 }, () => ({ throttle: 0, steer: .45, brake: true, drift: false })),
    ...Array.from({ length: 8 }, () => ({ throttle: 1, steer: 0, brake: false, drift: false })),
  ];
  let reversed = false;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const seq = uninterrupted.state.cars.p0.seq + 1;
    prediction.recordInput({ ...input, seq }, uninterrupted.now());
    for (const r of [uninterrupted, handedOff]) {
      r.drive('p0', { ...input, seq });
      r.step(100);
    }
    prediction.step(.1, uninterrupted.now());
    if (i === 0) handedOff.migrate(); // handoff during the neutral reverse dwell
    const c = uninterrupted.state.cars.p0;
    reversed ||= c.vx * c.hx + c.vy * c.hy < -1;
    for (const other of [handedOff.state.cars.p0, prediction.car('p0')]) {
      for (const key of ['x', 'y', 'vx', 'vy', 'hx', 'hy', 'steer', 'steerInput', 'yawRate', 'reverseHold']) {
        assert.ok(Math.abs((c[key] || 0) - (other[key] || 0)) < .00001, `${key} survives backward driving and host handoff`);
      }
    }
  }
  assert.ok(reversed);
  const c = uninterrupted.state.cars.p0;
  assert.ok(c.vx * c.hx + c.vy * c.hy > 3);
});

test('100ms steering taps, release and countersteering respond identically on host and client', () => {
  const r = fixture();
  spread(r);
  const c = place(r, 'p0', 12, 22);
  const prediction = createRacePrediction(T, 'p0');
  prediction.sync(structuredClone(r.state), r.now());
  for (const [i, steer] of [1, 0, -1, 0].entries()) {
    const before = { hx: c.hx, hy: c.hy };
    const input = { throttle: 1, steer, brake: false, drift: false, seq: c.seq + 1 };
    prediction.recordInput(input, r.now());
    r.drive('p0', input);
    r.step(100);
    prediction.step(.1, r.now());
    const change = Math.atan2(before.hx * c.hy - before.hy * c.hx, before.hx * c.hx + before.hy * c.hy);
    if (i === 0) assert.ok(change > .08, `a short tap makes a visible turn immediately: ${change}`);
    if (i === 2) assert.ok(change < -.08, `countersteering changes direction within the next tap: ${change}`);
    if (!steer) assert.ok(Math.abs(c.yawRate) < .2, 'releasing steering stops the turn instead of dragging it out');
    assert.ok(speed(c) > 20, 'ordinary steering does not consume most of the speed');
    for (const key of ['x', 'y', 'vx', 'vy', 'hx', 'hy', 'steer', 'steerInput', 'yawRate']) {
      assert.ok(Math.abs((c[key] || 0) - (prediction.car('p0')[key] || 0)) < .00001, `${key} matches during the steering tap`);
    }
  }
});

test('releasing a charged drift produces the same boost and grip state on host and prediction', () => {
  const r = fixture();
  spread(r);
  const c = place(r, 'p0', 12, 22);
  Object.assign(c, { charge: 1.2, driftHeld: true, held: true, dr: 1 });
  const prediction = createRacePrediction(T, 'p0');
  prediction.sync(structuredClone(r.state), r.now());
  const input = { throttle: 1, steer: 0, brake: false, drift: false, seq: c.seq + 1 };
  prediction.recordInput(input, r.now());
  r.drive('p0', input);
  r.step(100);
  const result = prediction.step(.1, r.now());
  assert.ok(result.events.includes('boost'));
  assert.ok(c.boostLeft > 1);
  assert.equal(c.charge, 0);
  assert.equal(c.driftHeld, false);
  for (const key of ['x', 'y', 'vx', 'vy', 'hx', 'hy', 'steer', 'yawRate', 'charge', 'boostLeft']) {
    assert.ok(Math.abs((c[key] || 0) - (prediction.car('p0')[key] || 0)) < .00001, `${key} agrees after drift release`);
  }
});
