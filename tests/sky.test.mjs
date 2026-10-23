import test from 'node:test';
import assert from 'node:assert/strict';
import * as planck from '../js/vendor/planck.mjs';
import game, { usePlanck } from '../js/games/sky.js';
import { makeSeq, makeTower, dropItem, stepTower, heightOf, GOAL, POOL, PARCELS } from '../js/games/sky-core.js';

usePlanck(planck);

function room(n, bots = n) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: i < bots }));
  const kills = [];
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill: (a, b) => kills.push([a, b]) };
  ctx.state = { ...game.setup(ctx), roster };
  return { ctx, kills, S: () => ctx.state, step(ms = 100) { clock += ms; game.tick(ctx); }, now: () => clock };
}

test('짐 순서: 방금 짐은 다시 안 나오고, 룰렛엔 굴러가는 택배 짐이 없다', () => {
  const seq = makeSeq(300);
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1]);
  assert.ok(seq.every(k => !PARCELS.includes(k) && k !== 'gift'));
  assert.ok(POOL.length >= 15);
});

test('아래층은 굳는다: 쌓다 보면 꼭대기에서 1m 아래 짐은 고정', () => {
  const T = makeTower(planck);
  for (const k of ['cement', 'cement', 'box', 'cement', 'micro', 'cement']) {
    dropItem(T, k, 0, 0);
    for (let i = 0; i < 120; i++) stepTower(T);
  }
  const items = [...T.items.values()];
  assert.ok(heightOf(T) > 1.5);
  assert.ok(items.some(it => it.frozen), '굳은 짐이 있어야 함');
  assert.ok(items.filter(it => it.frozen).every(it => it.body.isStatic()));
});

test('봇 4명 한 판: 30초·60초 컷으로 2명 남고, 끝나면 순위', () => {
  const r = room(4);
  while (!r.S().over && r.now() < 1_000_000 + 120_000) r.step();
  const S = r.S();
  assert.ok(S.over);
  assert.ok(S.winner || r.now() >= S.endAt);
  assert.equal(S.placement.length, 4);
  assert.ok((S.out || []).length >= (S.winner ? 0 : 2));
  assert.ok(Object.keys(S.standings).length === 4);
});

test('사람: 높이 보고·순간이동 무시·3m마다 택배, 택배 보내고 쓰기, 하늘 끝 3초면 우승', () => {
  const r = room(3, 0);
  while (r.S().phase !== 'play') r.step();
  const S = r.S();
  const rep = (pid, h) => game.onInput(r.ctx, { pid, type: 'tower', data: { h, n: 1, f: 0 } });
  rep('p0', 2);
  rep('p0', 9);                // 한 번에 7m: 무시
  assert.equal(S.h.p0, 2);
  rep('p0', 3.2);              // 3m 돌파 → 택배 1개
  assert.equal(S.parcels.p0, 1);
  assert.ok(game.onInput(r.ctx, { pid: 'p0', type: 'parcel', data: { to: 'p1' } }));
  assert.equal(S.parcels.p0, 0);
  assert.equal(S.inbox.p1.length, 1);
  assert.ok(PARCELS.includes(S.inbox.p1[0].k));
  assert.equal(game.onInput(r.ctx, { pid: 'p0', type: 'parcel', data: { to: 'p1' } }), false, '택배 없으면 못 보냄');
  assert.ok(game.onInput(r.ctx, { pid: 'p1', type: 'used', data: { no: S.inbox.p1[0].no } }));
  assert.equal(S.inbox.p1.length, 0);
  // 하늘 끝: 3초 버티면 우승
  for (let h = 3; h <= GOAL; h += 3) rep('p2', h);
  rep('p2', GOAL + 0.2);
  for (let i = 0; i < 25 && !S.over; i++) {
    r.step();
    rep('p2', GOAL + 0.2);
  }
  assert.ok(!S.over, '3초 전엔 안 끝남');
  for (let i = 0; i < 10; i++) {
    r.step();
    rep('p2', GOAL + 0.2);
  }
  assert.ok(S.over);
  assert.equal(S.winner, 'p2');
  assert.equal(S.placement[0], 'p2');
});
