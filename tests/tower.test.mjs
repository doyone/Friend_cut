import test from 'node:test';
import assert from 'node:assert/strict';
import * as planck from '../js/vendor/planck.mjs';
import game, { usePlanck, ROULETTE, SHAPES } from '../js/games/tower.js';

usePlanck(planck);

function room(n, bot = true) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  return { ctx, S: () => ctx.state, step(ms = 100) { clock += ms; game.tick(ctx); }, now: () => clock };
}

test('빈 받침대 가운데에 놓은 룰렛 블록은 모두 버틴다 (새 블록 포함)', () => {
  for (const k of ROULETTE) {
    const r = room(2, false);
    while (r.S().phase !== 'aim') r.step();
    Object.assign(r.S(), { piece: k });
    game.onInput(r.ctx, { pid: r.S().turn, type: 'drop', data: { x: 0, a: 0 } });
    const before = r.S().alive.length;
    while (!['decide', 'result', 'spin'].includes(r.S().phase) && !r.S().over) r.step();
    assert.equal(r.S().alive.length, before, `${SHAPES[k].name} 떨어짐`);
  }
});

test('봇끼리 한 판: 끝까지 가고 우승자 1명', () => {
  const r = room(4);
  const mem = new Map(r.ctx.roster.map(p => [p.id, {}]));
  while (!r.S().over && r.now() < 1_000_000 + 900_000) {
    for (const p of r.ctx.roster) {
      const act = game.bot(r.ctx, p.id, mem.get(p.id));
      if (act) game.onInput(r.ctx, { pid: p.id, type: act.type, data: act.data || {} });
    }
    r.step();
  }
  assert.ok(r.S().over);
  assert.equal(r.S().alive.length, 1);
});
