import test from 'node:test';
import assert from 'node:assert/strict';
import { GameHost } from '../js/host.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

// 가짜 통신: 상태 쓰기 시각만 기록한다
function fakeNet() {
  const store = { 'rooms/TEST/game/state': { run: 'r1', roster: [], phase: 'play' } };
  const times = [];
  let onInputs = null;
  return {
    times,
    send(n) { onInputs?.({ [`k${n}`]: { pid: 'p0', type: 'drive', data: {} } }); },
    cleared() { onInputs?.({}); }, // 방장이 처리한 입력을 지우면 알림이 한 번 더 온다
    net: {
      now: () => Date.now(),
      get: async p => store[p] ?? null,
      set: (p, v) => {
        if (p.endsWith('game/state')) times.push(performance.now());
        store[p] = v;
      },
      on: (p, cb) => {
        if (p.endsWith('inputs')) onInputs = cb;
        return () => {};
      },
      remove() {},
      push: () => 'x',
      transaction: async () => ({ committed: false, value: null }),
    },
  };
}

// 입력이 쉴 새 없이 오는 판 (카트처럼): 입력이 올 때마다, 지운 알림이 올 때마다 방장이 한 번씩 더 돈다
async function run(game, inputs = 60) {
  const f = fakeNet();
  const host = new GameHost(f.net, { path: sub => `rooms/TEST/${sub}`, snap: { stats: {} } }, game, 'r1');
  await host.start();
  for (let i = 0; i < inputs; i++) {
    f.send(i);
    f.cleared();
    await wait(4);
  }
  await wait(120); // 모아 둔 마지막 변경도 박자에 맞춰 나가게
  host.stop();
  return f.times;
}

test('방장: commitMs를 정한 게임은 입력이 몰려도 그 간격보다 자주 상태를 안 보낸다', async () => {
  const busy = { tickMs: 50, onInput: () => true, tick: () => true };
  const before = await run(busy);
  assert.ok(before.length >= 100, `commitMs 없으면 입력마다 보냄: ${before.length}번`);
  const after = await run({ ...busy, commitMs: 50 });
  assert.ok(after.length >= 3, `그래도 박자마다는 보냄: ${after.length}번`);
  const gaps = after.slice(1).map((t, i) => t - after[i]);
  assert.ok(Math.min(...gaps) >= 40, `가장 짧은 전송 간격 ${Math.min(...gaps).toFixed(1)}ms`);
});
