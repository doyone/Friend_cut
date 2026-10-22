import test from 'node:test';
import assert from 'node:assert/strict';
import game, { doorAt, doorsFor, EXIT, DOORS } from '../js/games/door.js';

// 첫 방이 막 시작된 상태. 문 순서는 테스트가 정한다
function fixture(n = 3, doors) {
  let now = 10000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `학생${i}` }));
  const kills = [];
  const ctx = { roster, secret: {}, now: () => now, isOnline: () => true, nameOf: id => id, announce() {}, kill: (a, b, how) => kills.push([a, b, how]) };
  ctx.state = { ...game.setup(ctx), roster };
  now += 4500;
  game.tick(ctx);
  if (doors) ctx.state.room.doors = doors;
  const S = () => ctx.state;
  const f = {
    ctx, kills, S, now: () => now,
    step(ms = 100) { now += ms; game.tick(ctx); },
    // 걸어서(속도 지키며) x로 간다
    walk(pid, x) {
      for (let i = 0; i < 40; i++) {
        const p = (S().room.dark ? ctx.secret.pos : S().pos)[pid];
        if (Math.abs(p.x - x) < 0.001) break;
        now += 50;
        game.onInput(ctx, { pid, type: 'pos', data: { x: p.x + Math.sign(x - p.x) * Math.min(0.025, Math.abs(x - p.x)), dir: 0, t: now } });
      }
      game.tick(ctx);
    },
    // 방 끝까지 (닫힘 + 기다림 + 공개)
    finishRoom() {
      while (S().phase === 'choose' || S().phase === 'closing') f.step();
    },
  };
  return f;
}

test('문 칸·인원별 문', () => {
  assert.equal(doorAt(0, 3), 0);
  assert.equal(doorAt(0.5, 3), 1);
  assert.equal(doorAt(1, 3), 2);
  assert.deepEqual(doorsFor(2), ['short', 'side', 'slow']);
  assert.deepEqual(doorsFor(4), ['short', 'mid', 'slow']);
  assert.deepEqual(doorsFor(8), ['short', 'mid', 'wide', 'slow']);
});

test('정원 넘친 문은 전부 갇히고, 남은 문은 통과', () => {
  const f = fixture(3, ['short', 'mid', 'slow']);
  f.walk('p0', 0.1);
  f.walk('p1', 0.15);
  f.walk('p2', 0.9);
  f.finishRoom();
  const S = f.S();
  assert.equal(S.phase, 'reveal');
  assert.equal(S.prog.p0, 0);
  assert.equal(S.prog.p1, 0);
  assert.equal(S.prog.p2, DOORS.slow.go);
  assert.ok(S.result.doors[0].over);
});

test('정전 동안엔 남의 진짜 위치가 안 보이고, 닫히기 전 신호는 늦게 와도 인정', () => {
  const f = fixture(2, ['short', 'side', 'slow']);
  f.walk('p0', 0.5);
  while (!f.S().room.dark) f.step();
  const shown = f.S().pos.p0.x;
  f.walk('p0', 0.2); // 정전 중에 지름길로
  assert.equal(f.S().pos.p0.x, shown, '모두에게 보이는 자리는 그대로');
  assert.ok(Math.abs(f.ctx.secret.pos.p0.x - 0.2) < 0.001);
  // p1이 닫히기 0.05초 전에 먼 길로 옮긴 신호가 닫힌 뒤에 도착 → 인정. 닫힌 뒤에 움직인 신호는 무효
  while (f.now() < f.S().room.closeAt + 100) f.step(50);
  assert.equal(f.S().phase, 'closing');
  game.onInput(f.ctx, { pid: 'p1', type: 'pos', data: { x: 0.9, dir: 0, t: f.S().room.closeAt - 50 } });
  game.onInput(f.ctx, { pid: 'p1', type: 'pos', data: { x: 0.5, dir: 0, t: f.S().room.closeAt + 10 } });
  f.finishRoom();
  assert.equal(f.S().prog.p0, DOORS.short.go);
  assert.equal(f.S().prog.p1, DOORS.slow.go);
});

test('순간이동은 걷는 속도만큼만', () => {
  const f = fixture(2);
  const x0 = f.S().pos.p0.x;
  game.onInput(f.ctx, { pid: 'p0', type: 'pos', data: { x: 0, dir: 0, t: f.now() + 100 } });
  assert.ok(x0 - f.S().pos.p0.x < 0.11);
});

test('갇혀서 불길에 잡히면 그 문에 마지막으로 끼어든 사람 킬', () => {
  const f = fixture(3, ['short', 'mid', 'slow']);
  f.ctx.state.fire = -1; // 다음 불길 0칸 → 0칸에 갇히면 잡힘
  f.walk('p0', 0.1);
  f.step(500);
  f.walk('p1', 0.12); // 나중에 끼어듦
  f.walk('p2', 0.9);
  f.finishRoom();
  const S = f.S();
  assert.ok(!S.alive.includes('p0') && !S.alive.includes('p1'));
  assert.deepEqual(f.kills.map(k => k.slice(0, 2)), [['p1', 'p0']]);
  // 한 명 남았으니 공개 뒤 끝
  while (!S.over && f.now() < 60000) f.step();
  assert.ok(f.S().over);
  assert.equal(f.S().placement[0], 'p2');
});

test('출구에 먼저 닿으면 탈출 승리', () => {
  const f = fixture(2, ['short', 'side', 'slow']);
  f.ctx.state.prog.p0 = EXIT - 2;
  f.walk('p0', 0.1);
  f.walk('p1', 0.9);
  f.finishRoom();
  while (!f.S().over && f.now() < 60000) f.step();
  assert.deepEqual(f.S().escaped, ['p0']);
  assert.equal(f.S().placement[0], 'p0');
  assert.ok(f.S().titles.p0.includes('🏃 탈출왕'));
});

test('봇끼리: 판이 끝나고, 8명이면 여럿 탈락', () => {
  for (const n of [2, 4, 8]) {
    let now = 10000;
    const roster = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
    const ctx = { roster, secret: {}, now: () => now, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
    ctx.state = { ...game.setup(ctx), roster };
    const mem = new Map(roster.map(p => [p.id, {}]));
    while (!ctx.state.over && now < 400000) {
      now += 100;
      for (const p of roster) {
        const act = game.bot(ctx, p.id, mem.get(p.id));
        if (act) game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
      }
      game.tick(ctx);
    }
    assert.ok(ctx.state.over, `${n}명 판이 안 끝남`);
    assert.ok(ctx.state.roomNo <= 20, `${n}명 방 ${ctx.state.roomNo}개는 너무 김`);
  }
});
