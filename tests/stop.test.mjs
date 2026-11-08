import test from 'node:test';
import assert from 'node:assert/strict';
import game, { makeRound, needleAt } from '../js/games/stop.js';

function newGame(n = 3) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  ctx.state.phaseEndsAt = clock;
  const tick = () => { clock += 50; game.tick(ctx); };
  return {
    ctx, tick,
    get S() { return ctx.state; },
    until(fn) { for (let i = 0; i < 2000 && !fn(ctx.state); i++) tick(); },
    at(rel) { while (clock - ctx.state.startAt < rel) tick(); },
    stop(pid, t) { return game.onInput(ctx, { pid, type: 'stop', data: { round: ctx.state.round, t } }); },
  };
}

test('바늘: 끊기지 않고 막대 끝에서 끝까지 왕복한다 (출렁이는 라운드도), 라운드마다 과녁이 작아진다', () => {
  for (let r = 1; r <= 6; r++) {
    const R = makeRound(r);
    assert.ok(R.half >= 0.025 && R.center >= 0.15 && R.center <= 0.85);
    assert.ok(R.half <= makeRound(Math.max(1, r - 1)).half);
    if (r < 4) assert.equal(R.warp, 0);
    let min = 1;
    let max = 0;
    let prev = needleAt(R, 0);
    for (let t = 1; t <= R.period * 2; t++) {
      const p = needleAt(R, t);
      assert.ok(p >= 0 && p <= 1);
      assert.ok(Math.abs(p - prev) < 0.02, `${r}라운드 ${t}ms에서 튐`);
      min = Math.min(min, p);
      max = Math.max(max, p);
      prev = p;
    }
    assert.ok(min < 0.01 && max > 0.99, `${r}라운드 ${min}~${max}`);
  }
  const R = { period: 1000, phi: 0, warp: 0, center: 0.5, half: 0.05 };
  assert.equal(needleAt(R, 0), 0);
  assert.equal(needleAt(R, 500), 1);
  assert.ok(Math.abs(needleAt(R, 250) - 0.5) < 1e-9);
});

test('채점: 과녁 가운데에 가까운 순 +3·+2·+1, 정중앙 +1, 누른 시각으로 다시 계산', () => {
  const g = newGame(4);
  g.until(S => S.phase === 'play');
  g.S.R = { period: 1000, phi: 0, warp: 0, center: 0.5, half: 0.05 };
  g.at(300); assert.equal(g.stop('p0', 250), true);   // 0.5 정중앙
  g.at(400); assert.equal(g.stop('p1', 280), true);   // 0.56
  g.at(500); assert.equal(g.stop('p2', 350), true);   // 0.70
  assert.equal(g.stop('p2', 250), false, '한 번만');
  g.until(S => S.phase === 'result');
  const S = g.S;
  assert.equal(S.stops.p0.err, 0);
  assert.ok(Math.abs(S.stops.p1.err - 0.06) < 1e-9);
  assert.deepEqual(S.deltas, { p0: 4, p1: 2, p2: 1 });
  assert.equal(S.stops.p3, undefined, '안 멈춘 사람은 0점');
});

test('봇끼리 한 판: 6라운드 하고 끝, 봇도 대체로 과녁 근처에 멈춘다', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const mem = new Map(roster.map(p => [p.id, {}]));
  const errs = [];
  while (!ctx.state.over && clock < 1_000_000 + 300_000) {
    clock += 50;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (act && game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} })) errs.push(ctx.state.stops[p.id].err);
    }
    game.tick(ctx);
  }
  assert.ok(ctx.state.over);
  assert.equal(ctx.state.round, 6);
  errs.sort((a, b) => a - b);
  assert.ok(errs[Math.floor(errs.length / 2)] < 0.25, `오차 중간 ${errs[Math.floor(errs.length / 2)]}`);
});
