import test from 'node:test';
import assert from 'node:assert/strict';
import game, { maxOf, safeOf, spin, planShakes, DEBT_MAX } from '../js/games/balloon.js';

function newGame(n = 3) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const kills = [];
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill: (a, b) => kills.push(`${a}>${b}`) };
  ctx.state = { ...game.setup(ctx), roster };
  ctx.state.phaseEndsAt = clock;
  const tick = (ms = 50) => { clock += ms; game.tick(ctx); };
  tick();
  const send = (type, pid) => game.onInput(ctx, { pid: pid ?? ctx.state.turn, type, data: { turn: ctx.state.turnNo } });
  return {
    ctx, kills, tick,
    get S() { return ctx.state; },
    until(fn) { for (let i = 0; i < 3000 && !fn(ctx.state); i++) tick(); },
    pump: pid => send('pump', pid),
    pass: pid => send('pass', pid),
    dump: pid => send('dump', pid),
  };
}

test('안전 구간: 1~3번 흔들고 넘기기, 안 흔들면 못 넘김, 3번 채우면 자동으로 다음 사람, 남 차례엔 못 흔듦', () => {
  const g = newGame(3);
  const [a, b, c] = g.S.alive;
  assert.equal(g.S.phase, 'turn');
  assert.equal(g.S.turn, a);
  assert.equal(g.pass(), false, '한 번은 흔들어야 넘김');
  assert.equal(g.pump(b), false, '남 차례');
  assert.equal(g.pump(), true);
  assert.equal(g.pass(), true);
  assert.equal(g.S.turn, b);
  assert.equal(g.S.puffs, 1);
  g.pump(); g.pump(); g.pump();
  assert.equal(g.S.puffs, 4);
  assert.equal(g.S.turn, c, '3번 채우면 자동으로 넘어감');
  assert.equal(g.S.used, 0);
  assert.equal(maxOf(8), 31);
  assert.equal(maxOf(2), 22);
  assert.ok(safeOf(31) < 31);
});

test('빨간 구간: 두근거린 뒤 숨은 곳에서 펑, 터뜨린 사람 탈락, 다음 사람부터 작아진 새 병 / 룰렛에 거꾸로는 3명부터', () => {
  const g = newGame(3);
  const [a, b, c] = g.S.alive;
  g.ctx.secret.burst = g.S.safe + 2;
  g.S.puffs = g.S.safe;
  assert.equal(g.pump(), true);
  assert.ok(g.S.pending, '결과는 두근거린 뒤에');
  assert.equal(g.pump(), false, '결과가 나올 때까지 못 흔듦');
  g.tick(500);
  assert.equal(g.S.pending, 0);
  assert.equal(g.S.phase, 'turn');
  assert.equal(g.S.scares[a], 1);
  assert.equal(g.pass(), true);
  assert.equal(g.S.phase, 'spin', '빨간 구간의 차례는 룰렛부터');
  assert.equal(g.pump(), false, '룰렛 도는 중엔 못 흔듦');
  g.until(S => S.phase === 'turn');
  Object.assign(g.S, { puffs: g.S.safe + 1, must: 1, cap: 3, dir: 1 });
  assert.equal(g.S.turn, b);
  g.pump();
  g.tick(500);
  assert.equal(g.S.phase, 'boom');
  assert.deepEqual(g.S.alive, [a, c]);
  assert.equal(g.kills.length, 0, '혼자 터뜨리면 킬 없음');
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, c, '터뜨린 사람 다음 사람부터');
  assert.equal(g.S.puffs, 0);
  assert.equal(g.S.round, 2);
  assert.equal(g.S.max, maxOf(2));
  const burst = g.ctx.secret.burst;
  assert.ok(burst > g.S.safe && burst <= g.S.max);
  for (let i = 0; i < 200; i++) assert.notEqual(spin(2), 'rev');
});

test('떠넘기기: 다음 사람이 3번 더, 겹치면 +3(최대 9), 받아서 터뜨리면 떠넘긴 사람 킬 / 빨간 구간에서 3번 버티면 카드 +1', () => {
  const g = newGame(4);
  const [a, b, c] = g.S.alive;
  assert.equal(g.S.cards[a], 1);
  assert.equal(g.dump(), true);
  assert.equal(g.S.cards[a], 0);
  assert.equal(g.S.turn, b);
  assert.deepEqual([g.S.must, g.S.cap, g.S.ev], [3, 3, 'debt']);
  assert.equal(g.pump(), true);
  assert.equal(g.dump(), false, '흔들기 시작하면 못 씀');
  assert.equal(g.pass(), false, '다 흔들어야 넘김');
  g.pump(); g.pump();
  assert.equal(g.S.turn, c, '다 흔들면 다음 사람');
  assert.equal(g.dump(), true);
  assert.equal(g.S.must, 3);
  assert.equal(g.dump(), true, '받은 걸 또 떠넘기면 겹친다');
  assert.equal(g.S.must, 6);
  assert.ok(DEBT_MAX >= 6);
  const victim = g.S.turn;
  const forcer = g.S.by;
  assert.equal(victim, a, '카드를 다 쓴 사람이 받는다');
  g.ctx.secret.burst = g.S.safe + 1;
  g.S.puffs = g.S.safe;
  g.pump();
  g.tick(500);
  assert.equal(g.S.phase, 'boom');
  assert.deepEqual(g.kills, [`${forcer}>${victim}`]);

  const h = newGame(3);
  const [x] = h.S.alive;
  h.ctx.secret.burst = h.S.max;
  h.S.puffs = h.S.safe;
  for (let i = 0; i < 3; i++) { h.pump(); h.tick(500); }
  assert.equal(h.S.cards[x], 2, '3번 버티면 +1');
  assert.notEqual(h.S.turn, x);
});

test('시간이 끝나면 자동으로 흔들고 넘어간다 / 봇은 규칙 안에서 움직이고, 봇끼리 한 판 끝까지', () => {
  const g = newGame(2);
  const first = g.S.turn;
  g.until(S => S.turn !== first);
  assert.equal(g.S.puffs, 1);

  for (const S of [{ must: 1, cap: 3, puffs: 2, safe: 17 }, { must: 1, cap: 3, puffs: 20, safe: 17 }, { must: 3, cap: 3, puffs: 20, safe: 17 }]) {
    for (let i = 0; i < 30; i++) {
      const n = planShakes(S);
      assert.ok(n >= S.must && n <= S.cap);
    }
  }
  assert.equal(planShakes({ must: 1, cap: 3, puffs: 15, safe: 17 }, () => 0.9), 2, '빨간 구간 바로 앞에서 멈춘다');

  let clock = 1_000_000;
  const roster = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const mem = new Map(roster.map(p => [p.id, {}]));
  while (!ctx.state.over && clock < 1_000_000 + 900_000) {
    clock += 50;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (act) game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
    }
    game.tick(ctx);
  }
  const S = ctx.state;
  assert.ok(S.over);
  assert.equal(S.alive.length, 1);
  assert.equal(S.round, 5);
  assert.equal(Object.keys(S.standings).length, 6);
});
