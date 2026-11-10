import test from 'node:test';
import assert from 'node:assert/strict';
import game, { holdLimit } from '../js/games/bomb.js';

test('버티기 제한: 제때 넘기면 시간이 새로 시작되고, 너무 오래 들고 있으면 손에서 터진다 (킬 없음)', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const kills = [];
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill: (a, b) => kills.push(`${a}>${b}`) };
  ctx.state = { ...game.setup(ctx), roster };
  ctx.state.phaseEndsAt = clock;
  const S = () => ctx.state;
  const wait = ms => { for (let t = 0; t < ms; t += 50) { clock += 50; game.tick(ctx); } };
  wait(50);
  assert.equal(S().phase, 'play');
  ctx.secret.fuses = { b1: clock + 1e7 }; // 퓨즈로는 안 터지게
  const b = () => S().bombs[0];
  const first = b().holder;
  const limit = holdLimit(4);
  assert.equal(b().limit, limit);
  wait(limit - 500);
  const target = roster.map(p => p.id).find(id => id !== first);
  assert.equal(game.onInput(ctx, { pid: first, type: 'throw', data: { bomb: b().id, seq: b().seq, target } }), true);
  assert.equal(b().holder, target);
  assert.equal(b().got, clock);
  wait(limit - 500);
  assert.equal(b().holder, target, '넘겨받은 사람은 시간이 새로 시작');
  wait(1000);
  assert.ok(!S().alive.includes(target), '막대가 끝나면 손에서 터진다');
  assert.equal(S().dead[target], '-');
  assert.equal(kills.length, 0, '오래 들고 있다 터지면 넘긴 사람 킬이 아니다');
});
