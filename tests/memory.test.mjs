import test from 'node:test';
import assert from 'node:assert/strict';
import game, { judge, expectedOf, stepOf } from '../js/games/memory.js';

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
    until(fn) { for (let i = 0; i < 3000 && !fn(ctx.state); i++) tick(); },
    done(pid, keys) { return game.onInput(ctx, { pid, type: 'done', data: { round: ctx.state.round, keys, ms: 1000 } }); },
  };
}

test('판정: 앞에서부터 맞힌 개수, 거꾸로 라운드는 반대 순서가 정답', () => {
  assert.deepEqual(judge(['U', 'R', 'D'], ['U', 'R', 'D']), { n: 3, ok: true });
  assert.deepEqual(judge(['U', 'R', 'D'], ['U', 'L']), { n: 1, ok: false });
  assert.deepEqual(expectedOf({ seq: ['U', 'R', 'D'], reverse: true }), ['D', 'R', 'U']);
  assert.ok(stepOf(10) < stepOf(1) && stepOf(100) === 330);
});

test('라운드마다 앞 순서는 그대로 하나씩 덧붙고, 틀린 사람만 탈락', () => {
  const g = newGame(3);
  g.until(S => S.phase === 'show');
  const first = [...g.S.seq];
  assert.equal(first.length, 3);
  assert.equal(g.done('p0', 'UUU'), false, '보여 주는 중엔 못 냄');
  g.until(S => S.phase === 'input');
  const exp = expectedOf(g.S).join('');
  const wrong = exp.slice(0, 1) + (exp[1] === 'U' ? 'D' : 'U');
  assert.equal(g.done('p0', exp), true);
  assert.equal(g.done('p1', wrong), true);
  assert.equal(g.done('p1', exp), false, '한 번만');
  g.until(S => S.phase === 'result');   // p2는 시간 안에 못 침
  assert.deepEqual(g.S.alive, ['p0']);
  assert.deepEqual(g.S.progress, { p0: 3, p1: 1, p2: 0 });
  g.until(S => S.phase === 'final');
  const S = g.S;
  assert.ok(S.standings.p0 > S.standings.p1 && S.standings.p1 > S.standings.p2);
  assert.ok(S.titles.p0[0].includes('기억력 왕'));
});

test('남은 사람이 둘 이상이면 다음 라운드 순서는 앞 순서 + 1개', () => {
  const g = newGame(2);
  g.until(S => S.phase === 'input');
  const first = [...g.S.seq];
  g.done('p0', expectedOf(g.S).join(''));
  g.done('p1', expectedOf(g.S).join(''));
  g.until(S => S.phase === 'count' && S.round === 2);
  assert.equal(g.S.seq.length, 4);
  assert.deepEqual(g.S.seq.slice(0, 3), first);
});

test('봇끼리 한 판: 끝까지 가고, 길어질수록 떨어져서 결국 1명 이하가 남는다', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const mem = new Map(roster.map(p => [p.id, {}]));
  while (!ctx.state.over && clock < 1_000_000 + 900_000) {
    clock += 50;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (act) game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
    }
    game.tick(ctx);
  }
  const S = ctx.state;
  assert.ok(S.over);
  assert.ok(S.alive.length <= 1 || S.seq.length >= 14);
  assert.equal(Object.keys(S.standings).length, 5);
});
