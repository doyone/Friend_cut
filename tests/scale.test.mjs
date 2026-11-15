import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS, DECKS, SLOTS, LANES, SCALE_MAX, CANDLES, START_HAND, START_HEN, HAND_MAX,
  setup, onInput, tick, bot, applyActs, runFight, settle, spawn, stepSlots, leftOf, rightOf, foeOf, frontOf, across,
  cardAt, scaleFor, smoked,
} from '../js/games/scale-core.js';

function newGame(n = 3) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const kills = [];
  const priv = {};
  const ctx = {
    roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id,
    setPrivate: (id, d) => { priv[id] = d; }, announce: () => {}, kill: (a, b) => kills.push(`${a}>${b}`),
  };
  ctx.state = { ...setup(ctx), roster };
  ctx.state.order = roster.map(p => p.id); // 시험에서는 앉은 순서를 p0, p1, … 로
  ctx.state.alive = [...ctx.state.order];
  let uid = 5000;
  const g = {
    ctx, kills, priv,
    get S() { return ctx.state; },
    tick: (ms = 50) => { clock += ms; return tick(ctx); },
    until(fn, max = 8000) {
      for (let i = 0; i < max && !fn(ctx.state); i++) g.tick();
      assert.ok(fn(ctx.state), `기다리던 상태가 안 옴 (지금 ${ctx.state.phase})`);
    },
    // 모두 사냥꾼 덱을 고르고 첫 선공 놓기 단계까지. 판 · 손패는 시험마다 직접 정한다
    start() {
      g.until(S => S.phase === 'deck');
      for (const p of roster) onInput(ctx, { pid: p.id, type: 'deck', data: { k: 'hunter' } });
      g.until(S => S.phase === 'place1');
      for (const p of roster) g.hand(p.id, []);
      return g;
    },
    hand(id, keys) {
      const hand = keys.map(k => ({ u: ++uid, k }));
      ctx.secret.hands = { ...ctx.secret.hands, [id]: hand };
      return hand.map(c => c.u);
    },
    handOf: id => (ctx.secret.hands?.[id] || []).map(c => c.k),
    // 판을 직접 놓는다: { 칸: 카드 키 }
    board(id, slots) {
      const row = Array(SLOTS).fill(0);
      for (const [s, k] of Object.entries(slots)) row[s] = spawn({ u: ++uid, k }, Number(s));
      ctx.state.board[id] = row;
      return row;
    },
    plan: (pid, acts = [], ready = true) => onInput(ctx, {
      pid, type: 'plan', data: { round: ctx.state.round, step: ctx.state.phase === 'place1' ? 1 : 2, acts, ready },
    }),
    // 아직 종을 안 친 사람은 빈손으로 치고 다음 단계로
    pass(phase) {
      for (const p of roster) if (ctx.state.alive.includes(p.id) && !ctx.state.ready?.[p.id]) g.plan(p.id, []);
      g.until(S => S.phase === phase);
    },
    // 지금 판 그대로 이번 턴을 끝까지 (계획 없이)
    fight() {
      if (ctx.state.phase === 'place1') { g.pass('reveal1'); g.until(S => S.phase === 'place2'); }
      if (ctx.state.phase === 'place2') g.pass('reveal2');
      g.until(S => S.phase === 'fight');
      return ctx.state.rs || [];
    },
  };
  return g;
}

test('구성: 카드 · 시작 덱 · 처음 손패', () => {
  for (const [k, d] of Object.entries(DECKS)) {
    assert.equal(d.cards.length, 7, k);
    for (const c of d.cards) assert.ok(CARDS[c] && !CARDS[c].tok, `${k}: ${c}`);
  }
  for (const [k, c] of Object.entries(CARDS)) assert.ok(c.name && c.atk >= 0 && c.hp > 0 && !(c.blood && c.bone), k);
  const g = newGame(3);
  g.until(S => S.phase === 'deck');
  onInput(g.ctx, { pid: 'p0', type: 'deck', data: { k: 'falcon' } });
  g.until(S => S.phase === 'place1');
  assert.equal(g.S.picked.p0, 'falcon');
  for (const p of g.ctx.roster) {
    const hand = g.handOf(p.id);
    assert.equal(hand.length, START_HAND + START_HEN);
    assert.equal(hand.filter(k => k === 'hen').length, START_HEN);
    assert.equal(g.S.deckN[p.id], 7 - START_HAND);
    assert.equal(g.priv[p.id].hand.length, hand.length, '손패는 본인에게만');
  }
  assert.ok(DECKS[g.S.picked.p1], '안 고르면 아무거나');
});

test('자리: 칸 i의 맞은편은 그쪽 이웃의 3 - i, 둘만 남으면 4줄이 그대로 맞댄다', () => {
  const S = { alive: ['a', 'b', 'c'], round: 1 };
  assert.equal(leftOf(S, 'a'), 'b');
  assert.equal(rightOf(S, 'a'), 'c');
  assert.deepEqual([0, 1, 2, 3].map(s => foeOf(S, 'a', s)), ['b', 'b', 'c', 'c']);
  assert.deepEqual([0, 1, 2, 3].map(across), [3, 2, 1, 0]);
  assert.deepEqual([0, 1, 2, 3].map(s => frontOf(S, 'a', s)), ['a', 'a', 'c', 'c']); // 오른쪽 전선은 오른쪽 이웃의 왼쪽 전선
  assert.equal(frontOf(S, 'b', across(0)), 'a', '맞댄 칸은 같은 전선');
  const D = { alive: ['a', 'b'], round: 1 };
  assert.deepEqual([0, 1, 2, 3].map(s => foeOf(D, 'a', s)), ['b', 'b', 'b', 'b']);
  assert.deepEqual([0, 1, 2, 3].map(s => frontOf(D, 'a', s)), ['a', 'a', 'b', 'b']);
});

test('선공 · 후공: 홀수 턴엔 왼쪽 전선부터, 다음 단계엔 반대쪽, 턴이 바뀌면 뒤집힌다', () => {
  assert.deepEqual(stepSlots({ round: 1 }, 'a', 1), [0, 1]);
  assert.deepEqual(stepSlots({ round: 1 }, 'a', 2), [2, 3]);
  assert.deepEqual(stepSlots({ round: 2 }, 'a', 1), [2, 3]);
  const g = newGame(3).start();
  const [hen] = g.hand('p0', ['hen']);
  assert.equal(applyActs(Array(SLOTS).fill(0), [{ u: hen, k: 'hen' }], 0, [{ u: hen, sac: [], slot: 2 }], [0, 1]).why, 'slot');
  g.plan('p0', [{ u: hen, sac: [], slot: 2 }]);       // 선공 놓기 단계엔 오른쪽 전선에 못 놓는다
  g.pass('reveal1');
  assert.equal(cardAt(g.S, 'p0', 2), null);
  assert.deepEqual(g.handOf('p0').filter(k => k === 'hen').length, 1, '못 놓은 카드는 손에 남는다');
});

test('제물: 닭을 놓고 같은 단계에 바쳐 피 1 카드 · 피가 모자라면 못 놓음 · 살진 제물은 피 3 · 뼈 카드', () => {
  const g = newGame(3).start();
  const S = g.S;
  const [hen, lynx, jackal] = g.hand('p0', ['hen', 'lynx', 'jackal']);
  g.plan('p0', [{ u: hen, sac: [], slot: 0 }, { u: lynx, sac: [0], slot: 0 }, { u: jackal, sac: [0], slot: 1 }]);
  g.pass('reveal1');
  assert.equal(cardAt(S, 'p0', 0).k, 'lynx');
  assert.equal(cardAt(S, 'p0', 1), null, '승냥이(피 2)는 제물 하나로 못 낸다');
  assert.equal(S.bones.p0, 1, '바친 닭 → 뼈 1');
  assert.deepEqual(S.rs.filter(e => e.by === 'p0').map(e => e.k), ['put', 'sac', 'put']);
  // 살진 돼지 하나로 반달곰(피 3)
  const pig = spawn({ u: 1, k: 'pig' }, 2);
  const r = applyActs([0, 0, pig, 0], [{ u: 2, k: 'bear' }], 0, [{ u: 2, sac: [2], slot: 0 }], [0, 1]);
  assert.equal(r.done, 1);
  assert.equal(r.board[0].k, 'bear');
  assert.equal(r.board[2], null);
  // 뼈 카드: 뼈가 모자라면 못 낸다
  assert.equal(applyActs([0, 0, 0, 0], [{ u: 3, k: 'wisp' }], 1, [{ u: 3, sac: [], slot: 0 }], [0, 1]).why, 'bone');
  assert.equal(applyActs([0, 0, 0, 0], [{ u: 3, k: 'wisp' }], 2, [{ u: 3, sac: [], slot: 0 }], [0, 1]).bones, 0);
});

test('타격: 선공이 먼저 쳐서 죽인 생물은 반격 못 하고, 빈칸이면 저울이 기운다', () => {
  const g = newGame(3).start();
  const S = g.S;
  // 1턴(홀수): p0의 왼쪽 전선(칸 0 · 1)이 선공, 맞은편은 p1의 칸 3 · 2
  g.board('p0', { 0: 'jackal', 1: 'lynx' });
  g.board('p1', { 3: 'lynx' });                         // 승냥이(3)에 죽는다 → 반격 없음
  const rs = g.fight();
  assert.equal(cardAt(S, 'p1', 3), null);
  assert.equal(cardAt(S, 'p0', 0).hp, CARDS.jackal.hp, '죽은 살쾡이는 반격 못 함');
  assert.equal(scaleFor(S, 'p0', 'p0'), 1, '칸 1의 살쾡이는 빈칸을 직격');
  assert.ok(rs.some(e => e.k === 'direct' && e.by === 'p0' && e.d === 1));
  assert.equal(S.bones.p1, 1);
  // 2턴(짝수): 이번엔 p1이 이 전선의 선공
  g.until(s => s.phase === 'place1' && s.round === 2);
  g.board('p1', { 3: 'bear' });
  g.fight();
  assert.equal(cardAt(S, 'p0', 0), null, '선공 반달곰(4)이 승냥이를 먼저 죽인다');
});

test('문양: 날개 · 올려치기 · 독니 · 가시 · 두 갈래 · 조이기 · 질주 · 귀환 · 뼈무덤', () => {
  const sim = (round, boards, extra = {}) => {
    const S = { round, moon: 0, alive: ['a', 'b', 'c'], board: {}, scale: { a: 0, b: 0, c: 0 }, candles: { a: 2, b: 2, c: 2 }, bones: {}, smoke: {}, ...extra };
    let u = 0;
    for (const id of S.alive) S.board[id] = Array.from({ length: SLOTS }, (_, s) => (boards[id]?.[s] ? spawn({ u: ++u, k: boards[id][s] }, s) : 0));
    return { S, res: runFight(S) };
  };
  // 날개는 넘어가고, 올려치기는 막는다
  let { S } = sim(1, { a: { 0: 'crow', 1: 'crow' }, b: { 3: 'lynx', 2: 'toad' } });
  assert.equal(S.scale.a, 1, '날개 하나만 넘어감');
  assert.equal(cardAt(S, 'b', 2).hp, CARDS.toad.hp - 1);
  // 독니: 반달곰도 죽는다 · 가시: 때린 쪽이 1 피해
  ({ S } = sim(1, { a: { 0: 'viper', 1: 'jackal' }, b: { 3: 'bear', 2: 'hedgehog' } }));
  assert.equal(cardAt(S, 'b', 3), null);
  assert.equal(cardAt(S, 'b', 2), null, '고슴도치(2)는 승냥이(3)에 죽는다');
  assert.equal(cardAt(S, 'a', 1).hp, CARDS.jackal.hp - 1, '가시에 찔림');
  // 두 갈래: 칸 1에서 칸 0 쪽(왼쪽 이웃)과 칸 2 쪽(오른쪽 이웃 = 반대편 전선)을 친다
  ({ S } = sim(1, { a: { 1: 'centipede' } }));
  assert.equal(S.scale.a, 1, '왼쪽 전선 직격');
  assert.equal(S.scale.c, -1, '오른쪽 전선(c의 왼쪽 전선)까지 직격');
  // 조이기: 맞은편 공격력 -1
  ({ S } = sim(1, { a: { 0: 'lynx' }, b: { 3: 'python' } }));
  assert.equal(cardAt(S, 'b', 3).hp, CARDS.python.hp, '살쾡이(1)가 조여서 못 친다');
  // 질주: 턴 끝에 옆 칸으로, 끝이면 돌아선다
  const q = sim(2, { a: { 1: 'hound' } });
  assert.equal(cardAt(q.S, 'a', 2)?.k, 'hound');
  assert.ok(q.res.ev.some(e => e.k === 'move' && e.from === 1 && e.to === 2));
  // 뼈무덤: 죽으면 뼈 3
  ({ S } = sim(1, { a: { 0: 'jackal' }, b: { 3: 'ember' } }));
  assert.equal(S.bones.b, 3);
});

test('귀환: 죽으면 손으로 돌아온다 (싸우다 죽든 제물이 되든)', () => {
  const g = newGame(3).start();
  const S = g.S;
  g.board('p0', { 0: 'jackal' });
  g.board('p1', { 3: 'wisp' });
  g.fight();
  assert.equal(cardAt(S, 'p1', 3), null);
  assert.ok(g.handOf('p1').includes('wisp'));
  const wisp = spawn({ u: 9, k: 'wisp' }, 0);
  const r = applyActs([wisp, 0, 0, 0], [{ u: 10, k: 'lynx' }], 0, [{ u: 10, sac: [0], slot: 0 }], [0, 1]);
  assert.ok(r.hand.some(c => c.k === 'wisp'), '제물로 바친 도깨비불도 손으로');
});

test(`저울 ${SCALE_MAX}: 촛불이 꺼지고 저울 0 · 넘친 만큼 뼈 · 잿불 · 다음 턴까지 연기`, () => {
  const g = newGame(3).start();
  const S = g.S;
  S.scale.p0 = 3;
  g.board('p0', { 0: 'tiger' });                        // 3 + 5 = 8 → 넘침 3
  const rs = g.fight();
  assert.equal(S.candles.p1, CANDLES - 1);
  assert.equal(S.scale.p0, 0);
  assert.equal(S.bones.p0, 3);
  assert.ok(g.handOf('p1').includes('ember'));
  assert.ok(rs.some(e => e.k === 'candle' && e.to === 'p1' && e.by === 'p0' && e.over === 3));
  assert.ok(smoked(S, 'p1', 'p0'));
  g.until(s => s.phase === 'place1' && s.round === 2);
  g.fight();                                            // 2턴: 범은 후공, 연기 속이라 직격이 안 들어간다
  assert.equal(S.scale.p0, 0, '연기가 가린다');
  g.until(s => s.phase === 'place1' && s.round === 3);
  assert.ok(!smoked(S, 'p1', 'p0'));
  g.fight();                                            // 3턴: 다시 들어가서 마지막 촛불까지
  assert.ok(!S.alive.includes('p1'));
  assert.deepEqual(g.kills, ['p0>p1']);
});

test('탈락: 판이 사라지고 양옆이 새로 맞댄다 (새 저울 0), 순위', () => {
  const g = newGame(4).start();
  const S = g.S;
  S.candles.p1 = 1;
  S.scale.p0 = 4;
  S.scale.p2 = 3;                                       // p2의 왼쪽 전선 = p3을 향함
  S.scale.p1 = -2;                                      // p1의 왼쪽 전선 = p2를 향함 (p2가 2 앞섬)
  g.board('p0', { 0: 'lynx' });
  g.board('p1', { 0: 'bear' });
  g.fight();
  assert.deepEqual(S.alive, ['p0', 'p2', 'p3']);
  assert.deepEqual(g.kills, ['p0>p1']);
  assert.equal(S.board.p1, undefined);
  assert.equal(S.scale.p1, undefined);
  assert.equal(leftOf(S, 'p0'), 'p2');
  assert.equal(S.scale.p0, 0, 'p0의 왼쪽 전선은 이제 p2와 맞대고 0에서');
  assert.equal(S.scale.p2, 3, '상관없는 전선은 그대로');
  assert.equal(S.outAt.p1, 1);
  assert.equal(S.dead.p1, 'p0');
});

test('마지막 둘이 같은 순간에 서로를 끝내면 더 크게 넘긴 쪽이 우승', () => {
  const g = newGame(2).start();
  const S = g.S;
  S.candles = { p0: 1, p1: 1 };
  S.scale = { p0: 4, p1: 4 };                          // 전선 p0은 p0이, 전선 p1은 p1이 4 앞섬
  g.board('p0', { 0: 'lynx' });                         // +1 → 5 (넘침 0)
  g.board('p1', { 0: 'jackal' });                       // +3 → 7 (넘침 2)
  g.fight();
  g.until(s => s.over);
  assert.equal(S.winner, 'p1');
  assert.ok(S.standings.p1 > S.standings.p0);
  // 똑같이 넘기면 둘 다 촛불 하나로 산다
  const T = { round: 1, moon: 0, alive: ['a', 'b'], scale: { a: 4, b: 4 }, candles: { a: 1, b: 1 }, bones: {}, smoke: {},
    board: { a: [spawn({ u: 1, k: 'lynx' }, 0), 0, 0, 0], b: [spawn({ u: 2, k: 'lynx' }, 0), 0, 0, 0] } };
  const res = runFight(T);
  assert.deepEqual(res.outs, []);
  assert.deepEqual(T.candles, { a: 1, b: 1 });
  assert.equal(res.ev.filter(e => e.k === 'revive').length, 2);
});

test('덱이 떨어지면 무덤을 섞어 다시 쓰고, 닭 더미는 안 떨어진다 · 손패가 꽉 차면 못 뽑는다', () => {
  const g = newGame(3).start();
  const S = g.S;
  g.ctx.secret.decks.p0 = [];
  g.ctx.secret.graves.p0 = [{ u: 1, k: 'bear' }];
  onInput(g.ctx, { pid: 'p0', type: 'draw', data: { round: S.round, from: 'deck' } });
  assert.deepEqual(g.handOf('p0'), ['bear']);
  assert.equal(S.graveN.p0, 0);
  onInput(g.ctx, { pid: 'p1', type: 'draw', data: { round: S.round, from: 'hen' } });
  assert.deepEqual(g.handOf('p1'), ['hen']);
  assert.equal(onInput(g.ctx, { pid: 'p1', type: 'draw', data: { round: S.round, from: 'hen' } }), false, '턴마다 한 번');
  g.hand('p2', Array(HAND_MAX).fill('hen'));
  onInput(g.ctx, { pid: 'p2', type: 'draw', data: { round: S.round, from: 'deck' } });
  assert.equal(g.handOf('p2').length, HAND_MAX);
  assert.equal(S.drew.p2, 'full');
});

test('봇끼리 끝까지: 2 · 4 · 8명', () => {
  for (const n of [2, 4, 8]) {
    for (let k = 0; k < 2; k++) {
      const g = newGame(n);
      const mem = new Map(g.ctx.roster.map(p => [p.id, {}]));
      for (let i = 0; i < 200000 && !g.S.over; i++) {
        for (const p of g.ctx.roster) {
          const act = bot(g.ctx, p.id, mem.get(p.id));
          if (act) onInput(g.ctx, { pid: p.id, type: act.type, data: act.data });
        }
        g.tick(100);
        for (const id of g.S.alive) {
          assert.ok((g.S.candles[id] || 0) >= 1, `${id} 촛불 0인데 살아 있음`);
          assert.ok(Math.abs(g.S.scale[id] || 0) < SCALE_MAX, '저울이 한계를 넘은 채로 남지 않는다');
        }
      }
      assert.ok(g.S.over, `${n}명 판이 안 끝남 (${g.S.round}턴)`);
      assert.equal(g.S.alive.length, 1);
      assert.equal(Object.keys(g.S.standings).length, n);
      assert.ok(g.S.round >= 2 && g.S.round <= 60, `${n}명 ${g.S.round}턴`);
    }
  }
});

test('LANES는 하나의 값으로 바뀐다', () => {
  assert.equal(SLOTS, LANES * 2);
});

/* ───────── 2차: 새 문양 · 도구 · 길목 · 넋패 ───────── */

const core = await import('../js/games/scale-core.js');
// 세 사람 a · b · c (a의 왼쪽 이웃 = b, 오른쪽 이웃 = c) 판을 정해 한 턴을 싸워 본다
function sim(round, boards, extra = {}) {
  const S = { round, moon: 0, alive: ['a', 'b', 'c'], board: {}, scale: { a: 0, b: 0, c: 0 }, candles: { a: 2, b: 2, c: 2 }, bones: {}, smoke: {}, ...extra };
  let u = 0;
  for (const id of S.alive) S.board[id] = Array.from({ length: SLOTS }, (_, s) => (boards[id]?.[s] ? spawn({ u: ++u, k: boards[id][s] }, s) : 0));
  return { S, res: runFight(S) };
}

test('2차 문양: 아홉 목숨 · 잠수 · 우두머리 · 성장 · 돌진', () => {
  const { NINE, toHand } = core;
  // 아홉 목숨: 세 번까지는 피만 주고 그 자리에 남는다 (그 칸엔 못 놓는다)
  let cat = spawn({ u: 1, k: 'cat' }, 0);
  for (let i = 0; i < NINE; i++) {
    const r = applyActs([cat, 0, 0, 0], [{ u: 9, k: 'lynx' }], 0, [{ u: 9, sac: [0], slot: 1 }], [0, 1]);
    assert.equal(r.done, 1);
    assert.equal(r.board[0].k, 'cat');
    assert.equal(r.bones, 0, '안 죽었으니 뼈도 없다');
    cat = r.board[0];
  }
  assert.equal(cat.lv, 0);
  assert.equal(applyActs([spawn({ u: 2, k: 'cat' }, 0), 0, 0, 0], [{ u: 9, k: 'lynx' }], 0, [{ u: 9, sac: [0], slot: 0 }], [0, 1]).why, 'full');
  const r4 = applyActs([cat, 0, 0, 0], [{ u: 9, k: 'lynx' }], 0, [{ u: 9, sac: [0], slot: 0 }], [0, 1]);
  assert.equal(r4.board[0].k, 'lynx', '네 번째엔 죽는다');
  // 잠수: 내가 후공인 전선에선 안 맞고(직격이 들어옴), 그래도 친다
  let { S } = sim(2, { a: { 0: 'otter' }, b: { 3: 'lynx' } });
  assert.equal(S.scale.a, -1, '살쾡이가 수달을 지나 직격');
  assert.equal(cardAt(S, 'a', 0).hp, CARDS.otter.hp);
  assert.equal(cardAt(S, 'b', 3).hp, CARDS.lynx.hp - 1);
  // 우두머리: 양옆 내 생물 공격력 +1
  ({ S } = sim(1, { a: { 0: 'lynx', 1: 'alpha' }, b: { 2: 'totem' } }));
  assert.equal(S.scale.a, 2, '살쾡이 1 + 우두머리 1');
  assert.equal(cardAt(S, 'b', 2).hp, CARDS.totem.hp - 3);
  // 성장: 버티면 다 자라고, 무덤 · 손으로는 처음 모습으로 돌아간다
  const g = sim(1, { a: { 0: 'cub' } });
  assert.equal(cardAt(g.S, 'a', 0).k, 'wolf');
  assert.equal(cardAt(g.S, 'a', 0).atk, CARDS.wolf.atk);
  assert.equal(toHand(cardAt(g.S, 'a', 0)).k, 'cub');
  assert.ok(g.res.ev.some(e => e.k === 'grow'));
  // 돌진: 맞은편을 죽이고 남은 피해는 직격
  const t = sim(1, { a: { 0: 'boar' }, b: { 3: 'hen' } });
  assert.equal(cardAt(t.S, 'b', 3), null);
  assert.equal(t.S.scale.a, 1);
  assert.ok(t.res.ev.some(e => e.k === 'direct' && e.tr));
});

test('번식: 낼 때 복제가 손에 생기고, 복제는 죽으면 사라진다', () => {
  const g = newGame(3).start();
  const [hen, spider] = g.hand('p0', ['hen', 'spider']);
  g.plan('p0', [{ u: hen, sac: [], slot: 0 }, { u: spider, sac: [0], slot: 0 }]);
  g.pass('reveal1');
  const copy = g.ctx.secret.hands.p0.find(c => c.k === 'spider');
  assert.ok(copy && copy.t === 1, '복제가 손에');
  assert.ok(core.isTok(copy));
  assert.ok(g.S.rs.some(e => e.k === 'breed'));
});

test('도구: 낫 · 엽전 · 목탁 · 닭장 · 뼈 자루 · 부채 · 부적', () => {
  const g = newGame(3).start();
  const S = g.S;
  const use = (t, s) => {
    g.ctx.secret.tools = { ...g.ctx.secret.tools, p0: [t] };
    return onInput(g.ctx, { pid: 'p0', type: 'tool', data: { round: S.round, i: 0, s } });
  };
  g.board('p1', { 3: 'bear' });
  assert.ok(use('sickle', 0), '낫: 칸 0의 맞은편(p1의 칸 3)');
  assert.equal(cardAt(S, 'p1', 3), null);
  assert.equal(S.bones.p1, 1);
  assert.ok(g.ctx.secret.graves.p1.some(c => c.k === 'bear'));
  S.scale.p0 = 3;
  assert.ok(use('coin', 0));
  assert.equal(S.scale.p0, 4);
  assert.equal(use('coin', 0), false, `엽전은 ${SCALE_MAX - 1}칸까지만`);
  use('coop');
  assert.equal(g.handOf('p0').filter(k => k === 'hen').length, 2);
  use('sack');
  assert.equal(S.bones.p0, 4);
  assert.ok(S.tlog.length >= 4);
  // 목탁: 그 전선의 상대는 이번 턴 못 친다 · 부채: 내 생물 전부 날개 · 부적: 이번 턴 안 죽는다
  S.scale.p0 = 0;
  g.board('p1', { 3: 'lynx', 2: 'tiger' });
  g.board('p0', { 0: 'lynx', 1: 'lynx' });
  g.board('p2', {});
  use('moktak', 0);
  use('fan');
  use('charm', 1);
  const rs = g.fight();
  assert.ok(rs.some(e => e.k === 'mute'));
  assert.equal(S.scale.p0, 2, '날개로 둘 다 직격, 상대는 못 침');
  assert.ok(cardAt(S, 'p0', 1), '부적');
});

test('촛불을 꺼뜨리면 도구 하나', () => {
  const g = newGame(3).start();
  const S = g.S;
  S.scale.p0 = 4;
  g.board('p0', { 0: 'lynx' });
  const rs = g.fight();
  assert.equal(S.candles.p1, CANDLES - 1);
  assert.equal(g.ctx.secret.tools.p0.length, 1);
  assert.ok(rs.some(e => e.k === 'gift' && e.to === 'p0'));
  assert.equal(S.toolsN.p0, 1);
});

test('길목: 새 패 · 도구 상자 · 모닥불(타기도 함) · 제단, 시간이 끝나면 대신 고른다', () => {
  const g = newGame(4).start();
  const S = g.S;
  S.round = core.ROAD_EVERY;
  g.fight();
  g.until(s => s.phase === 'road');
  const no = S.road.no;
  S.road.offers = { p0: ['altar', 'pack', 'fire'], p1: ['tools', 'pack', 'fire'], p2: ['fire', 'pack', 'tools'], p3: ['pack', 'fire', 'tools'] };
  const send = (pid, type, data) => onInput(g.ctx, { pid, type, data: { no, ...data } });
  // 새 패
  assert.ok(send('p3', 'road', { kind: 'pack' }));
  const k = S.road.st.p3.cards[0];
  assert.ok(send('p3', 'roadpick', { i: 0 }));
  assert.ok(g.handOf('p3').includes(k));
  // 도구 상자
  send('p1', 'road', { kind: 'tools' });
  assert.ok(send('p1', 'roadpick', { i: 1 }));
  assert.equal(g.ctx.secret.tools.p1.length, 1);
  // 제단: 까마귀를 바쳐 반달곰에 날개
  g.ctx.secret.decks.p0 = [{ u: 901, k: 'crow' }, { u: 902, k: 'bear' }];
  send('p0', 'road', { kind: 'altar' });
  assert.ok(send('p0', 'altar', { from: 901, to: 902 }));
  assert.deepEqual(g.ctx.secret.decks.p0, [{ u: 902, k: 'bear', sig: ['wing'] }]);
  // 모닥불: 첫 번째는 안전, 두 번째는 탈 수 있다
  g.ctx.secret.decks.p2 = [{ u: 903, k: 'tiger' }];
  send('p2', 'road', { kind: 'fire' });
  assert.ok(send('p2', 'fire', { u: 903, stat: 'atk' }));
  assert.equal(g.ctx.secret.decks.p2[0].da, 1);
  const rnd = Math.random;
  Math.random = () => 0; // 반드시 탄다
  assert.ok(send('p2', 'fire', { u: 903, stat: 'hp' }));
  Math.random = rnd;
  assert.equal(g.ctx.secret.decks.p2.length, 0, '타 버렸다');
  assert.ok(S.road.st.p2.burnt);
  g.until(s => s.phase === 'place1' && s.round === core.ROAD_EVERY + 1);
  // 시간이 끝나면 안 고른 사람도 뭔가 받는다
  S.round = core.ROAD_EVERY * 2 - 1;
  g.fight();
  g.until(s => s.phase === 'road');
  const before = g.handOf('p3').length + (g.ctx.secret.tools.p3 || []).length;
  g.tick(core.ROAD_TIME + 400);
  g.until(s => s.phase === 'place1');
  assert.ok(Object.values(S.road.st).every(st => st.done));
  assert.ok(g.handOf('p3').length + (g.ctx.secret.tools.p3 || []).length >= before);
});

test('넋패: 탈락한 사람이 고른 두 장으로 카드가 되어 꺼뜨린 사람 손에', () => {
  const g = newGame(3).start();
  const S = g.S;
  S.candles.p1 = 1;
  S.scale.p0 = 4;
  g.board('p0', { 0: 'lynx' });
  g.board('p1', { 0: 'hedgehog' });
  g.fight();
  assert.ok(!S.alive.includes('p1'));
  assert.deepEqual(S.souls.map(e => [e.from, e.to, !!e.done]), [['p1', 'p0', false]]);
  const src = g.ctx.secret.soulsrc.p1;
  assert.ok(src.some(c => c.k === 'hedgehog'), '판 위에 있던 카드도 재료');
  const strong = [...src].sort((a, b) => core.statsOf(b).atk - core.statsOf(a).atk)[0];
  const thorny = src.find(c => c.k === 'hedgehog');
  assert.ok(onInput(g.ctx, { pid: 'p1', type: 'soul', data: { stat: strong.u, sig: thorny.u } }));
  const soul = g.ctx.secret.hands.p0.find(c => c.k === 'soul');
  assert.ok(soul);
  assert.equal(core.statsOf(soul).atk, core.statsOf(strong).atk);
  assert.equal(core.statsOf(soul).hp, core.statsOf(strong).hp);
  assert.deepEqual(soul.sig, ['thorn']);
  assert.equal(soul.pid, 'p1');
  assert.equal(CARDS.soul.bone, core.SOUL_COST);
  assert.ok(S.souls[0].done);
});
