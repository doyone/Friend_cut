import test from 'node:test';
import assert from 'node:assert/strict';
import game, { makeRush, makeCrowd, scoreRound, TARGETS, alike, RUSH_TIME } from '../js/games/count.js';

test('행렬: 1라운드는 처음엔 세는 동물만 천천히, 뒤로 갈수록 확 많아진다 / 2라운드는 화면에 쫙 깔린다', () => {
  for (const { id } of TARGETS) {
    for (let k = 0; k < 5; k++) {
      const s = makeRush(id);
      assert.equal(s.list.filter(c => c.k === id).length, s.count);
      assert.equal(s.list.length, s.count + s.decoys);
      for (const c of s.list) {
        assert.ok(c.at >= 0 && c.at + c.dur <= RUSH_TIME);
        if (c.k !== id) assert.ok(!alike(c.k, id));
      }
      const part = (a, b) => s.list.filter(c => c.at >= a * RUSH_TIME && c.at < b * RUSH_TIME);
      assert.ok(part(0, 0.2).length <= 8 && part(0, 0.2).every(c => c.k === id));
      assert.ok(part(0.75, 1).length > part(0.25, 0.5).length * 2);

      const m = makeCrowd(id);
      assert.ok(m.count >= 14 && m.count <= 22);
      assert.ok(m.list.length >= 78 && m.list.length <= 87);
      assert.equal(m.list.filter(c => c.k === id).length, m.count);
      for (const c of m.list) {
        assert.ok(c.x > 0 && c.x < 100 && c.y > 0 && c.y < 100);
        if (c.k !== id) assert.ok(!alike(c.k, id));
      }
    }
  }
});

test('채점: 가까운 순 +5·+3·+2·+1, 정확히 +2 더, 안 누르면 0점 / 백스페이스로 취소, 끝난 뒤 누른 건 무시', () => {
  assert.deepEqual(scoreRound({ a: 10, e: 10, b: 9, c: 12, d: 0 }, 10), { a: 7, e: 7, b: 2, c: 1 });
  let clock = 1_000_000;
  const roster = ['p0', 'p1', 'p2', 'p3'].map(id => ({ id, name: id }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  ctx.state.phaseEndsAt = clock;
  const S = () => ctx.state;
  const until = fn => { for (let i = 0; i < 3000 && !fn(S()); i++) { clock += 50; game.tick(ctx); } };
  const send = (pid, type, n) => { for (let i = 0; i < n; i++) game.onInput(ctx, { pid, type, data: { round: S().round, t: clock - S().startAt } }); };
  until(s => s.phase === 'show');
  S().show = { list: [], count: 5, decoys: 0 };
  send('p0', 'tap', 5);
  send('p1', 'tap', 7);
  send('p1', 'untap', 1);
  send('p2', 'tap', 3);
  assert.equal(S().counts, null, '끝나기 전엔 안 보임');
  until(() => clock > S().showEnd + 400);
  send('p3', 'tap', 5); // 너무 늦게 누름
  until(s => s.phase === 'result');
  assert.deepEqual(S().counts, { p0: 5, p1: 6, p2: 3, p3: 0 });
  assert.deepEqual(S().deltas, { p0: 7, p1: 3, p2: 2 });
});

test('봇끼리 한 판: 1라운드 지나가기 → 2라운드 쫙 깔림(다른 동물) 하고 끝', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const mem = new Map(roster.map(p => [p.id, {}]));
  const seen = [];
  while (!ctx.state.over && clock < 1_000_000 + 300_000) {
    clock += 50;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (act) game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
    }
    game.tick(ctx);
    if (ctx.state.phase === 'show' && seen.at(-1)?.round !== ctx.state.round) seen.push({ round: ctx.state.round, mode: ctx.state.mode, target: ctx.state.target.id });
  }
  assert.ok(ctx.state.over);
  assert.deepEqual(seen.map(s => s.mode), ['rush', 'crowd']);
  assert.notEqual(seen[0].target, seen[1].target);
  assert.ok(Object.values(ctx.state.scores).reduce((a, b) => a + b, 0) > 0);
});
