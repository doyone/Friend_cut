import test from 'node:test';
import assert from 'node:assert/strict';
import { createRacePrediction } from '../js/games/race-prediction.js';
import { buildTrack, newCar, pointAt } from '../js/games/race-core.js';

const T = buildTrack(true);
const BASE = 10_000;
const DT = 1 / 60;
const speed = c => Math.hypot(c.vx, c.vy);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} differs from ${b}`);

function at(s, velocity = 0, extra = {}) {
  const p = pointAt(T.main, s);
  return {
    ...newCar(T), x: p.x, y: p.y, seg: p.i, s, ms: s,
    vx: p.tx * velocity, vy: p.ty * velocity, hx: p.tx, hy: p.ty,
    throttle: 0, steerIntent: 0, braking: false, held: false, inputAt: BASE, t: BASE, seq: 0,
    ...extra,
  };
}

function state(cars = { me: at(12), peer: at(60) }, extra = {}) {
  return {
    run: 'prediction-test', round: 1, phase: 'race', startAt: BASE,
    worldAt: BASE, roster: Object.keys(cars).map(id => ({ id, bot: false })), cars,
    ...extra,
  };
}

function along(a, b) {
  const p = pointAt(T.main, 12);
  return (b.x - a.x) * p.tx + (b.y - a.y) * p.ty;
}

test('all karts render at one current timestamp, so 28m/s bumper contact never reverses their order', () => {
  const S = state({ me: at(12, 28), peer: at(14.7, 28) });
  const world = createRacePrediction(T, 'me');
  world.sync(S, BASE + 100);
  const rear = world.car('me');
  const front = world.car('peer');
  close(rear.t, front.t);
  close(world.time, rear.t);
  close(world.time, BASE + 100);
  assert.ok(along(rear, front) > 2.6, 'the front kart is not shown 80ms behind its physical position');
  world.step(DT, BASE + 100 + DT * 1000);
  close(rear.t, front.t);
  assert.ok(along(rear, front) > 2.6);
});

test('local driving predicts an actual impact and moves the peer immediately', () => {
  const S = state({ me: at(12, 28), peer: at(15) });
  const before = structuredClone(S);
  const world = createRacePrediction(T, 'me');
  world.sync(S, BASE);
  const result = world.step(.1, BASE + 100);
  assert.ok(result.impacts.some(hit => hit.a === 'me' && hit.b === 'peer'));
  assert.ok(speed(world.car('peer')) > 8, 'the other kart receives momentum in the same predicted frame');
  assert.ok(speed(world.car('me')) < 24);
  assert.ok(along(world.car('me'), world.car('peer')) > 2.5);
  assert.deepEqual(S, before, 'prediction never writes into the host snapshot');
});

test('reconciliation replays the local release over a delayed snapshot and ignores duplicate or older worlds', () => {
  const world = createRacePrediction(T, 'me');
  world.sync(state({ me: at(12, 10) }), BASE);
  const ref = world.car('me');
  assert.equal(world.recordInput({ throttle: 1, steer: 0, brake: false, drift: false, seq: 1 }, BASE), true);
  assert.equal(world.recordInput({ throttle: 0, steer: 0, brake: false, drift: false, seq: 2 }, BASE + 40), true);
  const snapshot = state({ me: at(12, 10, { throttle: 1, inputAt: BASE, seq: 1 }) }, { worldAt: BASE + 50 });
  assert.equal(world.sync(snapshot, BASE + 100), true);
  assert.equal(world.car('me'), ref, 'same-round references survive reconciliation');
  assert.ok(speed(ref) < 10, 'a local keyup is replayed instead of the older server-held throttle');
  const pose = structuredClone(ref);
  assert.equal(world.sync(snapshot, BASE + 120), false);
  assert.deepEqual(ref, pose);
  assert.equal(world.sync(state({ me: at(12, 10) }), BASE + 120), false);
  assert.deepEqual(ref, pose);
  assert.equal(world.recordInput({ throttle: 0, steer: -1, brake: false, drift: false, seq: 1 }, BASE + 120), false);
});

test('a snapshot replay followed by an overlapping ticker interval does not advance time twice', () => {
  const world = createRacePrediction(T, 'me');
  world.sync(state({ me: at(12, 20) }), BASE + 100);
  const pose = structuredClone(world.car('me'));
  assert.deepEqual(world.step(DT, BASE + 95), { events: [], impacts: [] });
  assert.deepEqual(world.car('me'), pose);
  world.step(DT, BASE + 100 + DT * 1000);
  close(world.time, BASE + 100 + DT * 1000);
  const distance = Math.hypot(world.car('me').x - pose.x, world.car('me').y - pose.y);
  assert.ok(distance > .25 && distance < .35, `one step moves once: ${distance}`);
});

test('large snapshot delay is capped without another catchup jump on the next local frame', () => {
  const world = createRacePrediction(T, 'me');
  const S = state({ me: at(12, 20) });
  world.sync(S, BASE + 2000);
  close(world.time, BASE + 2000);
  const c = world.car('me');
  assert.ok(Math.hypot(c.x - S.cars.me.x, c.y - S.cars.me.y) < 4.1, 'at most 200ms of motion is replayed');
  const pose = { x: c.x, y: c.y };
  world.step(DT, BASE + 2000 + DT * 1000);
  assert.ok(Math.hypot(c.x - pose.x, c.y - pose.y) < .35, 'the following frame advances only its own interval');
});

test('new rounds and remounts clear controls and reset input sequence', () => {
  const world = createRacePrediction(T, 'me');
  world.sync(state({ me: at(12) }), BASE);
  world.recordInput({ throttle: 1, steer: 0, brake: false, drift: true, seq: 99 }, BASE);
  world.step(.1, BASE + 100);
  assert.ok(speed(world.car('me')) > 1);
  const next = state({ me: at(12) }, { round: 2, worldAt: BASE + 100 });
  world.sync(next, BASE + 200);
  close(speed(world.car('me')), 0);
  assert.equal(world.recordInput({ throttle: 1, steer: 0, brake: false, drift: false, seq: 1 }, BASE + 200), true);
  world.clear();
  assert.equal(world.car('me'), undefined);
  assert.equal(world.time, null);
  world.sync(next, BASE + 200);
  close(speed(world.car('me')), 0);
});

test('latest peer intent drives bots and expired controls cannot release an old charged boost', () => {
  const S = state({
    me: at(60),
    peer: at(12, 18, { throttle: 1, steerIntent: .5, inputAt: BASE - 601, held: true, driftHeld: true, charge: 1.3 }),
  });
  S.roster.find(p => p.id === 'peer').bot = true;
  const world = createRacePrediction(T, 'me');
  world.sync(S, BASE + 50);
  close(world.car('peer').boostLeft || 0, 0);
  close(world.car('peer').charge, 0);
  const driving = state({ me: at(60), peer: at(12, 0, { throttle: 1 }) });
  driving.roster.find(p => p.id === 'peer').bot = true;
  world.reset(driving, BASE + 100);
  assert.ok(speed(world.car('peer')) > 2, 'bot intent uses the same control physics instead of standing still');
});

test('finished poses, steering state and nested respawn data survive cloning without touching the snapshot', () => {
  const S = state({
    me: at(12, 28, { fin: 1234, steer: .3, yawRate: .4 }),
    peer: at(12, 0, { sp: BASE + 1000, fall: { path: 'main', s: 12 } }),
  });
  const world = createRacePrediction(T, 'me');
  world.sync(S, BASE + 100);
  assert.deepEqual(world.car('me'), S.cars.me, 'finished karts do not coast through other racers');
  world.car('peer').fall.s = 100;
  assert.equal(S.cars.peer.fall.s, 12);
  close(world.car('me').steer, .3);
  close(world.car('me').yawRate, .4);
});

test('explicit control validation rejects old screen vectors and malformed throttle, steering or brake', () => {
  const world = createRacePrediction(T, 'me');
  world.sync(state({ me: at(12) }), BASE);
  const valid = { throttle: .7, steer: -.4, brake: false, drift: false, seq: 1 };
  for (const invalid of [
    { x: 1, y: 0, drift: false, seq: 1 },
    { ...valid, throttle: NaN }, { ...valid, throttle: 1.1 }, { ...valid, throttle: -.1 },
    { ...valid, steer: Infinity }, { ...valid, steer: 1.1 }, { ...valid, brake: 1 },
  ]) assert.equal(world.recordInput(invalid, BASE), false);
  assert.equal(world.recordInput(valid, BASE), true);
});

test('peer steering intent never overwrites the actual wheel and steering alone applies no throttle', () => {
  const S = state({ me: at(60), peer: at(12, 0, { steer: .15, steerIntent: -1 }) });
  const world = createRacePrediction(T, 'me');
  world.sync(S, BASE);
  close(world.car('peer').steer, .15);
  world.step(.1, BASE + 100);
  assert.ok(world.car('peer').steer < .15 && world.car('peer').steer > -1);
  close(speed(world.car('peer')), 0);
  close(world.car('peer').x, S.cars.peer.x);
  close(world.car('peer').y, S.cars.peer.y);
});

test('local S predicts reverse after the dwell and keyup removes reverse acceleration', () => {
  const world = createRacePrediction(T, 'me');
  world.sync(state({ me: at(12) }), BASE);
  world.recordInput({ throttle: 0, steer: 0, brake: true, drift: false, seq: 1 }, BASE);
  for (let i = 1; i <= 12; i++) world.step(.1, BASE + i * 100);
  const car = world.car('me');
  assert.ok(car.vx * car.hx + car.vy * car.hy < -5);
  assert.ok(speed(car) <= 9.00001);
  const reversedSpeed = speed(car);
  world.recordInput({ throttle: 0, steer: 0, brake: false, drift: false, seq: 2 }, BASE + 1200);
  world.step(.1, BASE + 1300);
  assert.ok(speed(car) < reversedSpeed, 'S keyup ends the reverse thrust immediately');
  assert.ok(car.vx * car.hx + car.vy * car.hy < 0);
  world.recordInput({ throttle: 1, steer: 0, brake: false, drift: false, seq: 3 }, BASE + 1300);
  for (let i = 14; i <= 22; i++) world.step(.1, BASE + i * 100);
  assert.ok(car.vx * car.hx + car.vy * car.hy > 3, 'W transitions from braking backward motion to forward driving');
});

test('a peer snapshot preserves a partly completed reverse dwell during reconciliation', () => {
  const S = state({ me: at(60), peer: at(12, 0, { braking: true, reverseHold: .15 }) });
  const world = createRacePrediction(T, 'me');
  world.sync(S, BASE + 100);
  assert.ok(world.car('peer').vx * world.car('peer').hx + world.car('peer').vy * world.car('peer').hy < -.1,
    'the remaining dwell is replayed instead of restarting the whole timer');
  close(S.cars.peer.reverseHold, .15);
});

test('normal steering retains speed and a short release quickly stops rotation', () => {
  const world = createRacePrediction(T, 'me');
  world.sync(state({ me: at(12, 22) }), BASE);
  world.recordInput({ throttle: 1, steer: 1, brake: false, drift: false, seq: 1 }, BASE);
  const original = { hx: world.car('me').hx, hy: world.car('me').hy };
  world.step(.1, BASE + 100);
  const car = world.car('me');
  const angle = Math.atan2(original.hx * car.hy - original.hy * car.hx, original.hx * car.hx + original.hy * car.hy);
  assert.ok(angle > .08, 'a 100ms keyboard tap has an immediate, visible effect');
  assert.ok(speed(car) > 21, 'a normal corner keeps the speed gained before it');
  world.recordInput({ throttle: 1, steer: 0, brake: false, drift: false, seq: 2 }, BASE + 100);
  world.step(.1, BASE + 200);
  assert.ok(Math.abs(car.yawRate) < .2, 'release does not leave the kart rotating for several hundred milliseconds');
  assert.ok(speed(car) > 21);
});

const relativeHeading = car => {
  const p = pointAt(T.main, 12);
  return Math.atan2(p.tx * car.hy - p.ty * car.hx, p.tx * car.hx + p.ty * car.hy);
};
function tapWorld() {
  const world = createRacePrediction(T, 'me');
  world.sync(state({ me: at(12, 22) }), BASE);
  world.recordInput({ throttle: 0, steer: 1, brake: false, drift: false, seq: 1 }, BASE);
  world.step(.1, BASE + 100);
  return world;
}

test('unacknowledged steering and a released 100ms tap do not lose their angular progress on snapshots', () => {
  for (const release of [false, true]) {
    const world = tapWorld();
    const before = relativeHeading(world.car('me'));
    if (release) world.recordInput({ throttle: 0, steer: 0, brake: false, drift: false, seq: 2 }, BASE + 100);
    const snapshot = state({ me: at(13.1, 22, { seq: 0, t: BASE + 50 }) }, { worldAt: BASE + 50 });
    world.sync(snapshot, BASE + 100);
    close(relativeHeading(world.car('me')), before, .0001);
    assert.ok(relativeHeading(world.car('me')) > .08);
  }
});

test('angular protection is bounded to 200ms and never overrides collisions or elimination', () => {
  const expired = tapWorld();
  expired.recordInput({ throttle: 0, steer: 0, brake: false, drift: false, seq: 2 }, BASE + 100);
  expired.step(.2, BASE + 300);
  expired.sync(state({ me: at(17.5, 22, { seq: 0, t: BASE + 250 }) }, { worldAt: BASE + 250 }), BASE + 300);
  assert.ok(Math.abs(relativeHeading(expired.car('me'))) < .001, 'a lost acknowledgement cannot protect the old local turn indefinitely');
  for (const flag of [
    { hitAt: BASE + 50, impactLeft: .2 },
    { fin: 1234 }, { sp: BASE + 1000 }, { air: BASE + 1000 },
  ]) {
    const world = tapWorld();
    const snapshot = state({ me: at(13.1, 22, { ...flag, seq: 0, t: BASE + 50 }) }, { worldAt: BASE + 50 });
    const authority = createRacePrediction(T, 'me');
    authority.sync(snapshot, BASE + 50);
    authority.recordInput({ throttle: 0, steer: 1, brake: false, drift: false, seq: 1 }, BASE);
    authority.step(.05, BASE + 100);
    world.sync(snapshot, BASE + 100);
    close(relativeHeading(world.car('me')), relativeHeading(authority.car('me')), .0001);
  }
});

test('acknowledging a tap eases its small angular difference without moving the authoritative position', () => {
  const world = tapWorld();
  world.recordInput({ throttle: 0, steer: 0, brake: false, drift: false, seq: 2 }, BASE + 100);
  world.step(.05, BASE + 150);
  world.sync(state({ me: at(14.2, 22, { seq: 0, t: BASE + 100 }) }, { worldAt: BASE + 100 }), BASE + 150);
  const before = relativeHeading(world.car('me'));
  const heading = Math.atan2(pointAt(T.main, 12).ty, pointAt(T.main, 12).tx) + .03;
  const acknowledged = state({ me: at(15.2, 22, {
    hx: Math.cos(heading), hy: Math.sin(heading), seq: 2, inputAt: BASE + 140, t: BASE + 150,
  }) }, { worldAt: BASE + 150 });
  world.sync(acknowledged, BASE + 150);
  close(relativeHeading(world.car('me')), before, .0001);
  close(world.car('me').x, acknowledged.cars.me.x);
  close(world.car('me').y, acknowledged.cars.me.y);
  let previous = relativeHeading(world.car('me'));
  for (let i = 1; i <= 9; i++) {
    world.step(DT, BASE + 150 + i * DT * 1000);
    const current = relativeHeading(world.car('me'));
    assert.ok(previous - current < .035, 'one frame never rewinds the body by more than two degrees');
    previous = current;
  }
  assert.ok(Math.abs(relativeHeading(world.car('me')) - .03) < .03, 'the small correction settles within about 150ms');
});
