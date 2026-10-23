import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../js/games/index.js';
import { AGAIN_INTRO } from '../js/util.js';

// R(한 판 더)로 다시 시작하면(prev 있음) 규칙 안내 없이 짧게 시작
test('한 판 더: 인트로가 있는 게임은 모두 짧아지고 again 표시', () => {
  const now = 1_000_000;
  const roster = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const ctx = () => ({ roster, now: () => now, secret: {}, isOnline: () => true, setPrivate() {}, nameOf: id => id, announce() {}, kill() {} });
  for (const game of GAMES) {
    const first = game.setup(ctx(), null);
    const again = game.setup(ctx(), { state: first, secret: {} });
    if (first.phase !== 'intro') continue; // 라이어(제시어 공개)·독박빼기(탑 쌓기)는 인트로 대신 바로 시작
    const end = S => S.phaseEndsAt ?? S.introUntil;
    assert.ok(again.again && !first.again, game.id);
    assert.equal(end(again) - now, AGAIN_INTRO, game.id);
    assert.ok(end(first) - now > AGAIN_INTRO, game.id);
  }
});
