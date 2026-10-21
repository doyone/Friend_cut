import test from 'node:test';
import assert from 'node:assert/strict';
import game, { arenaR } from '../js/games/bumper.js';

function fixture(n = 4) {
  let now = 10000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `봇${i}` }));
  const announcements = [];
  const ctx = { roster, secret: {}, now: () => now, isOnline: () => true, nameOf: id => id, announce: s => announcements.push(s), kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  now += 4000; game.tick(ctx);
  const car = id => ctx.state.cars.find(c => c.id === id);
  for (const [i, p] of roster.entries()) Object.assign(car(p.id), { x: i % 2 ? -5 : 5, y: i < 2 ? -4 : 4, vx: 0, vy: 0, a: 0 });
  ctx.state.itemAt = 1e12;
  return { ctx, car, announcements, now: () => now,
    step(ms = 50) { now += ms; game.tick(ctx); },
    time(ms) { now += ms; ctx.simAt = now; },
    input(pid, type, data = {}) { return game.onInput(ctx, { pid, type, data }); },
  };
}
function collide(charge = 900, diagonal = false) {
  const f = fixture();
  f.input('p0', 'charge'); f.input('p1', 'charge'); f.time(charge);
  Object.assign(f.car('p0'), { x: -.75, y: 0 });
  Object.assign(f.car('p1'), { x: .75, y: 0 });
  f.input('p0', 'dash', { x: 1, y: diagonal ? 1 : 0 });
  f.input('p1', 'dash', { x: -1, y: diagonal ? -1 : 0 });
  f.step(); return f;
}
test('only two full-charge head-on dashes cause a clash and stronger recoil', () => {
  const full = collide(), partial = collide(450), glancing = collide(900, true);
  const events = full.ctx.state.fx.filter(e => e.k === 'clash');
  assert.equal(events.length, 1);
  assert.deepEqual(new Set(events[0].ids), new Set(['p0', 'p1']));
  assert.ok(full.car('p0').vx < 0 && full.car('p1').vx > 0);
  assert.ok(Math.abs(full.car('p0').vx) > Math.abs(partial.car('p0').vx));
  assert.ok(partial.ctx.state.fx.some(e => e.k === 'bump'));
  assert.ok(!partial.ctx.state.fx.some(e => e.k === 'clash'));
  assert.ok(!glancing.ctx.state.fx.some(e => e.k === 'clash'));
});
test('one dash cannot produce multiple clashes; restored state preserves consumption', () => {
  const f = collide();
  f.ctx.state = structuredClone(f.ctx.state);
  Object.assign(f.car('p0'), { x: -.75, y: 0, vx: 20, vy: 0 });
  Object.assign(f.car('p1'), { x: .75, y: 0, vx: -20, vy: 0 });
  f.step();
  assert.equal(f.ctx.state.fx.filter(e => e.k === 'clash').length, 1);
});
test('duel starts once after elimination, warns for three seconds, shrinks continuously', () => {
  const f = fixture(3);
  assert.equal(f.ctx.state.duelAt, undefined);
  f.car('p2').x = 10; f.step();
  const S = f.ctx.state, at = S.duelAt;
  assert.equal(typeof at, 'number');
  assert.equal(f.announcements.filter(s => s.includes('최후의 결투')).length, 1);
  assert.equal(arenaR(S, at), 9);
  assert.equal(arenaR(S, at + 2999), 9);
  assert.ok(Math.abs(arenaR(S, at + 4000) - 8.76) < 1e-8);
  const restored = JSON.parse(JSON.stringify(S));
  assert.equal(arenaR(restored, at + 4000), arenaR(S, at + 4000));
  f.ctx.state = restored; f.step();
  assert.equal(restored.duelAt, at);
  assert.equal(f.announcements.filter(s => s.includes('최후의 결투')).length, 1);
  assert.equal(arenaR(S, at + 100000), 0);
});
test('two-player matches enter duel on start; simultaneous final eliminations do not', () => {
  const two = fixture(2); assert.equal(two.ctx.state.duelAt, two.now());
  const three = fixture(3);
  three.car('p1').x = 11; three.car('p2').x = -11; three.step();
  assert.equal(three.ctx.state.over, true);
  assert.equal(three.ctx.state.duelAt, undefined);
  assert.equal(Object.keys(three.ctx.state.standings).length, 3);
});
test('late duel does not enlarge the arena; final scene radius freezes', () => {
  const f = fixture(3), S = f.ctx.state;
  S.startAt = f.now() - 45000;
  Object.assign(f.car('p0'), { x: -2, y: 0 }); Object.assign(f.car('p1'), { x: 2, y: 0 });
  f.car('p2').x = 10;
  const before = arenaR(S, f.now()); f.step();
  assert.ok(arenaR(S, f.now()) <= before);
  assert.ok(arenaR(S, f.now() + 4000) < before);
  S.over = true; S.endAt = f.now();
  assert.equal(arenaR(S, S.endAt + 100000), arenaR(S, S.endAt));
});
test('charge timing and progressive driving settings remain intact', () => {
  for (const [duration, expected] of [[0, 12], [450, 16], [900, 20]]) {
    const f = fixture(); f.input('p0', 'charge'); f.time(duration);
    f.input('p0', 'dash', { x: 1, y: 0 }); assert.equal(f.car('p0').vx, expected);
  }
  const f = fixture(); Object.assign(f.car('p0'), { x: 0, y: 0 });
  f.input('p0', 'move', { x: 1, y: 0 });
  for (let i = 0; i < 10; i++) f.step();
  assert.ok(f.car('p0').vx > 3.3 && f.car('p0').vx < 4);
  f.input('p0', 'move', { x: 0, y: 0 }); assert.equal(f.car('p0').driveFor, 0);
});
