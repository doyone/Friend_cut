import test from 'node:test';
import assert from 'node:assert/strict';
import game, { makeShow, pointsFor, TARGETS, alike, SHOW_TIME } from '../js/games/count.js';

// 라운드별 세는 동물 수 · 다른 동물 수 · 떼 수
const PLAN = { 1: [5, 8, 0, 0, 0], 2: [7, 10, 0, 0, 0], 3: [9, 12, 4, 6, 0], 4: [10, 13, 8, 11, 1], 5: [12, 15, 12, 16, 2] };

test('행렬: 1~2라운드는 세는 동물만, 3라운드부터 다른 동물, 4라운드부터 떼 (떼 속에 세는 동물, 떼끼리 안 겹침)', () => {
  for (const { id } of TARGETS) {
    for (let r = 1; r <= 5; r++) {
      for (let k = 0; k < 10; k++) {
        const s = makeShow(r, id);
        const [n0, n1, d0, d1, bursts] = PLAN[r];
        assert.ok(s.count >= n0 && s.count <= n1);
        assert.ok(s.decoys >= d0 && s.decoys <= d1);
        assert.equal(s.list.filter(c => c.k === id).length, s.count);
        assert.equal(s.list.length, s.count + s.decoys);
        for (const c of s.list) {
          assert.ok(c.at >= 0 && c.at + c.dur <= SHOW_TIME);
          if (c.k !== id) assert.ok(!alike(c.k, id));
        }
        const group = b => s.list.filter(c => c.burst === b);
        for (let b = 1; b <= bursts; b++) {
          const hidden = group(b).filter(c => c.k === id).length;
          assert.ok(hidden >= 1 && hidden <= 2);
          assert.equal(new Set(group(b).map(c => c.dir)).size, 1);
        }
        assert.equal(group(bursts + 1).length, 0);
        if (bursts === 2) assert.ok(Math.max(...group(1).map(c => c.at + c.dur)) <= Math.min(...group(2).map(c => c.at)));
      }
    }
  }
});

test('채점: 지나가는 동안 누른 횟수가 답, 다 지나간 뒤 누른 건 무시, 남의 횟수는 라운드 끝에 공개', () => {
  assert.deepEqual([10, 9, 11, 8, 13, 0].map(n => pointsFor(n, 10)), [3, 2, 2, 1, 0, 0]);
  let clock = 1_000_000;
  const roster = ['p0', 'p1', 'p2', 'p3'].map(id => ({ id, name: id }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  ctx.state.phaseEndsAt = clock;
  const S = () => ctx.state;
  const until = fn => { for (let i = 0; i < 3000 && !fn(S()); i++) { clock += 50; game.tick(ctx); } };
  const tap = (pid, n) => { for (let i = 0; i < n; i++) game.onInput(ctx, { pid, type: 'tap', data: { round: S().round, t: clock - S().startAt } }); };
  until(s => s.phase === 'show');
  S().show = { list: [], count: 5, decoys: 0 };
  tap('p0', 5);
  tap('p1', 6);
  tap('p2', 3);
  assert.equal(S().counts, null, '끝나기 전엔 안 보임');
  until(() => clock > S().showEnd + 400);
  tap('p3', 5); // 너무 늦게 누름
  until(s => s.phase === 'result');
  assert.deepEqual(S().counts, { p0: 5, p1: 6, p2: 3, p3: 0 });
  assert.deepEqual(S().deltas, { p0: 3, p1: 2, p2: 1 });
});

test('봇끼리 한 판: 5라운드 하고 끝, 점수가 쌓인다', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const mem = new Map(roster.map(p => [p.id, {}]));
  while (!ctx.state.over && clock < 1_000_000 + 300_000) {
    clock += 50;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (act) game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
    }
    game.tick(ctx);
  }
  assert.ok(ctx.state.over);
  assert.equal(ctx.state.round, 5);
  assert.ok(Object.values(ctx.state.scores).reduce((a, b) => a + b, 0) > 0);
});
