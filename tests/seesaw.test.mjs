import test from 'node:test';
import assert from 'node:assert/strict';
import * as planck from '../js/vendor/planck.mjs';
import game, { usePlanck, LIMIT, spawnY, dropGap } from '../js/games/seesaw.js';

usePlanck(planck);

test('떨구는 높이는 4차례마다 0.2m씩, 최대 2m', () => {
  assert.equal(dropGap(0), 0.8);
  assert.equal(dropGap(4), 1);
  assert.equal(dropGap(100), 2);
  // 빈 판 가운데(둥근 축 위)에 떨구면 축 꼭대기보다 떨구는 높이만큼 위
  const y = spawnY({ tilt: 0, bodies: [], turnsPlayed: 0 }, 'box', 0, 0);
  assert.ok(Math.abs(y - (0.9 + 0.35 + 0.8 + 0.3)) < 1e-9);
});

test('봇끼리 한 판: 끝까지 가고, 차례 시작부터 판 끝이 용암에 닿아 있는 일이 없음', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const mem = new Map(roster.map(p => [p.id, {}]));
  let last = null;
  while (!ctx.state.over && clock < 1_000_000 + 600_000) {
    clock += 100;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (act) game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
    }
    game.tick(ctx);
    const S = ctx.state;
    if (S.phase !== last && S.phase === 'aim') {
      assert.ok(Math.abs(S.tilt) < LIMIT - 0.004, `차례 시작 기울기 ${S.tilt}`);
      assert.equal((S.fallen || []).length, 0);
    }
    last = S.phase;
  }
  assert.ok(ctx.state.over);
  assert.equal(ctx.state.alive.length, 1);
  assert.ok(ctx.state.titles[ctx.state.alive[0]].some(t => t.includes('균형의 신')));
});
