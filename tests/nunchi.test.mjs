import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../js/games/nunchi.js';

// 사람 n명 판 (입력은 테스트가 직접). '시작!'까지 넘기고, 시작부터 ms(rel) 단위로 시간을 돌린다.
// lives를 주면 모두 그 하트로 시작 (1 = 한 번 독박이면 탈락)
function newGame(n = 3, lives = null) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const kills = [];
  const ctx = {
    roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {},
    kill: (killer, victim) => kills.push(`${killer}>${victim}`),
  };
  ctx.state = { ...game.setup(ctx), roster };
  ctx.state.phaseEndsAt = clock;
  if (lives) ctx.state.lives = Object.fromEntries(roster.map(p => [p.id, lives]));
  const tick = () => { clock += 50; game.tick(ctx); };
  const g = {
    ctx, kills, tick,
    get S() { return ctx.state; },
    toPlay() { tick(); while (ctx.state.phase !== 'play') tick(); },
    at(rel) { while (clock - ctx.state.startAt < rel) tick(); },
    until(phase) { for (let i = 0; i < 1000 && ctx.state.phase !== phase; i++) tick(); },
    // t = 그 사람 노트북이 잰 '시작부터 누른 시각'. 도착은 지금(clock)
    shout(pid, t) { return game.onInput(ctx, { pid, type: 'shout', data: { at: ctx.state.startAt, t } }); },
  };
  return g;
}

test('혼자 외치면 겹침 창(0.3초)과 기다림(0.4초)이 지나야 전구가 켜진다', () => {
  const g = newGame(3);
  g.toPlay();
  g.at(550);
  assert.equal(g.shout('p0', 500), true);
  assert.equal(g.shout('p0', 600), false, '한 라운드에 한 번만');
  g.at(1150);
  assert.equal((g.S.lamps || []).length, 0, '아직 안 켜짐');
  g.at(1250);
  assert.deepEqual(g.S.lamps.map(l => l.by), ['p0']);
});

test('0.3초 안에 같이 외치면 💥 겹친 사람 전부 독박(서로 킬), 0.35초 차이면 따로 켜지고 마지막은 독박', () => {
  const g = newGame(4, 1);
  g.toPlay();
  g.at(1000); g.shout('p0', 1000);
  g.at(1250); g.shout('p1', 1250);
  g.at(3000); g.shout('p2', 3000);
  g.at(3350); g.shout('p3', 3350);
  g.until('result');
  const S = g.S;
  assert.deepEqual(S.bangs.map(b => [...b.ids].sort()), [['p0', 'p1']]);
  assert.deepEqual(S.lamps.map(l => l.by), ['p2', 'p3']);
  assert.deepEqual(S.last.why, { p0: 'bang', p1: 'bang', p3: 'last' });
  assert.deepEqual(S.alive, ['p2']);
  assert.deepEqual([...g.kills].sort(), ['p0>p1', 'p1>p0']);
  g.until('final');
  assert.ok(S.over);
  assert.ok(S.titles.p2.some(t => t.includes('눈치 9단')));
  assert.ok(S.standings.p2 > S.standings.p0);
  assert.equal(S.standings.p0, S.standings.p3, '같은 라운드에 탈락하면 같은 등수');
});

test('도착 순서가 아니라 누른 시각으로: 늦게 도착해도 먼저 누른 사람이 1번 전구', () => {
  const g = newGame(3);
  g.toPlay();
  g.at(900); g.shout('p1', 900);  // 먼저 도착
  g.at(950); g.shout('p0', 500);  // 나중에 도착했지만 0.5초에 누름 (와이파이가 느림)
  g.until('result');
  assert.deepEqual(g.S.lamps.map(l => l.by), ['p0', 'p1']);
  assert.equal(g.S.last.why.p2, 'coward', '혼자 남은 사람은 독박');
});

test('이미 켜진 뒤에 도착한 신호는 확정 시각에 누른 걸로 쳐서, 켜진 전구가 도로 꺼지지 않는다', () => {
  const g = newGame(3);
  g.toPlay();
  g.at(550); g.shout('p0', 500);
  g.at(1300);
  assert.deepEqual(g.S.lamps.map(l => l.by), ['p0']);
  g.shout('p1', 600); // 0.6초에 눌렀다는 신호가 0.6초 넘게 늦게 옴
  assert.equal(g.S.presses.p1.t, 800);
  g.until('result');
  assert.deepEqual(g.S.lamps.map(l => l.by), ['p0', 'p1']);
  assert.equal((g.S.bangs || []).length, 0);
});

test('시간 안에 못 외친 사람이 여럿이면 전부 🐔 겁쟁이 독박, 시간 지나서 누른 건 무시', () => {
  const g = newGame(4, 1);
  g.toPlay();
  g.at(1000); g.shout('p0', 1000);
  g.at(8100);
  assert.equal(g.shout('p1', 8050), false);
  g.until('result');
  const cowards = Object.entries(g.S.last.why).filter(([, w]) => w === 'coward').map(([id]) => id).sort();
  assert.deepEqual(cowards, ['p1', 'p2', 'p3']);
  assert.deepEqual(g.S.alive, ['p0']);
});

test('❤️ 하트: 독박이면 하나만 잃고 남는다, 다 잃어야 탈락 (킬은 탈락시켰을 때만)', () => {
  const g = newGame(3);
  g.toPlay();
  g.at(1100); g.shout('p0', 1000); g.shout('p1', 1100);
  g.until('result');
  assert.deepEqual(g.S.last.why, { p0: 'bang', p1: 'bang', p2: 'coward' });
  assert.equal(g.S.last.void, false);
  assert.deepEqual(g.S.lives, { p0: 1, p1: 1, p2: 1 });
  assert.deepEqual([...g.S.alive].sort(), ['p0', 'p1', 'p2']);
  assert.equal(g.kills.length, 0);
});

test('남은 사람이 한꺼번에 다 탈락하게 되면 무효: 하트도 안 깎고 같은 라운드를 다시', () => {
  const g = newGame(2, 1);
  g.toPlay();
  const round = g.S.round;
  g.at(1100); g.shout('p0', 1000); g.shout('p1', 1100);
  g.until('result');
  assert.equal(g.S.last.void, true);
  assert.deepEqual([...g.S.alive].sort(), ['p0', 'p1']);
  g.until('ready');
  assert.equal(g.S.round, round);
  assert.equal(g.S.replay, true);
  assert.equal(g.kills.length, 0);
});

test('봇끼리 한 판: 끝까지 가고, 유령 깜빡임도 판정엔 영향 없이 들어간다', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const mem = new Map(roster.map(p => [p.id, {}]));
  let flicks = 0;
  while (!ctx.state.over && clock < 1_000_000 + 600_000) {
    clock += 50;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (act && game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} }) && act.type === 'flick') flicks++;
    }
    game.tick(ctx);
  }
  const S = ctx.state;
  assert.ok(S.over);
  assert.ok(S.alive.length <= 1);
  assert.equal(Object.keys(S.standings).length, 6);
  assert.ok(S.round >= 2);
  assert.ok(flicks >= 0);
});
