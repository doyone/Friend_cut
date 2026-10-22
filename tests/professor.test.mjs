import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../js/games/professor.js';

// 수업 시작 직후 상태. 교수님이 돌아보는 시각(secret.professorAt)은 테스트가 정한다
function fixture(n = 3) {
  let now = 10000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `학생${i}` }));
  const kills = [];
  const ctx = { roster, secret: {}, now: () => now, isOnline: () => true, nameOf: id => id, announce() {}, kill: (a, b, how) => kills.push([a, b, how]) };
  ctx.state = { ...game.setup(ctx), roster, run: 'r1' };
  now += 5000;
  game.tick(ctx);
  const seq = {};
  return {
    ctx, kills, S: () => ctx.state, now: () => now,
    turnAt(at) { ctx.secret.professorAt = at; },
    step(ms = 50) { now += ms; game.tick(ctx); },
    hold(pid, down, t = now) {
      seq[pid] = (seq[pid] || 0) + 1;
      return game.onInput(ctx, { pid, type: 'hold', data: { down, seq: seq[pid], run: 'r1', t } });
    },
    snitch(pid) { return game.onInput(ctx, { pid, type: 'snitch', data: { run: 'r1' } }); },
  };
}

test('누르고 있다가 교수님이 돌아보면 잠깐 봐준 뒤 C+', () => {
  const f = fixture();
  assert.equal(f.S().phase, 'play');
  f.turnAt(f.now() + 1000);
  f.hold('p0', true);
  for (let i = 0; i < 20; i++) f.step(); // 1초: 돌아봄
  assert.equal(f.S().look, 'watch');
  assert.ok(f.S().alive.includes('p0'), '돌아본 바로 그 순간엔 아직 후보');
  for (let i = 0; i < 7; i++) f.step();
  assert.ok(!f.S().alive.includes('p0'));
  assert.ok(f.S().caught.p0);
  assert.ok(f.S().scores.p0 > 900 && f.S().scores.p0 <= 1000);
});

test('돌아보기 전에 뗀 신호가 늦게 와도 무사', () => {
  const f = fixture();
  const turn = f.now() + 1000;
  f.turnAt(turn);
  f.hold('p0', true);
  for (let i = 0; i < 20; i++) f.step();
  assert.equal(f.S().look, 'watch');
  f.hold('p0', false, turn - 80); // 화면에선 돌아보기 0.08초 전에 뗐는데 신호가 늦게 옴
  for (let i = 0; i < 10; i++) f.step();
  assert.ok(f.S().alive.includes('p0'));
});

test('돌아본 뒤에 뗐거나 눌렀으면 C+', () => {
  const f = fixture();
  const turn = f.now() + 1000;
  f.turnAt(turn);
  f.hold('p0', true);
  for (let i = 0; i < 22; i++) f.step(); // 돌아보고 0.1초 뒤
  f.hold('p0', false);
  f.hold('p1', true);
  for (let i = 0; i < 10; i++) f.step();
  assert.ok(!f.S().alive.includes('p0'));
  assert.ok(!f.S().alive.includes('p1'));
});

test('걸린 사람의 고자질: 0.7초 뒤 돌아보고, 그걸로 걸리면 고자질한 사람 킬', () => {
  const f = fixture();
  f.turnAt(f.now() + 500);
  f.hold('p2', true);
  for (let i = 0; i < 20; i++) f.step(); // p2 걸림
  assert.ok(f.S().caught.p2);
  while (f.S().look === 'watch') f.step(); // 다시 칠판으로 돌아설 때까지 (보는 시간은 무작위)
  assert.equal(f.S().look, 'board');
  f.turnAt(f.now() + 5000);
  assert.equal(f.snitch('p2'), false, '돌아선 직후 1.6초는 고자질 못 함');
  while (f.now() - f.S().lookAt < 1600) f.step();
  f.hold('p0', true);
  assert.equal(f.snitch('p2'), true);
  assert.equal(f.snitch('p2'), false, '고자질은 한 번뿐');
  for (let i = 0; i < 25; i++) f.step();
  assert.ok(!f.S().alive.includes('p0'));
  assert.deepEqual(f.kills.at(-1).slice(0, 2), ['p2', 'p0']);
});

test('30초 버티면 끝. 살아남은 사람이 걸린 사람보다 위, 전원 C+면 우승자 없음', () => {
  const f = fixture();
  f.turnAt(f.now() + 100000);
  f.hold('p0', true);
  for (let i = 0; i < 6; i++) { f.step(400); f.hold('p0', true); }
  f.hold('p0', false);
  f.ctx.state.caught.p2 = f.now();
  f.ctx.state.alive = ['p0', 'p1'];
  for (let i = 0; i < 700; i++) f.step();
  const S = f.S();
  assert.ok(S.over);
  assert.ok(S.standings.p0 > S.standings.p1 && S.standings.p1 > S.standings.p2);
  assert.ok(S.titles.p0.some(t => t.includes('프로게이머')));

  const g = fixture(2);
  g.turnAt(g.now() + 300);
  g.hold('p0', true);
  g.hold('p1', true);
  for (let i = 0; i < 20; i++) g.step();
  for (let i = 0; i < 60; i++) g.step();
  assert.ok(g.S().over && g.S().allCaught);
  assert.deepEqual(Object.values(g.S().standings), [0, 0]);
});

test('봇끼리 한 판: 끝나고, 입력은 적당히', () => {
  let now = 10000;
  const roster = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, secret: {}, now: () => now, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster, run: 'r1' };
  const mem = new Map(roster.map(p => [p.id, {}]));
  let inputs = 0;
  while (!ctx.state.over && now < 60000) {
    now += 50;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (!act) continue;
      inputs++;
      game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
    }
    game.tick(ctx);
  }
  assert.ok(ctx.state.over);
  assert.ok(inputs < 8 * 30 * 4, `봇 입력이 너무 많음: ${inputs}`);
});
