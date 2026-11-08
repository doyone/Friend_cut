import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../js/games/balloon.js';

function newGame(n = 3) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  ctx.state.phaseEndsAt = clock;
  const tick = (ms = 50) => { clock += ms; game.tick(ctx); };
  return {
    ctx, tick,
    get S() { return ctx.state; },
    until(fn) { for (let i = 0; i < 3000 && !fn(ctx.state); i++) tick(); },
    pump(pid) { return game.onInput(ctx, { pid, type: 'pump', data: { round: ctx.state.round } }); },
    tie(pid) { return game.onInput(ctx, { pid, type: 'tie', data: { round: ctx.state.round } }); },
  };
}

test('바람: 한 번에 3~9씩, 너무 빠른 연타는 무시, 숨은 한계를 넘으면 펑 (그 뒤엔 못 넣음)', () => {
  const g = newGame(2);
  g.until(S => S.phase === 'play');
  g.ctx.secret.limits = { p0: 30, p1: 100 };
  assert.equal(g.pump('p0'), true);
  assert.equal(g.pump('p0'), false, '0.09초 안에 또 누름');
  const s1 = g.S.size.p0;
  assert.ok(s1 >= 3 && s1 <= 9);
  for (let i = 0; i < 12 && !g.S.done?.p0; i++) { g.tick(100); g.pump('p0'); }
  assert.equal(g.S.done.p0, 'pop');
  assert.ok(g.S.size.p0 > 30);
  g.tick(100);
  assert.equal(g.pump('p0'), false, '터진 뒤엔 못 넣음');
  assert.equal(g.tie('p1'), false, '빈 풍선은 못 묶음');
});

test('채점: 안 터진 풍선 중 큰 순 +3·+2·+1, 터지면 0점, 시간 끝나면 자동으로 묶이고 한계 공개', () => {
  const g = newGame(4);
  g.until(S => S.phase === 'play');
  g.ctx.secret.limits = { p0: 100, p1: 100, p2: 100, p3: 10 };
  Object.assign(g.S, { size: { p0: 40, p1: 70, p2: 55 } });
  assert.equal(g.tie('p1'), true);
  for (let i = 0; i < 4 && !g.S.done?.p3; i++) { g.tick(100); g.pump('p3'); }
  assert.equal(g.S.done.p3, 'pop');
  g.until(S => S.phase === 'result'); // p0·p2는 시간 끝에 자동으로 묶임
  const S = g.S;
  assert.deepEqual(S.done, { p0: 'tied', p1: 'tied', p2: 'tied', p3: 'pop' });
  assert.deepEqual(S.deltas, { p1: 3, p2: 2, p0: 1 });
  assert.deepEqual(S.limits, { p0: 100, p1: 100, p2: 100, p3: 10 });
});

test('봇끼리 한 판: 5라운드 하고 끝, 상태는 0.1초에 한 번만 보내게 되어 있다', () => {
  assert.equal(game.commitMs, 100);
  let clock = 1_000_000;
  const roster = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const mem = new Map(roster.map(p => [p.id, {}]));
  let pops = 0;
  while (!ctx.state.over && clock < 1_000_000 + 300_000) {
    clock += 50;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (act) game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
    }
    game.tick(ctx);
    if (ctx.state.phase === 'result') pops = Object.values(ctx.state.pops || {}).reduce((a, b) => a + b, 0);
  }
  const S = ctx.state;
  assert.ok(S.over);
  assert.equal(S.round, 5);
  assert.ok(Object.values(S.scores).reduce((a, b) => a + b, 0) > 0);
  assert.ok(pops > 0, '욕심내다 터지는 봇도 있다');
});
