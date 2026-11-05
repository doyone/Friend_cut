import test from 'node:test';
import assert from 'node:assert/strict';
import * as planck from '../js/vendor/planck.mjs';
import game, { usePlanck, riseOf, drawPiece, defOf, landing, PIECES, SYMMETRIC } from '../js/games/stack.js';

usePlanck(planck);

// 사람 n명 판 (봇 아님: 입력은 테스트가 직접 넣는다). 인트로를 건너뛰고 첫 차례(aim)까지
function newGame(n = 3) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const kills = [];
  const ctx = {
    roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {},
    kill: (killer, victim, how) => kills.push({ killer, victim, how }),
  };
  ctx.state = { ...game.setup(ctx), roster };
  ctx.state.phaseEndsAt = clock;
  const tick = () => { clock += 100; game.tick(ctx); };
  const until = phase => { for (let i = 0; i < 400 && ctx.state.phase !== phase && !ctx.state.over; i++) tick(); };
  until('aim');
  const dropNow = (x = 0, a = 0, f = 0) => {
    game.onInput(ctx, { pid: ctx.state.turn, type: 'drop', data: { x, a, f } });
    until('result');
  };
  return { ctx, kills, tick, until, dropNow };
}

// 칸 좌표 모양을 0,0 기준으로 맞춰 비교용 문자열로 (무게중심 기준 좌표라 소수지만 칸끼리 차이는 정수)
function norm(list) {
  const mx = Math.min(...list.map(([x]) => x));
  const my = Math.min(...list.map(([, y]) => y));
  return list.map(([x, y]) => `${Math.round(x - mx)},${Math.round(y - my)}`).sort().join(' ');
}
const cellsOf = (k, f) => defOf(k, f).parts.map(p => [p.at[0] / 0.6, p.at[1] / 0.6]);
const rot = list => list.map(([x, y]) => [-y, x]);

test('기준선 상승폭: 처음엔 조금, 3차례마다 커지고, 끝이 있다', () => {
  assert.equal(riseOf(0), 0.2);
  assert.equal(riseOf(2), 0.2);
  assert.equal(riseOf(3), 0.3);
  assert.ok(riseOf(10) > riseOf(4));
  assert.equal(riseOf(1000), riseOf(500));
  assert.ok(riseOf(1000) <= 1.5);
});

test('블록은 12종 가방: 12개마다 모두 한 번씩', () => {
  const ctx = { secret: {} };
  const drawn = Array.from({ length: 36 }, () => drawPiece(ctx));
  for (let i = 0; i < 36; i += 12) assert.deepEqual([...drawn.slice(i, i + 12)].sort(), [...PIECES].sort());
});

test('펜토미노 12종은 5칸이고, 뒤집기가 필요 없는 모양 목록이 맞다', () => {
  assert.equal(PIECES.length, 12);
  for (const k of PIECES) {
    assert.equal(defOf(k, 0).parts.length, 5);
    // 좌우로 뒤집은 모양이 원래 모양을 돌린 것 중 하나와 같으면 '대칭'
    let r = cellsOf(k, 0);
    const turns = new Set();
    for (let i = 0; i < 4; i++, r = rot(r)) turns.add(norm(r));
    assert.equal(turns.has(norm(cellsOf(k, 1))), SYMMETRIC.has(k), k);
  }
});

test('빈 받침대에 놓으면 착지 예상과 실제 물리가 같다', () => {
  for (const [k, a] of [['P', 0], ['U', 0], ['I', 0], ['L', Math.PI / 2]]) {
    const g = newGame(3);
    const S = g.ctx.state;
    Object.assign(S, { piece: k });
    const L = landing(S, k, 0, 0, a);
    g.dropNow(0, a, 0);
    const b = g.ctx.state.bodies[0];
    assert.ok(g.ctx.state.lastResult.ok, `${k} 통과`);
    assert.ok(Math.abs(b.y - L.y) < 0.05, `${k} 예상 ${L.y} 실제 ${b.y}`);
    assert.ok(Math.abs(g.ctx.state.top - L.top) < 0.05);
  }
});

test('기준선에 못 미치면 독박: 앞 사람 킬, 기준선은 남은 탑 높이로 다시 맞춤', () => {
  const g = newGame(3);
  const first = g.ctx.state.turn;
  g.dropNow(0);
  assert.ok(g.ctx.state.lastResult.ok);
  g.until('aim');
  const second = g.ctx.state.turn;
  g.ctx.state.line = 50; // 억지로 못 넘을 선
  g.dropNow(0);
  const S = g.ctx.state;
  assert.equal(S.lastResult.ok, false);
  assert.ok(S.lastResult.short > 40);
  assert.ok(!S.alive.includes(second));
  assert.deepEqual(g.kills.map(k => [k.killer, k.victim]), [[first, second]]);
  assert.equal(S.line, S.top, '기준선 재조정');
  // 독박 뒤 다시 맞춘 탑으로 또 죽으면 아무도 안 넘겨준 것 → 킬 없음
  g.until('aim');
  const third = g.ctx.state.turn;
  assert.ok(g.ctx.state.line - g.ctx.state.top <= riseOf(g.ctx.state.turnsPlayed) + 1e-9);
  g.ctx.state.line = 50;
  g.dropNow(0);
  assert.ok(!g.ctx.state.alive.includes(third));
  assert.equal(g.kills.length, 1);
});

test('받침대 밖으로 떨어뜨리면 독박 (블록 추락)', () => {
  const g = newGame(3);
  const who = g.ctx.state.turn;
  g.ctx.state.piece = 'X';
  g.dropNow(4.2);
  const S = g.ctx.state;
  assert.equal(S.lastResult.ok, false);
  assert.ok(S.lastResult.fell >= 1);
  assert.ok(!S.alive.includes(who));
  assert.equal((S.bodies || []).length, 0);
});

test('봇끼리 한 판: 끝까지 가고, 차례 시작 때 필요한 높이는 늘 이번 상승폭 안', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const mem = new Map(roster.map(p => [p.id, {}]));
  let last = null;
  while (!ctx.state.over && clock < 1_000_000 + 1_800_000) {
    clock += 100;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (act) game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
    }
    game.tick(ctx);
    const S = ctx.state;
    if (S.phase !== last && S.phase === 'aim') {
      assert.ok(S.line - S.top <= S.rise + 0.05 + 1e-9, `기준선 ${S.line} 탑 ${S.top} 상승폭 ${S.rise}`);
      assert.ok(PIECES.includes(S.piece) && PIECES.includes(S.next.piece));
    }
    last = S.phase;
  }
  const S = ctx.state;
  assert.ok(S.over);
  assert.equal(S.alive.length, 1);
  assert.ok(S.titles[S.alive[0]].some(t => t.includes('퍼즐 장인')));
  assert.equal(Object.keys(S.standings).length, 4);
});
