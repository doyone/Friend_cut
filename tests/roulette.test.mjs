import test from 'node:test';
import assert from 'node:assert/strict';
import game, { CARDS, HAND_MAX, REACT_TIME, TURN_TIME, WILL_TIME, dealOf, drawCard, livesOf, magOf, nextAlive, shellKey } from '../js/games/roulette.js';

function newGame(n = 3) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const kills = [];
  const said = [];
  const priv = {};
  const offline = new Set();
  const ctx = {
    roster, now: () => clock, secret: {}, isOnline: id => !offline.has(id), nameOf: id => id,
    setPrivate: (id, d) => { priv[id] = d; }, announce: t => said.push(t), kill: (a, b) => kills.push(`${a}>${b}`),
  };
  ctx.state = { ...game.setup(ctx), roster };
  const tick = (ms = 50) => { clock += ms; return game.tick(ctx); };
  const turnData = () => ({ turn: ctx.state.turnNo });
  const g = {
    ctx, kills, said, priv, offline, tick,
    get S() { return ctx.state; },
    get now() { return clock; },
    until(fn, max = 4000) {
      for (let i = 0; i < max && !fn(ctx.state); i++) tick();
      assert.ok(fn(ctx.state), `기다리던 상태가 안 옴 (지금 ${ctx.state.phase})`);
    },
    // 탄 순서를 정해 둔다 (앞이 지금 탄)
    shells(list) {
      const live = list.filter(Boolean).length;
      ctx.secret.shells = [...list];
      ctx.secret.peeks = {};
      Object.assign(ctx.state, { left: { live, blank: list.length - live }, fired: [] });
    },
    hand(id, cards) {
      ctx.secret.hands = { ...ctx.secret.hands, [id]: [...cards] };
      ctx.state.cards = { ...ctx.state.cards, [id]: cards.length };
    },
    handOf: id => ctx.secret.hands?.[id] || [],
    aim: (to, pid) => game.onInput(ctx, { pid: pid ?? ctx.state.turn, type: 'aim', data: { ...turnData(), to } }),
    fire: (to, pid) => game.onInput(ctx, { pid: pid ?? ctx.state.turn, type: 'fire', data: { ...turnData(), to } }),
    card: (card, to, pid) => game.onInput(ctx, { pid: pid ?? ctx.state.turn, type: 'card', data: { ...turnData(), card, to } }),
    react: (pid, card = null) => game.onInput(ctx, { pid, type: 'react', data: { shot: ctx.state.shot.no, card } }),
    will: (pid, to, card) => game.onInput(ctx, { pid, type: 'will', data: { to, card } }),
  };
  g.until(S => S.phase === 'turn');
  for (const p of roster) g.hand(p.id, []); // 시험마다 손패를 직접 정한다
  return g;
}

test('구성: 하트·탄창·카드 받기·뽑기 비율', () => {
  assert.deepEqual([2, 3, 5, 6, 8].map(livesOf), [4, 3, 3, 2, 2]);
  for (let alive = 2; alive <= 8; alive++) {
    for (let no = 1; no <= 10; no++) {
      for (const r of [0, 0.5, 0.999]) {
        const m = magOf(alive, no, () => r);
        assert.ok(m.live >= 1 && m.blank >= 1, '실탄·공포탄 모두 적어도 1발');
        assert.ok(m.live + m.blank >= 3 && m.live + m.blank <= 8, '3~8발');
      }
    }
  }
  assert.deepEqual(magOf(8, 1, () => 0), { live: 3, blank: 5 });
  assert.deepEqual(magOf(8, 9, () => 0), { live: 6, blank: 2 }, '탄창이 바뀔수록 실탄이 많아진다');
  assert.deepEqual([dealOf(8, 1), dealOf(8, 2), dealOf(4, 3)], [2, 1, 2]);
  assert.equal(Object.values(CARDS).reduce((a, c) => a + c.w, 0), 100);
  assert.equal(drawCard(3, () => 0), 'peek');
  for (let i = 0; i < 300; i++) assert.notEqual(drawCard(2), 'scatter', '둘만 남으면 산탄은 안 나온다');
});

test('장전: 탄 개수만 공개, 순서와 손패는 상태에 없다. 카드 2장씩은 본인에게만', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const priv = {};
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, setPrivate: (id, d) => { priv[id] = d; }, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const S = ctx.state;
  assert.equal(S.maxHp, 3);
  for (let i = 0; i < 200 && S.phase !== 'turn'; i++) { clock += 50; game.tick(ctx); }
  assert.equal(S.phase, 'turn');
  assert.equal(S.turn, S.order[0]);
  assert.equal(S.magNo, 1);
  assert.equal(ctx.secret.shells.length, S.left.live + S.left.blank);
  assert.equal(ctx.secret.shells.filter(Boolean).length, S.left.live);
  for (const p of roster) {
    assert.equal(S.cards[p.id], 2);
    assert.equal(priv[p.id].hand.length, 2);
    assert.deepEqual(priv[p.id].hand, ctx.secret.hands[p.id]);
  }
  const shown = JSON.stringify(S);
  assert.ok(!shown.includes('shells') && !shown.includes('hands'), '탄 순서·손패는 방장만');
});

test('나에게 쏘기: 공포탄이면 한 번 더, 실탄이면 하트 -1 하고 다음 사람', () => {
  const g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  g.shells([0, 1, 0]);
  assert.equal(g.fire(a, b), false, '남 차례엔 못 쏨');
  assert.equal(g.fire('nobody'), false);
  const no = g.S.turnNo;
  assert.equal(g.fire(a), true);
  assert.equal(g.S.phase, 'hush');
  assert.equal(g.fire(a), false, '결과가 나올 때까지 또 못 쏨');
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.shot.live, g.S.shot.again], [0, true]);
  assert.deepEqual(g.S.left, { live: 1, blank: 1 });
  assert.deepEqual(g.S.fired, [0]);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, a, '한 번 더');
  assert.ok(g.S.turnNo > no);
  g.fire(a);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[a], g.S.maxHp - 1);
  assert.equal(g.kills.length, 0);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, b);
  assert.equal(g.S.selfs[a], 2);
});

test('남에게 쏘기: 실탄이면 하트 -1, 공포탄이면 아무 일 없음. 어느 쪽이든 차례가 넘어가고, 그냥 맞기를 누르면 금방 결과', () => {
  const g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  const c = nextAlive(g.S, b);
  g.shells([1, 0, 1, 1]);
  assert.equal(g.aim(b), true);
  assert.equal(g.S.aim, b, '총구는 모두에게 보인다');
  g.fire(b);
  assert.deepEqual(g.S.shot.to, [b]);
  assert.equal(g.react(c), false, '안 겨눠진 사람은 못 받아침');
  const t0 = g.now;
  assert.equal(g.react(b), true);
  assert.equal(g.react(b), false, '한 번만');
  g.until(S => S.phase === 'shot');
  assert.ok(g.now - t0 < REACT_TIME - 1000, '다 정했으면 3초를 안 기다린다');
  assert.equal(g.S.hp[b], g.S.maxHp - 1);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, b);
  g.fire(c);
  const t1 = g.now;
  g.until(S => S.phase === 'shot'); // 아무도 안 누르면 3초(+조금) 뒤에 결과
  assert.ok(g.now - t1 >= REACT_TIME);
  assert.equal(g.S.hp[c], g.S.maxHp);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, c);
});

test('받아치기: 방패는 막고, 거울은 쏜 사람에게 되돌린다(두 배면 2칸). 공포탄이면 카드만 날린다', () => {
  const g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  const c = nextAlive(g.S, b);
  g.shells([1, 1, 0, 1]);
  g.hand(b, ['shield', 'double']);
  g.hand(c, ['mirror', 'shield']);
  g.fire(b);
  assert.equal(g.react(b, 'mirror'), false, '없는 카드');
  assert.equal(g.react(b, 'double'), false, '받아치기 카드가 아님');
  assert.equal(g.react(b, 'shield'), true);
  assert.equal(g.S.shot.react[b], 'shield', '내민 카드는 결과 전에 모두에게 보인다');
  assert.deepEqual(g.handOf(b), ['double']);
  assert.deepEqual(g.priv[b].hand, ['double']);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[b], g.S.maxHp);
  assert.equal(g.S.blocks[b], 1);
  g.until(S => S.phase === 'turn' && S.turn === b);

  // b가 두 배를 걸고 c를 쐈는데 거울 → b가 2칸
  g.S.hp[b] = 2;
  assert.equal(g.card('shield'), false, '받아치기 카드는 내 차례에 못 씀');
  assert.equal(g.card('double'), true);
  assert.equal(g.S.double, true);
  g.fire(c);
  assert.equal(g.S.shot.dbl, true);
  g.react(c, 'mirror');
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[c], g.S.maxHp);
  assert.equal(g.S.hp[b], 0);
  assert.deepEqual(g.S.shot.dead, [b]);
  assert.deepEqual(g.kills, [`${c}>${b}`], '거울로 탈락시키면 거울 쓴 사람 킬');
  assert.equal(g.S.mirrors[c], 1);
  assert.ok(!g.S.alive.includes(b));

  // 공포탄에 방패: 헛방패
  g.until(S => S.phase === 'turn' && S.turn === c);
  g.fire(a);
  g.until(S => S.phase === 'shot');
  g.until(S => S.phase === 'turn' && S.turn === a);
  g.shells([0, 1]);
  g.fire(c);
  g.react(c, 'shield');
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.wastes[c], 1);
  assert.deepEqual(g.S.shot.wasted, [c]);
  assert.deepEqual(g.handOf(c), []);
});

test('이어서 쏘면 총구는 방금 겨눈 곳 그대로 (시간이 끝나도 엉뚱하게 나에게 안 나감). 다음 사람 차례는 빈 총구', () => {
  // 나를 쏴서 공포탄 → 한 번 더: 나를 겨눈 채
  let g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  g.shells([0, 1, 0, 1]);
  g.aim(a);
  g.fire(a);
  g.until(S => S.phase === 'turn');
  assert.deepEqual([g.S.turn, g.S.aim, g.S.repeat], [a, a, true]);
  g.fire(b);
  g.until(S => S.phase === 'turn');
  assert.deepEqual([g.S.turn, g.S.aim, g.S.repeat], [b, null, false], '다음 사람은 새로 겨눈다');

  // 2명: 수갑 찬 상대를 쏘면 상대를 겨눈 채 차례가 돌아오고, 시간이 끝나면 그 상대에게 나간다
  g = newGame(2);
  const x = g.S.turn;
  const y = nextAlive(g.S, x);
  g.shells([0, 0, 1, 1]);
  g.hand(x, ['cuff']);
  g.aim(y);
  assert.equal(g.card('cuff', y), true);
  g.fire(y);
  g.until(S => S.phase === 'skip');
  g.until(S => S.phase === 'turn');
  assert.deepEqual([g.S.turn, g.S.aim, g.S.repeat], [x, y, true]);
  g.tick(TURN_TIME + 400);
  assert.equal(g.S.phase, 'hush');
  assert.deepEqual(g.S.shot.to, [y], '나에게가 아니라 겨눠 둔 상대에게');
});

test('카드: 돋보기는 나만 봄 · 반창고 · 수갑(다음 차례 쉼) · 훔치기 · 두 배와 산탄은 같이 못 씀', () => {
  const g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  const c = nextAlive(g.S, b);
  g.shells([1, 0, 0, 1]);
  g.hand(a, ['peek', 'heal', 'cuff', 'steal']);
  g.hand(b, ['mirror']);
  const ends = g.S.turnEndsAt;
  assert.equal(g.card('peek', null, b), false, '남 차례');
  assert.equal(g.card('peek'), true);
  assert.deepEqual(g.priv[a].peek, { key: shellKey(g.S), live: 1 });
  assert.equal(g.S.peeked, true, '돋보기를 썼다는 건 모두가 안다');
  assert.ok(!JSON.stringify(g.S).includes('"key"') && !g.priv[b]?.peek, '본 내용은 본인에게만');
  assert.ok(g.S.turnEndsAt >= ends && g.S.turnEndsAt <= g.S.turnCap);
  assert.equal(g.card('heal'), false, '하트가 꽉 찼으면 못 씀');
  g.S.hp[a] = 1;
  assert.equal(g.card('heal'), true);
  assert.equal(g.S.hp[a], 2);
  assert.equal(g.card('cuff'), false, '겨눈 사람이 있어야 함');
  assert.equal(g.card('cuff', a), false, '나에게는 못 씀');
  assert.equal(g.card('cuff', b), true);
  assert.equal(g.S.cuffs[b], true);
  assert.equal(g.card('steal', c), false, '카드 없는 사람');
  assert.equal(g.card('steal', b), true);
  assert.deepEqual(g.handOf(a), ['mirror']);
  assert.deepEqual([g.S.cards[a], g.S.cards[b]], [1, 0]);
  assert.equal(g.S.ev.k, 'steal');
  // a가 c를 쏜 뒤: b는 수갑이라 쉬고 다시 c 차례가 아니라… 순서는 a → (b 쉼) → c
  g.fire(c);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[c], g.S.maxHp - 1);
  g.until(S => S.phase === 'skip');
  assert.equal(g.S.skip, b);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, c);
  assert.ok(!g.S.cuffs?.[b], '한 번 쉬면 풀린다');
  g.hand(c, ['double', 'scatter']);
  assert.equal(g.card('double'), true);
  assert.equal(g.card('scatter'), false);
});

test('산탄: 나 빼고 모두에게, 각자 받아치기. 거울은 쏜 사람에게 돌아가고 같은 한 발에 탈락하면 같은 등수', () => {
  const g = newGame(4);
  const [a, b, c, d] = [0, 1, 2, 3].map(i => g.S.order[i]);
  assert.equal(g.S.turn, a);
  g.shells([1, 1, 1]);
  g.hand(a, ['scatter']);
  g.hand(b, ['shield']);
  g.hand(c, ['mirror']);
  assert.equal(g.card('scatter'), true);
  assert.equal(g.aim(b), false, '산탄은 겨눌 필요가 없다');
  g.fire(null);
  assert.deepEqual([...g.S.shot.to].sort(), [b, c, d].sort());
  g.react(b, 'shield');
  g.react(c, 'mirror');
  assert.equal(g.S.phase, 'hush');
  g.react(d);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.hp[a], g.S.hp[b], g.S.hp[c], g.S.hp[d]], [2, 3, 3, 2]);
  assert.equal(g.S.shot.sc, true);

  // d와 a가 하트 1개일 때 b의 산탄 실탄 → 둘이 같이 탈락, 공동 등수
  g.until(S => S.phase === 'turn' && S.turn === b);
  Object.assign(g.S.hp, { [a]: 1, [d]: 1 });
  g.hand(b, ['scatter']);
  g.hand(c, []);
  g.card('scatter');
  g.fire(null);
  for (const id of [a, c, d]) g.react(id);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([...g.S.shot.dead].sort(), [a, d].sort());
  assert.equal(g.kills.filter(k => k.startsWith(`${b}>`)).length, 2);
  g.until(S => S.phase === 'turn');
  g.shells([1]);
  g.S.hp[b] = 1;
  g.S.hp[c] = 1;
  const last = g.S.turn;
  const other = last === b ? c : b;
  g.fire(other);
  g.react(other);
  g.until(S => S.over);
  assert.equal(g.S.winner, last);
  assert.equal(g.S.standings[last], 4);
  assert.equal(g.S.standings[other], 3);
  assert.equal(g.S.standings[a], g.S.standings[d]);
  assert.equal(g.S.standings[a], 2);
  assert.ok(g.S.titles[last].includes('🔫 최후의 1인'));
});

test('시간 초과: 총구가 향한 사람에게(없으면 나에게) 그대로 나간다. 나에게 나간 공포탄도 한 번 더, 자리 비운 사람은 기다리지 않고 한 번 더도 없음', () => {
  const g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  const c = nextAlive(g.S, b);
  g.shells([0, 0, 1, 0, 1, 1]);
  g.tick(TURN_TIME - 200);
  assert.equal(g.S.phase, 'turn');
  g.until(S => S.phase === 'hush');
  assert.deepEqual([g.S.shot.to, g.S.shot.self, g.S.shot.auto], [[a], true, true]);
  g.until(S => S.phase === 'turn');
  assert.deepEqual([g.S.turn, g.S.shot.again], [a, true], '시간이 끝나 나에게 나간 공포탄도 한 번 더');
  g.aim(b);
  g.tick(TURN_TIME + 400);
  assert.equal(g.S.phase, 'hush');
  assert.deepEqual(g.S.shot.to, [b], '겨눠 둔 사람에게 나간다');
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, b);
  g.aim(c);
  g.tick(TURN_TIME + 400);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[c], g.S.maxHp - 1);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, c);
  g.offline.add(c);
  g.tick();
  assert.equal(g.S.phase, 'hush', '자리 비운 사람은 기다리지 않는다');
  assert.deepEqual(g.S.shot.to, [c]);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.shot.live, g.S.shot.again], [0, false], '자리 비운 사람의 공포탄은 한 번 더가 없다 (혼자 판을 끌지 않게)');
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, a);
  assert.equal(g.said.length, 0);
});

test('탈락과 유품: 남은 카드 한 장을 살아 있는 사람에게, 손패가 꽉 찬 사람에겐 못 줌, 안 고르면 사라짐 / 나를 쏴서 죽으면 자폭', () => {
  const g = newGame(4);
  const [a, b, c, d] = [0, 1, 2, 3].map(i => g.S.order[i]);
  g.shells([1, 1, 1, 1, 1]);
  g.S.hp[b] = 1;
  g.hand(b, ['heal', 'peek']);
  g.hand(c, ['shield', 'shield', 'shield', 'shield']);
  g.fire(b);
  g.react(b);
  g.until(S => S.phase === 'shot');
  assert.deepEqual(g.kills, [`${a}>${b}`]);
  assert.ok(g.S.wills[b] > g.now);
  assert.equal(g.will(b, c, 'heal'), false, '꽉 찬 사람');
  assert.equal(g.will(b, b, 'heal'), false, '죽은 사람');
  assert.equal(g.will(b, d, 'shield'), false, '없는 카드');
  assert.equal(g.will(a, d, 'heal'), false, '유품은 탈락한 사람만');
  assert.equal(g.will(b, d, 'heal'), true);
  assert.deepEqual(g.handOf(d), ['heal']);
  assert.deepEqual(g.handOf(b), []);
  assert.equal(g.S.cards[b], 0);
  assert.ok(!g.S.wills?.[b]);
  assert.equal(g.S.ev.k, 'will');

  // c는 유품을 안 고름 → 시간 지나면 사라진다
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, c, '탈락한 사람은 건너뛴다');
  g.S.hp[c] = 1;
  g.fire(c);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.dead[c], '-');
  assert.ok(g.said.some(t => t.includes('자폭')));
  assert.equal(g.S.boomer, c);
  assert.equal(g.S.cards[c], 4);
  g.tick(WILL_TIME + 400);
  assert.equal(g.S.cards[c], 0);
  assert.equal(g.will(c, a, 'shield'), false, '늦음');
});

test('봇끼리 끝까지: 규칙 안에서만 움직이고, 탄 개수·손패 장수가 늘 맞는다', () => {
  for (const n of [2, 4, 8]) {
    let clock = 1_000_000;
    const roster = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
    const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, setPrivate() {}, announce() {}, kill() {} };
    ctx.state = { ...game.setup(ctx), roster };
    const S = ctx.state;
    const mem = new Map(roster.map(p => [p.id, {}]));
    let refused = 0;
    while (!S.over && clock < 1_000_000 + 1_200_000) {
      clock += 50;
      for (const p of roster) {
        const act = game.bot(ctx, p.id, mem.get(p.id));
        if (act && !game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} }) && act.type !== 'aim') refused += 1;
      }
      game.tick(ctx);
      const shells = ctx.secret.shells || [];
      assert.equal(shells.length, (S.left?.live || 0) + (S.left?.blank || 0));
      for (const p of roster) {
        assert.ok(S.hp[p.id] >= 0 && S.hp[p.id] <= S.maxHp);
        assert.ok(S.cards[p.id] <= HAND_MAX);
        assert.equal((ctx.secret.hands?.[p.id] || []).length, S.cards[p.id]);
      }
    }
    assert.ok(S.over, `${n}명 판이 끝남`);
    assert.equal(S.alive.length, 1);
    assert.equal(Object.keys(S.standings).length, n);
    assert.equal(refused, 0, '봇이 안 되는 행동을 시도하지 않는다');
  }
});
