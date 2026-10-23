import test from 'node:test';
import assert from 'node:assert/strict';
import * as planck from '../js/vendor/planck.mjs';
import game, { usePlanck, LIMIT, spawnY, dropGap, massOf, comOf, rollPiece, DEVILS } from '../js/games/seesaw.js';

usePlanck(planck);

test('떨구는 높이는 4차례마다 0.2m씩, 최대 2m', () => {
  assert.equal(dropGap(0), 0.8);
  assert.equal(dropGap(4), 1);
  assert.equal(dropGap(100), 2);
  // 빈 판 가운데(둥근 축 위)에 떨구면 축 꼭대기보다 떨구는 높이만큼 위
  const y = spawnY({ tilt: 0, bodies: [], turnsPlayed: 0 }, 'box', 0, 0);
  assert.ok(Math.abs(y - (0.9 + 0.35 + 0.8 + 0.3)) < 1e-9);
});

test('봇끼리 한 판: 끝까지 가고, 차례 시작부터 판 끝이 용암에 닿아 있는 일이 없음', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const mem = new Map(roster.map(p => [p.id, {}]));
  let last = null;
  while (!ctx.state.over && clock < 1_000_000 + 600_000) {
    clock += 100;
    for (const p of roster) {
      const act = game.bot(ctx, p.id, mem.get(p.id));
      if (act) game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} });
    }
    game.tick(ctx);
    const S = ctx.state;
    if (S.phase !== last && S.phase === 'aim') {
      assert.ok(Math.abs(S.tilt) < LIMIT - 0.004, `차례 시작 기울기 ${S.tilt}`);
      assert.equal((S.fallen || []).length, 0);
    }
    last = S.phase;
  }
  assert.ok(ctx.state.over);
  assert.equal(ctx.state.alive.length, 1);
  assert.ok(ctx.state.titles[ctx.state.alive[0]].some(t => t.includes('균형의 신')));
});

// 빈 판에 짐 하나를 (x, a)로 떨궈서 멈출 때까지
function dropOne(piece, x, a = 0, turnsPlayed = 0, turnLap = 1) {
  let clock = 1_000_000;
  const roster = [{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }, { id: 'p2', name: 'C' }];
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const S = ctx.state;
  S.phaseEndsAt = clock;
  while (S.phase !== 'aim') { clock += 100; game.tick(ctx); }
  Object.assign(S, { piece, turn: 'p0', turnsPlayed, turnLap });
  game.onInput(ctx, { pid: 'p0', type: 'drop', data: { x, a } });
  const id = S.pieceId;
  const seen = { chuteOpen: false, landSpeed: 0 };
  while (S.phase === 'fall') {
    const body = ctx.sim.bodies.get(id);
    const v = body.getLinearVelocity().length();
    clock += 50;
    game.tick(ctx);
    const b = S.bodies.find(q => q.id === id);
    if (b?.v) seen.chuteOpen = true;
    else if (seen.chuteOpen && !seen.landSpeed) seen.landSpeed = v;
  }
  return { S, b: S.bodies.find(q => q.id === id), seen, ms: clock - S.dropAt };
}

test('새 짐: 무게(화면 kg)와 무게중심', () => {
  const kg = k => massOf(k) * 25;
  assert.ok(Math.abs(kg('barbell') - 60) < 2 && Math.abs(kg('stonebed') - 58) < 2 && Math.abs(kg('cement') - 40) < 1);
  assert.ok(kg('gymball') < 3 && kg('gift') < 3 && kg('cone') < 5);
  // 오함마는 쇠머리 쪽(+x)으로 쏠리고, 돌리면 따라 돈다. 오뚝이는 아래로
  assert.ok(comOf('hammer', 0)[0] > 0.45);
  assert.ok(comOf('hammer', Math.PI)[0] < -0.45);
  assert.ok(comOf('roly', 0)[1] < -0.1);
});

test('룰렛: 방금 짐 다시 안 나옴, 첫 바퀴엔 특이한 짐 없음, 레어 뒤 3차례 쉼, 결승·카드 2장이면 선물 없음', () => {
  const S = { piece: 'fridge', rareGap: 0, alive: ['a', 'b', 'c'], cards: { a: 1 } };
  for (let i = 0; i < 3000; i++) {
    const k = rollPiece(S, 'a', 1);
    assert.notEqual(k, S.piece);
    assert.ok(!['roly', 'cart', 'airdrop', 'gift'].includes(k), `첫 바퀴에 ${k}`);
    S.piece = k;
  }
  let rare = 0;
  for (let i = 0; i < 3000; i++) {
    const k = rollPiece({ ...S, rareGap: 2 }, 'a', 3);
    if (k === 'airdrop' || k === 'gift') rare++;
  }
  assert.equal(rare, 0);
  for (let i = 0; i < 3000; i++) {
    assert.notEqual(rollPiece({ piece: null, alive: ['a', 'b'], cards: {} }, 'a', 3), 'gift');
    assert.notEqual(rollPiece({ piece: null, alive: ['a', 'b', 'c'], cards: { a: 2 } }, 'a', 3), 'gift');
  }
});

test('역기는 원판 사이에 가운데 축을 끼우면 가운데에 걸쳐진다', () => {
  const { S, b } = dropOne('barbell', 0);
  assert.ok(S.lastResult.ok);
  assert.ok(Math.abs(b.x) < 0.1 && Math.abs(S.tilt) < 0.02, `x ${b.x}, 기울기 ${S.tilt}`);
});

test('마트 카트: 바퀴가 아래면 굴러가고, 뒤집으면 그 자리에 선다', () => {
  assert.ok(dropOne('cart', 1.5, 0).b.x > 3);
  assert.ok(Math.abs(dropOne('cart', 1.5, Math.PI).b.x - 1.5) < 0.1);
});

test('보급 상자: 공중에선 낙하산으로 천천히, 처음 닿으면 접힘', () => {
  const { seen, b } = dropOne('airdrop', 1, 0, 40); // 2m 높이에서
  assert.ok(seen.chuteOpen);
  assert.ok(seen.landSpeed > 0 && seen.landSpeed < 3.3, `착지 속도 ${seen.landSpeed}`);
  assert.ok(!b.v);
});

test('악마의 선물: 놓고 살아남으면 악마 카드 +1', () => {
  const { S } = dropOne('gift', 1);
  assert.ok(S.lastResult.ok);
  assert.equal(S.cards.p0, 2);
  assert.equal(S.phase, 'result'); // 두 바퀴 전에는 카드를 받아도 고민 단계가 열리지 않음
  const later = dropOne('gift', 1, 0, 0, 3).S;
  assert.equal(later.cards.p0, 2);
  assert.equal(later.phase, 'decide');
});

test('악마 카드 ⬆️ 꼭대기에서: 다음 사람 짐은 룰렛 그대로, 떨구는 높이만 최대 / ⚓ 닻은 아래가 무겁다', () => {
  let clock = 1_000_000;
  const roster = [{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }, { id: 'p2', name: 'C' }];
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const S = ctx.state;
  S.phaseEndsAt = clock;
  while (S.phase !== 'aim') { clock += 100; game.tick(ctx); }
  // 차례 시작 조준점은 가운데에서 1m 옆
  assert.equal(Math.abs(S.aim.x), 1);
  S.turnLap = 3;
  const high = DEVILS.findIndex(d => d.high);
  assert.ok(game.onInput(ctx, { pid: S.turn, type: 'devil', data: { i: high } }));
  assert.ok(S.next.high && !S.next.piece);
  game.onInput(ctx, { pid: S.turn, type: 'drop', data: { x: 1, a: 0 } });
  while (S.phase !== 'spin' || !S.high) { clock += 100; game.tick(ctx); }
  assert.equal(S.spinKind, 'roulette');
  const gap = spawnY(S, 'box', 2, 0) - spawnY({ ...S, high: false, turnsPlayed: 0 }, 'box', 2, 0);
  assert.ok(Math.abs(gap - 1.2) < 1e-9, `높이 차이 ${gap}`); // 0.8m → 2m
  assert.ok(Math.abs(massOf('anchor') * 25 - 64) < 2 && comOf('anchor', 0)[1] < -0.3);
});


test('악마 카드는 3바퀴째부터: 다음 순서를 미리 뽑아 lap이 올라가도 조기 사용 불가', () => {
  const roster = [{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}];
  const ctx = {roster, now:()=>1_000_000,secret:{},isOnline:()=>true,nameOf:id=>id,announce(){},kill(){}};
  const initial = {...game.setup(ctx),roster,turn:'a',piece:'box',turnsPlayed:5,next:{id:'b',kind:'random',lap:3}};
  for (const turnLap of [1,2]) for (const phase of ['spin','aim','fall','clean','decide']) {
    ctx.state={...structuredClone(initial),turnLap,lap:3,phase,cards:{a:1}};
    for (let i=0;i<DEVILS.length;i++) {
      assert.equal(game.onInput(ctx,{pid:'a',type:'devil',data:{i}}),false,`${turnLap}바퀴 ${phase}`);
      assert.equal(ctx.state.cards.a,1);
      assert.equal(ctx.state.next.kind,'random');
    }
    if (phase !== 'aim') assert.notEqual(game.bot(ctx,'a',{} )?.type,'devil');
  }
  for (let i=0;i<DEVILS.length;i++) {
    ctx.state={...structuredClone(initial),turnLap:3,lap:3,phase:'aim',cards:{a:1}};
    assert.equal(game.onInput(ctx,{pid:'a',type:'devil',data:{i}}),true);
    assert.equal(ctx.state.cards.a,0);
    assert.equal(ctx.state.next.kind,'devil');
    assert.equal(game.onInput(ctx,{pid:'a',type:'devil',data:{i}}),false);
  }
});

test('기존 방이 1~2바퀴 카드 고민 중이어도 잠금을 적용하고 기다리지 않는다', () => {
  const roster=[{id:'a',name:'A'},{id:'b',name:'B'}];
  const ctx={roster,now:()=>1_000_000,secret:{},isOnline:()=>true,nameOf:id=>id,announce(){},kill(){}};
  ctx.state={...game.setup(ctx),roster,phase:'decide',turnLap:2,lap:3,turn:'a',phaseEndsAt:1_005_000,next:{id:'b',kind:'random',lap:3}};
  assert.equal(game.tick(ctx),true);
  assert.equal(ctx.state.phase,'result');
  assert.equal(ctx.state.cards.a,1);
});
