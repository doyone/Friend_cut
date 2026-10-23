import test from 'node:test';
import assert from 'node:assert/strict';
import game, { useKartMaps } from '../js/games/race.js';
import { buildKartMap, KART_MAP_KEYS } from '../js/games/kart-maps.js';
import { newCar, pointAt, stepCar, botInput, ballAt } from '../js/games/race-core.js';

const DT = 1 / 60;
const SPECS = KART_MAP_KEYS.flatMap(k => [k, `${k}~`]);
const HIDDEN = { city: 'alley', mountain: 'ledge', beach: 'cave', site: 'crane' };

function onRoad(road, s, velocity = 0, lat = 0) {
  const p = pointAt(road, s);
  return { ...newCar({ main: road, start: s }), x: p.x - p.ty * lat, y: p.y + p.tx * lat,
    vx: p.tx * velocity, vy: p.ty * velocity, hx: p.tx, hy: p.ty, seg: p.i, s: p.s, ms: p.s, lat };
}

// 갈림길 입구 40m 앞 본선에서 출발한 봇이 출구 40m 뒤 본선에 닿을 때까지 (떨어졌는지, 걸린 시간)
function runBot(T, b, mem, skill = 0.92, t0 = 0) {
  const car = onRoad(T.main, b.from - 40, 18);
  Object.assign(car, { path: 'main' });
  const memory = { kartReady: true, lane: 0, ...mem };
  let t = t0;
  let fell = false;
  while (t - t0 < 30000) {
    t += DT * 1000;
    if (stepCar(T, car, botInput(T, car, memory, skill, t), DT, t).includes('splash')) fell = true;
    const d = (((car.ms - b.to) % T.main.len) + T.main.len) % T.main.len;
    if (car.path === 'main' && !car.sp && d > 40 && d < 80) return { time: (t - t0) / 1000, fell };
  }
  return { time: Infinity, fell };
}

test('맵 8가지(좌우 반전 포함)가 만들어지고 본선끼리 겹치지 않는다', () => {
  for (const spec of SPECS) {
    const T = buildKartMap(spec);
    const m = T.main;
    assert.ok(m.closed && m.len > 500, `${spec} is a long closed loop`);
    assert.ok(T.secStart.every((s, i) => !i || s > T.secStart[i - 1]), `${spec} sections run in order`);
    for (let i = 0; i < m.n; i += 3) {
      for (let j = i + 3; j < m.n; j += 3) {
        const ds = Math.min(Math.abs(m.pts[j].s - m.pts[i].s), m.len - Math.abs(m.pts[j].s - m.pts[i].s));
        if (ds < 40) continue;
        const d = Math.hypot(m.pts[i].x - m.pts[j].x, m.pts[i].y - m.pts[j].y);
        assert.ok(d > m.pts[i].half + m.pts[j].half, `${spec} far-apart main points do not overlap`);
      }
    }
    assert.ok(m.pts.every(p => !p.walls && p.fall), `${spec} main road has no walls: leaving it means falling`);
  }
});

test('숨은 지름길은 숨겨져 있고, 함정(구멍·장애물·쇳덩이·틈)은 본선 노면에 걸치지 않는다', () => {
  for (const spec of SPECS) {
    const T = buildKartMap(spec);
    const hidden = T.branches.find(b => b.id === HIDDEN[spec.replace('~', '')]);
    assert.ok(hidden?.hidden, `${spec} has its hidden shortcut`);
    assert.ok(hidden.to - hidden.from > hidden.len + 50, `${spec} shortcut skips at least 50m of road`);
    assert.ok(hidden.pts.some(p => p.offMain), `${spec} shortcut leaves the main road surface`);
    const onMain = (x, y, pad) => T.main.pts.some(q => Math.hypot(q.x - x, q.y - y) < q.half + pad);
    for (const o of [...T.posts, ...T.holes]) assert.ok(!onMain(o.x, o.y, o.r + 1), `${spec} ${o.path}@${o.s} is off the main road`);
    for (const o of T.balls) assert.ok(!onMain(o.x, o.y, o.amp + o.r), `${spec} wrecking ball swings clear of the main road`);
    for (const j of T.jumps) {
      const b = T.branches.find(x => x.id === j.path);
      for (let s = j.gap0 - 4; s <= j.gap1; s++) assert.ok(!onMain(pointAt(b, s).x, pointAt(b, s).y, 1), `${spec} jump gap is off the main road`);
    }
  }
});

test('본선 밖으로 나가면 바로 떨어지고 10m 뒤 본선 가운데서 다시 선다', () => {
  const T = buildKartMap('city');
  const s = T.secStart[2] + 20;
  const p = pointAt(T.main, s);
  const car = onRoad(T.main, s, 0, p.half - 2);
  // 길 바깥쪽으로 30도 틀어서 계속 밟는다
  const hx = p.tx * Math.cos(0.5) - p.ty * Math.sin(0.5);
  const hy = p.ty * Math.cos(0.5) + p.tx * Math.sin(0.5);
  Object.assign(car, { path: 'main', hx, hy, vx: hx * 15, vy: hy * 15 });
  const events = [];
  let t = 0;
  let fellAt = null;
  for (let i = 0; i < 300 && !events.includes('respawn'); i++) {
    t += DT * 1000;
    events.push(...stepCar(T, car, events.includes('splash') ? null : { throttle: 1, steer: 0, brake: false, drift: false }, DT, t));
    if (car.sp && fellAt == null) fellAt = car.fall.s;
  }
  assert.ok(events.includes('splash'), 'driving off the edge falls');
  assert.ok(events.includes('respawn'), 'the kart comes back');
  assert.equal(car.path, 'main');
  assert.ok(Math.abs(car.lat) < 0.5 && Math.abs(car.ms - (fellAt - 10)) < 1, 'respawn is 10m back on the centre line');
});

test('크레바스는 빠르고 곧게 와야 넘고, 열린 맨홀·크레인 쇳덩이에 걸리면 떨어진다', () => {
  const M = buildKartMap('mountain');
  const ledge = M.branches.find(b => b.id === 'ledge');
  const j = M.jumps[0];
  const jumpAt = v => {
    const car = { ...onRoad(ledge, j.gap0 - 3, v), path: 'ledge' };
    const events = [];
    for (let i = 0, t = 0; i < 40; i++) events.push(...stepCar(M, car, { throttle: 1, steer: 0, brake: false, drift: false }, DT, (t += 16)));
    return events;
  };
  assert.ok(jumpAt(j.min + 4).includes('jump') && !jumpAt(j.min + 4).includes('splash'), 'fast enough flies over');
  assert.ok(jumpAt(8).includes('splash'), 'too slow drops into the crevasse');

  const C = buildKartMap('city');
  const alley = C.branches.find(b => b.id === 'alley');
  const h = C.holes[0];
  const car = { ...onRoad(alley, h.s - 4, 10, h.lat), path: 'alley' };
  const events = [];
  for (let i = 0, t = 0; i < 40; i++) events.push(...stepCar(C, car, null, DT, (t += 16)));
  assert.ok(events.includes('splash'), 'an open manhole swallows the kart');

  const S = buildKartMap('site');
  const crane = S.branches.find(b => b.id === 'crane');
  const o = S.balls[0];
  const t = o.period; // 쇳덩이가 길 한가운데를 지나는 순간
  assert.ok(Math.abs(ballAt(o, t).off) < 0.01);
  const hit = { ...onRoad(crane, o.s - 1.5, 6), path: 'crane' };
  assert.ok(stepCar(S, hit, null, DT, t).includes('splash'), 'the wrecking ball knocks the kart off the plank');
});

test('숨은 지름길: 아는 봇이 조심해서 타면 성공하고 본선보다 2초 넘게 빠르다', () => {
  for (const key of KART_MAP_KEYS) {
    const T = buildKartMap(key);
    const b = T.branches.find(x => x.id === HIDDEN[key]);
    const main = runBot(T, b, { routes: [] });
    const short = runBot(T, b, { routes: [b.id] }, 0.92, 700);
    assert.ok(!main.fell && Number.isFinite(main.time), `${key} main route is clean`);
    assert.ok(!short.fell, `${key} careful run stays on the ${b.id}`);
    assert.ok(main.time - short.time > (key === 'beach' ? 0.5 : 2), `${key} ${b.id} saves time (${main.time} vs ${short.time})`);
  }
});

test('숨은 지름길은 위험하다: 겁 없이 밟으면 빙벽 길·뒷골목에서 떨어지고 손해를 본다', () => {
  for (const key of ['mountain', 'city']) {
    const T = buildKartMap(key);
    const b = T.branches.find(x => x.id === HIDDEN[key]);
    const main = runBot(T, b, { routes: [] }, 0.97);
    const bold = runBot(T, b, { routes: [b.id], bold: true }, 0.97);
    assert.ok(bold.fell, `${key} reckless run falls`);
    assert.ok(bold.time > main.time, `${key} falling costs more than the main road`);
  }
});

test('봇 4명이 맵 3개로 세 경기를 끝내고, 경기마다 맵이 다르다', () => {
  useKartMaps(['city~', 'beach', 'site~']);
  let now = 1_000_000;
  const roster = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => now, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const seen = new Set();
  const finished = new Set();
  while (!ctx.state.over && now < 1_000_000 + 400_000) {
    now += 50;
    game.tick(ctx);
    const S = ctx.state;
    if (S.phase === 'race') seen.add(S.maps[S.round - 1]);
    if (Object.values(S.cars || {}).some(c => c.fin)) finished.add(S.round);
  }
  useKartMaps(null);
  assert.ok(ctx.state.over, 'the match ends');
  assert.equal(ctx.state.roundResults.length, 3);
  assert.deepEqual([...seen], ['city~', 'beach', 'site~']);
  assert.deepEqual([...finished], [1, 2, 3], 'someone finishes every round');
});
