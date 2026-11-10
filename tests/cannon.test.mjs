import test from 'node:test';
import assert from 'node:assert/strict';
import game, { simulateShot, simulateShots, losersOf, plateOf, livesOf, angleAt, powerOf, pickKind, pickWind, KINDS, WIND, SAMPLE_MS } from '../js/games/cannon.js';

const dist = b => Math.hypot(b.x, b.y);
const R4 = plateOf(4);
const shot = (bodies, power, angle = 0, wind) => simulateShot({ bodies, shooter: 'me:1', owner: 'me', angle, power, R: R4, wind });
const meOf = s => s.after.find(b => b.id === 'me:1');
const stone = (pid, x, y, n = 1, off) => ({ id: `${pid}:${n}`, by: pid, x, y, ...(off ? { off: 1 } : {}) });

test('물리: 힘 0.5는 가운데, 약하면 물에 빠지고 세면 넘어간다 / 바람이 떨어지는 자리를 민다 / 들이받기·머리 위 착지 / 움직임 목록은 최종 자리로 끝난다', () => {
  assert.ok(dist(meOf(shot([], 0.5))) < 0.6);
  assert.ok(meOf(shot([], 0.03)).off, '약하면 풍덩');
  assert.ok(meOf(shot([], 1)).off, '세면 장외');
  assert.ok(Math.abs(meOf(shot([], 0.5, 0.2)).y) > 1, '각도를 틀면 옆으로');
  assert.equal(meOf(shot([], 0.5)).by, 'me', '말 주인이 남는다');

  const calm = shot([], 0.5);
  const windy = shot([], 0.5, 0, [0, 1]);
  const moved = windy.land[1] - calm.land[1];
  assert.ok(moved > WIND * 0.6 && moved <= WIND + 0.01, `바람에 밀림 ${moved}`);
  for (let i = 0; i < 50; i++) {
    const [x, y] = pickWind();
    assert.ok(Math.hypot(x, y) >= 0.24 && Math.hypot(x, y) <= 1.02);
  }

  const hit = shot([stone('a', 1, 0)], 0.5);
  const a = hit.after.find(b => b.id === 'a:1');
  assert.ok(a.x > 2.5, '밀려남');
  assert.equal(a.by, 'a');
  assert.deepEqual(hit.hit, ['a:1']);
  assert.deepEqual(hit.src, { 'a:1': 'me' }, '밀어낸 사람이 남는다');
  const tr = hit.tracks.find(t => t.id === 'a:1');
  assert.deepEqual([tr.d[0], tr.d[1]], [1, 0], '움직이기 전 자리부터');
  assert.deepEqual([tr.d.at(-2), tr.d.at(-1)], [a.x, a.y], '최종 자리로 끝남');
  assert.ok(tr.s % SAMPLE_MS === hit.fly % SAMPLE_MS);

  const landAt = calm.land;
  const stomp = shot([stone('b', landAt[0], landAt[1])], 0.5);
  assert.ok(stomp.fx.some(e => e.k === 'stomp'), '머리 위로 착지');
  assert.ok(shot([stone('c', 6.2, 0)], 0.85).after.find(b => b.id === 'c:1').off, '가장자리 말은 밀려서 장외');
  assert.equal(angleAt(0, 2000), 0);
  assert.equal(powerOf(550, 1100), 0.5, '꾹 누른 시간만큼 힘');
  assert.equal(powerOf(9000, 1100), 1, '다 차면 멈춘다');
});

test('일제 발사: 여러 명이 시차를 두고 착지해서 서로 부딪히고, 밀어낸 사람이 기록된다', () => {
  const sim = simulateShots({
    bodies: [stone('z', 0, 3)],
    R: R4,
    shots: [
      { shooter: 'a:2', owner: 'a', angle: 0, power: 0.5, delay: 0 },
      { shooter: 'b:2', owner: 'b', angle: 0, power: 0.5, delay: 90 },
      { shooter: 'c:2', owner: 'c', angle: 0.3, power: 0.55, delay: 180 },
    ],
  });
  assert.equal(sim.flyers.length, 3);
  assert.deepEqual(sim.flyers.map(f => f.d), [0, 90, 180], '나온 순서대로 착지');
  assert.equal(sim.fx.filter(e => e.k === 'fire').length, 3);
  assert.equal(sim.after.length, 4);
  assert.ok(sim.fx.some(e => e.k === 'stomp' || e.k === 'hit'), '같은 자리로 오면 부딪힌다');
  assert.ok(sim.src['a:2'] === 'b' || sim.src['b:2'] === 'a', '서로 밀어낸 사람으로 남는다');
  const times = sim.fx.map(e => e.t);
  assert.deepEqual(times, [...times].sort((x, y) => x - y), '효과는 시간 순서');
});

test('룰렛: 돌덩이는 세게 밀고 잘 안 밀리고, 풍선은 약하고, 얼음은 멀리 가고, 폭탄은 닿지 않아도 날리고, 대왕은 멀리서 닿는다', () => {
  const fired = (kind, bodies, power = 0.5) => simulateShot({ bodies, shooter: 'me:1', owner: 'me', kind, angle: 0, power, R: R4 });
  const targetX = (kind, k) => fired(kind, [{ ...stone('a', 1, 0), ...(k ? { k } : {}) }]).after.find(b => b.id === 'a:1').x;
  assert.ok(targetX('rock') > targetX('normal') + 0.5, '돌덩이는 세게 민다');
  assert.ok(targetX('balloon') < targetX('normal') - 0.5, '풍선은 약하게 민다');
  assert.ok(targetX('normal', 'rock') < targetX('normal') - 0.5, '돌덩이 말은 잘 안 밀린다');
  const iceAlone = fired('ice', []).after[0];
  assert.ok(iceAlone.off || iceAlone.x > 1.5, '얼음은 가운데를 지나 멀리 미끄러진다');
  assert.equal(iceAlone.k, 'ice', '말에 종류가 남는다');

  const landAt = fired('normal', []).land;
  const near = stone('b', landAt[0] + 2.5, landAt[1] + 2);
  const blast = fired('bomb', [near]);
  assert.ok(blast.fx.some(e => e.k === 'blast'));
  assert.deepEqual(blast.hit, ['b:1'], '폭탄은 닿지 않아도 날린다');
  assert.ok(Math.hypot(blast.after[0].x - near.x, blast.after[0].y - near.y) > 1.5);

  const beside = stone('c', landAt[0] + 2, 2.1);
  assert.equal(fired('normal', [beside]).hit.length, 0, '보통 크기는 안 닿는 자리');
  assert.deepEqual(fired('giant', [beside]).hit, ['c:1'], '대왕은 커서 닿는다');

  const seen = new Set(Array.from({ length: 500 }, () => pickKind()));
  assert.deepEqual([...seen].sort(), Object.keys(KINDS).sort(), '모든 종류가 나온다');
});

test('독박 고르기: 말 2개 중 안쪽 말 기준으로 제일 바깥, 말이 다 장외면 독박, 6명 이상이면 2명, 전원 장외면 무효 / 하트', () => {
  const bodies = [stone('a', 1, 0), stone('a', 7, 0, 2), stone('b', 3, 0), stone('b', 4, 0, 2), stone('c', 0, 2)];
  assert.deepEqual(losersOf(bodies, ['a', 'b', 'c'], 1), ['b'], 'a는 안쪽 말이 1m');
  assert.deepEqual(losersOf(bodies, ['a', 'b', 'c'], 2), ['b', 'c']);
  const off = [...bodies, stone('d', 9, 0, 1, true), stone('d', 9, 1, 2, true), stone('e', 9, 2, 1, true)];
  assert.deepEqual(losersOf(off, ['a', 'b', 'c', 'd', 'e'], 1), ['d', 'e']);
  const oneLeft = [stone('f', 9, 0, 1, true), stone('f', 2, 0, 2)];
  assert.deepEqual(losersOf([...oneLeft, stone('g', 1, 0)], ['f', 'g'], 1), ['f'], '말 하나가 남아 있으면 장외가 아니다');
  assert.deepEqual(losersOf([stone('a', 0, 0, 1, true)], ['a'], 1), []);
  assert.deepEqual([livesOf(2), livesOf(3), livesOf(8)], [2, 1, 1]);
  assert.ok(plateOf(2) < plateOf(8));
});

test('진행: 1바퀴는 돌아가며(톡 → 꾹 → 떼면 발사), 2바퀴는 일제 발사, 다 쏘면 독박 / 시간 끝 처리', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  ctx.state.phaseEndsAt = clock;
  const S = () => ctx.state;
  const tick = (ms = 50) => { clock += ms; game.tick(ctx); };
  const wait = fn => { for (let i = 0; i < 3000 && !fn(S()); i++) tick(); };
  const send = (pid, type, data = {}) => game.onInput(ctx, { pid, type, data: { no: S().aimNo, ...data } });
  wait(s => s.phase === 'angle');
  const order = [...S().order];
  const powers = [0.5, 0.42, 0.34, 0.26];
  order.forEach((id, i) => {
    wait(s => s.phase === 'angle' && s.idx === i);
    assert.equal(S().turn, id);
    assert.ok(S().wind, '샷마다 바람');
    Object.assign(S(), { swingP: 0, kind: 'normal', wind: [0, 0] }); // 룰렛·바람에 흔들리지 않게
    assert.equal(send(order.find(x => x !== id), 'lock', { t: 0 }), false, '남 차례');
    assert.equal(game.onInput(ctx, { pid: id, type: 'lock', data: { no: S().aimNo - 1, t: 0 } }), false, '지난 입력');
    assert.equal(send(id, 'lock', { t: 0 }), true);
    assert.equal(S().phase, 'power');
    assert.equal(send(id, 'fire', { hold: 500 }), false, '누르기 전엔 못 뗀다');
    assert.equal(send(id, 'charge'), true);
    S().gaugeMs = 1000;
    tick(50);
    assert.equal(send(id, 'fire', { hold: powers[i] * 1000 }), true);
    assert.equal(S().phase, 'shot');
    assert.equal(S().power, powers[i]);
  });

  wait(s => s.phase === 'volley');
  assert.equal(S().turn ?? null, null, '일제 발사는 차례가 없다');
  Object.assign(S(), { wind: [0, 0], kinds: Object.fromEntries(order.map(id => [id, 'normal'])), gaugeMs: 1000 });
  const [a, ...rest] = order;
  assert.equal(send(a, 'fire', { hold: 500 }), false, '각도부터');
  assert.equal(send(a, 'charge'), false, '각도부터');
  for (const id of order) {
    assert.equal(send(id, 'lock', { t: 0 }), true);
    assert.equal(send(id, 'lock', { t: 0 }), false, '한 번만');
    assert.equal(send(id, 'charge'), true);
  }
  tick(50);
  assert.equal(S().phase, 'volley', '다 쏠 때까지 기다린다');
  assert.equal(send(a, 'fire', { hold: 500 }), true);
  assert.equal(send(a, 'fire', { hold: 300 }), false, '한 번만');
  tick(50);
  assert.equal(S().phase, 'volley');
  rest.forEach((id, i) => send(id, 'fire', { hold: 420 + i * 40 }));
  tick(50);
  assert.equal(S().phase, 'shot', '다 쏘면 한꺼번에');
  assert.equal(S().shot.flyers.length, 4);
  assert.ok(order.every(id => S().bodies.filter(b => b.by === id).length === 2), '말이 2개씩');

  wait(s => s.phase === 'judge');
  const j = S().judge;
  assert.ok(j.losers.length >= 1);
  assert.deepEqual([...j.dying].sort(), [...j.losers].sort(), '4명이면 하트 1개');
  const survivors = order.filter(id => !j.losers.includes(id)).sort();
  wait(s => s.phase === 'angle' && s.round === 2);
  assert.deepEqual([...S().order].sort(), survivors);
  assert.deepEqual(S().bodies, [], '판은 비고 새로 시작');

  // 시간 끝: 안 누르면 약하게 발사, 끝까지 누르고 있으면 힘 1로 발사
  const id = S().turn;
  send(id, 'lock', { t: 0 });
  wait(s => s.phase === 'shot');
  assert.equal(S().power, 0.15);
  wait(s => s.phase === 'angle');
  const next = S().turn;
  send(next, 'lock', { t: 0 });
  send(next, 'charge');
  wait(s => s.phase === 'shot');
  assert.equal(S().power, 1);
  // 일제 발사에서 아무도 안 눌러도 시간이 끝나면 발사된다
  wait(s => s.phase === 'volley');
  wait(s => s.phase === 'shot');
  assert.equal(S().shot.flyers.length, S().order.length);
});

test('봇끼리 한 판: 2명·5명·8명 다 끝까지 가고, 순위가 나오고, 한 번에 보내는 양이 작다', () => {
  for (const n of [2, 5, 8]) {
    let clock = 1_000_000;
    const roster = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
    const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
    ctx.state = { ...game.setup(ctx), roster };
    const mem = new Map(roster.map(p => [p.id, {}]));
    let biggest = 0;
    while (!ctx.state.over && clock < 1_000_000 + 1_800_000) {
      clock += 50;
      for (const p of roster) {
        const act = game.bot(ctx, p.id, mem.get(p.id));
        if (act) game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
      }
      game.tick(ctx);
      if (ctx.state.phase === 'shot') biggest = Math.max(biggest, JSON.stringify(ctx.state).length);
    }
    const S = ctx.state;
    assert.ok(S.over, `${n}명 끝남`);
    assert.equal(S.alive.length, 1);
    assert.equal(Object.keys(S.standings).length, n);
    assert.ok(biggest < 60_000, `상태 크기 ${biggest}`);
  }
});
