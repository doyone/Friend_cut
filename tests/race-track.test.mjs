import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../js/games/race.js';
import { buildTrack, newCar, pointAt, locate, stepCar, KART, resolveKartContacts, botInput, roadWallOpen } from '../js/games/race-core.js';
import { createRacePrediction } from '../js/games/race-prediction.js';

const T = buildTrack(true);
const DT = 1 / 60;
const STEP_MS = DT * 1000;
const speed = car => Math.hypot(car.vx, car.vy);

function onMain(s, velocity = 0, lat = 0) {
  const p = pointAt(T.main, s);
  return { ...newCar(T), x: p.x - p.ty * lat, y: p.y + p.tx * lat,
    vx: p.tx * velocity, vy: p.ty * velocity, hx: p.tx, hy: p.ty,
    path: 'main', seg: p.i, s: p.s, ms: p.s, lat };
}

// A continuous driver, not a position fixture: only the initial pose is placed.
// Every later pose is produced by stepCar, including the fork and the merge.
function targetAhead(car, distance, shortcut) {
  const b = T.branch;
  if (car.path === 'branch' && shortcut) {
    const s = car.s + distance;
    return s <= b.len ? pointAt(b, s) : pointAt(T.main, b.to + s - b.len);
  }
  if (shortcut && car.ms > b.from - 30 && car.ms < b.to - 2 && car.ms + distance > b.from) {
    const s = car.ms < b.from ? car.ms + distance - b.from
      : (car.ms - b.from) / (b.to - b.from) * b.len + distance;
    return s <= b.len ? pointAt(b, s) : pointAt(T.main, b.to + s - b.len);
  }
  return pointAt(T.main, car.ms + distance);
}

function routeInput(car, shortcut, limit = 25) {
  const velocity = speed(car);
  const target = targetAhead(car, 5 + velocity * 0.30, shortcut);
  const dx = target.x - car.x, dy = target.y - car.y;
  const angle = Math.atan2(car.hx * dy - car.hy * dx, car.hx * dx + car.hy * dy);
  const yaw = 2 * Math.max(3, velocity) * Math.sin(angle) / Math.max(1, Math.hypot(dx, dy));
  const steer = Math.max(-1, Math.min(1, yaw / Math.max(0.5, KART.turnRate * Math.min(1, velocity / 8))));
  const brake = velocity > limit + 0.5 || Math.abs(angle) > 1.1 && velocity > 12;
  return { throttle: brake ? 0 : 1, steer, brake, drift: false };
}

function throughFork(shortcut, limit = 25) {
  const car = onMain(T.branch.from - 18, limit);
  const events = [], paths = new Set([car.path]), progress = [car.ms];
  let usedBranchMiddle = false;
  let elapsed = 0;
  while (elapsed < 15_000 && car.ms < T.branch.to + 15) {
    elapsed += STEP_MS;
    events.push(...stepCar(T, car, routeInput(car, shortcut, limit), DT, elapsed));
    paths.add(car.path); progress.push(car.ms);
    usedBranchMiddle ||= car.path === 'branch' && car.s > 8 && car.s < T.branch.len - 8;
    assert.ok(!car.sp && !car.air, 'the asphalt route stays on the road without a respawn');
  }
  return { car, events, paths, progress, elapsed, usedBranchMiddle };
}

function hostRace(count) {
  let now = 10_000;
  const roster = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Bot ${i}`, bot: true }));
  const ctx = { roster, secret: {}, now: () => now, isOnline: () => true,
    nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const drivers = () => new Map(roster.map((p, i) => [p.id, {
    mem: { short: i % 2 === 1 }, skill: 0.90 + (i % 4) * 0.025,
  }]));
  ctx.drivers = drivers();
  return { ctx, drivers, now: () => now, step(ms = 50) { now += ms; game.tick(ctx); } };
}

test('넓어진 본선은 세 카트가 나란히 달리고 옆 차선으로 앞차를 추월할 수 있다', () => {
  assert.ok(T.main.pts.every(p => p.half >= 7), 'the entire main road provides at least 14 metres of width');
  const rows = [-4, 0, 4].map((lat, i) => ({ id: `lane${i}`, car: onMain(12, KART.max, lat) }));
  for (let frame = 1; frame <= 45; frame++) {
    const entries = rows.map(entry => ({ ...entry, prev: { ...entry.car } }));
    for (const { car } of rows) {
      assert.deepEqual(stepCar(T, car, { throttle: 1 }, DT, frame * STEP_MS), []);
    }
    assert.deepEqual(resolveKartContacts(T, entries, DT), []);
  }
  assert.ok(rows.every(({ car }) => car.ms > 31 && !car.sp));
  assert.ok(rows[0].car.lat < -3.8 && rows[2].car.lat > 3.8, 'the outside lanes do not get pushed into the centre');

  const leader = onMain(24, 18), passer = onMain(18, KART.max, 3);
  assert.ok(passer.ms < leader.ms);
  for (let frame = 1; frame <= 90; frame++) {
    const entries = [{ id: 'leader', car: leader, prev: { ...leader } }, { id: 'passer', car: passer, prev: { ...passer } }];
    assert.deepEqual(stepCar(T, leader, null, DT, frame * STEP_MS), []);
    assert.deepEqual(stepCar(T, passer, { throttle: 1 }, DT, frame * STEP_MS), []);
    assert.deepEqual(resolveKartContacts(T, entries, DT), [], 'side-by-side passing does not require bumping through a kart');
  }
  assert.ok(passer.ms > leader.ms + 5, `the rear kart passes on a separate lane: ${passer.ms} vs ${leader.ms}`);
});

test('선택 지름길은 열린 입구부터 본선 합류까지 실제로 주행하고 순위 거리가 연속된다', () => {
  const shortcut = throughFork(true);
  const main = throughFork(false);
  assert.ok(shortcut.paths.has('branch'), 'taking the fork actually selects the branch path');
  assert.equal(shortcut.car.path, 'main', 'the branch rejoins the main road');
  assert.ok(shortcut.car.ms >= T.branch.to + 15, 'the car continues past the merge');
  assert.deepEqual(shortcut.events, [], 'the mouth and merge have no invisible transverse wall or water');
  assert.ok(!main.usedBranchMiddle, 'the ordinary line remains an independent choice past the shared mouth');
  assert.ok(main.car.ms >= T.branch.to + 15);
  assert.ok(shortcut.elapsed < main.elapsed - 500,
    `the successful fork gains meaningful time: ${shortcut.elapsed} ms vs ${main.elapsed} ms`);
  for (let i = 1; i < shortcut.progress.length; i++) {
    const delta = shortcut.progress[i] - shortcut.progress[i - 1];
    assert.ok(delta > -0.3 && delta < 5, `route distance is continuous at the fork and merge (${delta} m at ${shortcut.progress[i - 1]} → ${shortcut.progress[i]})`);
  }
});

test('고가 위와 아래의 넓어진 도로는 같은 좌표에서도 충돌 층을 섞지 않는다', () => {
  const under = T.main.pts.findIndex(p => p.sec === 0 && Math.hypot(p.x - T.cross.x, p.y - T.cross.y) < 1.2);
  const over = T.main.pts.findIndex(p => p.sec === 4 && Math.hypot(p.x - T.cross.x, p.y - T.cross.y) < 1.2);
  assert.ok(under >= 0 && over >= 0);
  const a = { ...newCar(T), x: T.cross.x, y: T.cross.y, seg: under, vx: 20, vy: 0 };
  const b = { ...newCar(T), x: T.cross.x, y: T.cross.y, seg: over, vx: -20, vy: 0 };
  assert.notEqual(locate(T, a, a.x, a.y).p.layer, locate(T, b, b.x, b.y).p.layer);
  const before = structuredClone([a, b]);
  assert.deepEqual(resolveKartContacts(T, [{ id: 'under', car: a }, { id: 'over', car: b }], DT), []);
  assert.deepEqual([a, b], before);
});

test('같은 실력의 후발 봇은 지름길을 성공하면 본선 앞차를 추월해 합류한다', () => {
  const main = onMain(T.branch.from - 22, 25);
  const shortcut = onMain(T.branch.from - 30, 25);
  const mainMem = { kartReady: true, short: false, lane: 0 };
  const shortMem = { kartReady: true, short: true, lane: 0 };
  const seen = new Set(), events = [];
  let mainAt = 0, shortAt = 0, elapsed = 0;
  while ((!mainAt || !shortAt) && elapsed < 15_000) {
    elapsed += STEP_MS;
    const entries = [{ id: 'main', car: main, prev: { ...main } }, { id: 'shortcut', car: shortcut, prev: { ...shortcut } }];
    events.push(...stepCar(T, main, botInput(T, main, mainMem, 0.95), DT, elapsed));
    events.push(...stepCar(T, shortcut, botInput(T, shortcut, shortMem, 0.95), DT, elapsed));
    resolveKartContacts(T, entries, DT);
    if (shortcut.path === 'branch') seen.add('shortcut');
    if (main.path === 'branch' && main.s > 8 && main.s < T.branch.len - 8) seen.add('main');
    if (!mainAt && main.ms >= T.branch.to + 18) mainAt = elapsed;
    if (!shortAt && shortcut.ms >= T.branch.to + 18) shortAt = elapsed;
  }
  assert.ok(seen.has('shortcut') && !seen.has('main'), 'the two bots actually choose different roads');
  assert.ok(mainAt && shortAt && shortAt < mainAt - 200,
    `the kart starting 8 metres behind passes through the fork: ${shortAt} ms vs ${mainAt} ms`);
  assert.ok(!events.includes('wall') && !events.includes('splash'), 'both lines can be completed cleanly');
});

function towardOpenEdge(path, road, i, side) {
  const p = road.pts[i], nx = -p.ty * side, ny = p.tx * side;
  return { ...newCar(T), path, seg: i, s: p.s,
    ms: path === 'branch' ? T.branch.from + p.s / T.branch.len * (T.branch.to - T.branch.from) : p.s,
    x: p.x + nx * (p.half - 1.5), y: p.y + ny * (p.half - 1.5),
    hx: nx, hy: ny, vx: nx * KART.max, vy: ny * KART.max };
}

test('지름길 끝점 밖의 가상 반원은 노면으로 보지 않고 본선 바깥 난간을 유지한다', () => {
  for (const [end, direction] of [[T.branch.pts[0], -1], [T.branch.pts.at(-1), 1]]) {
    // A point one metre beyond the branch's flat end still lies in the nearest-point end circle.
    const edge = { x: end.x + end.tx * direction, y: end.y + end.ty * direction,
      tx: end.tx, ty: end.ty, half: 0, s: direction < 0 ? T.branch.from : T.branch.to, layer: 0 };
    assert.equal(roadWallOpen(T, 'main', edge, 1), false, 'a flat junction end must not open a rail into empty space');
  }
});

test('갈림길의 모든 열린 난간에서도 양쪽 노면 밖으로 계속 빠져나갈 수 없다', () => {
  let checked = 0;
  for (const [path, road] of [['main', T.main], ['branch', T.branch]]) {
    for (let i = 0; i < road.n; i++) for (const side of [-1, 1]) {
      if (!roadWallOpen(T, path, road.pts[i], side)) continue;
      checked++;
      const car = towardOpenEdge(path, road, i, side);
      for (let frame = 1; frame <= 150; frame++) {
        stepCar(T, car, { throttle: 1 }, DT, frame * STEP_MS);
        const at = locate(T, car, car.x, car.y);
        assert.ok(at && !car.sp && at.d <= at.p.half + 0.3,
          `${path} ${i} side ${side}: an open junction must not expose an unbounded road extension`);
      }
    }
  }
  assert.ok(checked > 20, 'the regression covers the full set of overlapping junction edges');
});

test('갈림길 경계에서 옆 차와 접촉해도 방장과 두 카트의 화면 예측이 같은 위치를 계산한다', () => {
  const base = 10_000, i = T.main.pts.findIndex(p => p.openWalls?.includes(-1));
  assert.ok(i >= 0);
  const me = towardOpenEdge('main', T.main, i, -1), p = T.main.pts[i];
  const peer = { ...me, x: me.x + p.tx * 1.9, y: me.y + p.ty * 1.9 };
  const source = Object.fromEntries([['me', me], ['peer', peer]].map(([id, car]) => [id, {
    ...car, throttle: 1, steerIntent: 0, braking: false, held: false, inputAt: base, t: base, seq: 0,
  }]));
  const host = structuredClone(source), world = createRacePrediction(T, 'me');
  world.sync({ run: 'fork-contact', round: 1, phase: 'race', startAt: base, worldAt: base,
    roster: [{ id: 'me' }, { id: 'peer' }], cars: source }, base);
  world.recordInput({ throttle: 1, steer: 0, brake: false, drift: false, seq: 1 }, base);
  for (let frame = 1; frame <= 30; frame++) {
    const now = base + frame * STEP_MS;
    const entries = Object.entries(host).map(([id, car]) => ({ id, car, prev: { ...car } }));
    for (const car of Object.values(host)) stepCar(T, car, { throttle: 1 }, DT, now);
    resolveKartContacts(T, entries, DT);
    world.step(DT, now);
    for (const [id, car] of Object.entries(host)) {
      const predicted = world.car(id), at = locate(T, car, car.x, car.y);
      assert.ok(Math.hypot(car.x - predicted.x, car.y - predicted.y) < 1e-5, `${id} shares the host's boundary and contact solution`);
      assert.ok(Math.hypot(car.vx - predicted.vx, car.vy - predicted.vy) < 1e-5);
      assert.ok(at.d <= at.p.half + 0.3, `${id} remains in the joined road surface after contact`);
    }
  }
});

for (const count of [2, 4, 8]) {
  test(`${count} 봇이 갈림길을 선택하며 세 경기를 완주하고 지름길에서도 체크포인트가 누락되지 않는다`, () => {
    const race = hostRace(count), state = race.ctx.state;
    const visited = new Set(), completed = new Map(), checkpointSets = new Map();
    let observedRound = state.round;
    while (!state.over && race.now() < 230_000) {
      race.step();
      if (state.round !== observedRound) {
        observedRound = state.round;
        race.ctx.drivers = race.drivers();
      }
      if (!['race', 'intermission', 'final'].includes(state.phase)) continue;
      for (const [id, car] of Object.entries(state.cars)) {
        const key = `${state.round}:${id}`;
        if (car.path === 'branch') visited.add(key);
        if (!checkpointSets.has(key)) checkpointSets.set(key, new Set());
        checkpointSets.get(key).add(car.cp);
        if (car.fin) completed.set(key, { fin: car.fin, lap: car.lap, dist: car.dist, spl: car.spl });
        assert.ok(Number.isFinite(car.x) && Number.isFinite(car.y), 'all bot poses stay finite');
      }
    }
    assert.ok(state.over, 'the three-round match terminates');
    assert.equal(state.roundResults.length, 3);
    assert.equal(completed.size, count * 3, 'every bot reaches the finish in every round');
    assert.ok(visited.size >= 3, 'bots use the optional route, rather than leaving it inaccessible');
    for (const [key, car] of completed) {
      assert.equal(car.lap, 1, `${key} has a validated lap`);
      assert.equal(car.spl, 0, `${key} never needs a water respawn`);
      assert.ok(car.fin < 45_000 && car.dist > T.main.len - 10, `${key} completes the course within the race clock`);
      assert.ok(checkpointSets.get(key).has(7), `${key} reaches the last checkpoint before finishing`);
    }
    for (const key of visited) assert.ok(completed.has(key), `${key} can finish after taking the shortcut`);
  });
}
