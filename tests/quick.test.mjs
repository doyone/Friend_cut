import test from 'node:test';
import assert from 'node:assert/strict';
import game, { KINDS, keyOf, normCode, isAnswerKey } from '../js/games/quick.js';

// 사람 n명 판 (입력은 테스트가 직접). 첫 라운드 카운트다운까지
function newGame(n = 3) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  ctx.state.phaseEndsAt = clock;
  const tick = (ms = 100) => { clock += ms; game.tick(ctx); };
  tick();
  return {
    ctx, tick,
    toReveal() { while (ctx.state.phase === 'count') tick(); },
    press(pid, code, ms) { return game.onInput(ctx, { pid, type: 'press', data: { round: ctx.state.round, code, ms } }); },
  };
}

test('키: 알파벳은 그 키, 숫자는 키패드도, 자음·모음은 두벌식 자리', () => {
  assert.equal(keyOf('A'), 'KeyA');
  assert.equal(keyOf('5'), 'Digit5');
  assert.equal(normCode('Numpad5'), 'Digit5');
  for (const [ch, code] of [['ㄱ', 'KeyR'], ['ㅎ', 'KeyG'], ['ㅋ', 'KeyZ'], ['ㅏ', 'KeyK'], ['ㅣ', 'KeyL'], ['ㅔ', 'KeyP'], ['ㅡ', 'KeyM']]) {
    assert.equal(keyOf(ch), code, ch);
  }
  for (const kind of KINDS) for (const ch of kind.chars) assert.ok(isAnswerKey(keyOf(ch)), ch);
  // 모양이 헷갈리는 I·O·0·1은 안 나온다
  const all = KINDS.flatMap(k => k.chars);
  for (const ch of ['I', 'O', '0', '1']) assert.ok(!all.includes(ch), ch);
  assert.ok(!isAnswerKey('ShiftLeft') && !isAnswerKey('Space') && !isAnswerKey('Enter'));
});

test('순위는 도착 순서가 아니라 각자 잰 시간: 늦게 도착해도 더 빨리 누른 사람이 1등', () => {
  const g = newGame(3);
  g.ctx.state.char = { t: 'ㄱ', kind: 'consonant' };
  g.toReveal();
  assert.equal(g.press('p0', 'KeyR', 500), true);   // 먼저 도착
  assert.equal(g.press('p1', 'KeyR', 420), true);   // 나중에 도착했지만 더 빠름
  assert.equal(g.press('p2', 'KeyS', 300), true);   // 틀린 키 (ㄴ)
  assert.equal(g.press('p2', 'KeyR', 600), false, '틀리면 그 라운드는 끝');
  g.tick();
  const S = g.ctx.state;
  assert.equal(S.phase, 'result');
  assert.deepEqual(S.deltas, { p1: 3, p0: 2, p2: -1 });
  assert.deepEqual(S.scores, { p0: 2, p1: 3, p2: -1 });
});

test('너무 빠른 건(0.09초 미만) 찍은 것으로 틀림, 글자 뜨기 한참 전 신호는 무시', () => {
  const g = newGame(2);
  g.ctx.state.char = { t: 'A', kind: 'letter' };
  assert.equal(g.press('p0', 'KeyA', 400), false, '아직 카운트다운 중');
  g.toReveal();
  g.press('p0', 'KeyA', 50);
  g.press('p1', 'Numpad5', 700);
  g.tick();
  const S = g.ctx.state;
  assert.equal(S.answers.p0.guess, true);
  assert.deepEqual(S.deltas, { p0: -1, p1: -1 });
});

test('봇끼리 한 판: 8라운드 하고 끝, 점수로 순위', () => {
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
  const S = ctx.state;
  assert.ok(S.over);
  assert.equal(S.round, 8);
  assert.ok(S.best && S.best.ms >= 260);
  const total = Object.values(S.scores).reduce((a, b) => a + b, 0);
  assert.ok(total > 0 && total <= 8 * 6);
});
